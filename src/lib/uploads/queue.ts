/**
 * Framework-agnostic multi-file upload queue (external store for useSyncExternalStore).
 * Runs at most `concurrency` uploads at once; supports cancel, remove and retry. abortAll() stops the
 * whole queue (queued files are cancelled too, nothing new starts) until resume().
 */
import type { CompleteUploadRequest, CompleteUploadResponse, UploadKind } from "@/lib/api/contracts";
import { checkUploadFile } from "@/lib/validation/limits";
import {
  buildSignUploadRequest,
  isUploadAbort,
  UploadError,
  uploadFile,
  type UploadFileOptions,
  type UploadTarget,
} from "./client";

export type UploadItemPhase = "queued" | "signing" | "uploading" | "validating" | "done" | "error" | "cancelled";

export interface UploadQueueItem {
  id: string;
  name: string;
  size: number;
  kind: UploadKind;
  phase: UploadItemPhase;
  /** 0–1 fraction of bytes sent (1 once stored). */
  progress: number;
  error: string | null;
  result: CompleteUploadResponse | null;
}

export interface UploadQueueEntry {
  file: File;
  target: UploadTarget;
  /** Only for track uploads: title/artist/genre overrides. */
  metadata?: CompleteUploadRequest["metadata"];
}

export type UploadRunner = (options: UploadFileOptions) => Promise<CompleteUploadResponse>;

export interface UploadQueueOptions {
  /** Parallel uploads (default 2). */
  concurrency?: number;
  /** Injected for tests; defaults to uploadFile(). */
  upload?: UploadRunner;
}

export const DEFAULT_UPLOAD_CONCURRENCY = 2;
const PROGRESS_STEP = 0.01;

const ACTIVE_PHASES: ReadonlySet<UploadItemPhase> = new Set(["signing", "uploading", "validating"]);

export function isActivePhase(phase: UploadItemPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

/** Cancel/remove are refused while the server validates: the item may already exist. */
export function isCancellable(phase: UploadItemPhase): boolean {
  return phase === "queued" || phase === "signing" || phase === "uploading";
}

interface Job {
  entry: UploadQueueEntry;
  /** Controller of the attempt in flight; also identifies it so stale callbacks are ignored. */
  controller: AbortController | null;
}

export class UploadQueue {
  private items: readonly UploadQueueItem[] = [];
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Set<() => void>();
  private readonly concurrency: number;
  private readonly upload: UploadRunner;
  private onUploaded: ((item: UploadQueueItem) => void) | null = null;
  private sequence = 0;
  /** Set by abortAll(): no upload starts until resume(). */
  private stopped = false;

  constructor(options: UploadQueueOptions = {}) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY));
    this.upload = options.upload ?? uploadFile;
  }

  // Arrow properties keep a stable identity for useSyncExternalStore and for passing as callbacks.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly UploadQueueItem[] => this.items;

  /** Called with each item that finished successfully (e.g. to refresh the page data). */
  setOnUploaded = (callback: ((item: UploadQueueItem) => void) | null): void => {
    this.onUploaded = callback;
  };

  /**
   * Adds files; ones failing the local size/type check are listed immediately as errors. Returns ids.
   * While the queue is stopped (after abortAll) the new files wait as "queued" until resume().
   */
  add = (entries: Iterable<UploadQueueEntry>): string[] => {
    const ids: string[] = [];
    const added: UploadQueueItem[] = [];
    for (const entry of entries) {
      this.sequence += 1;
      const id = `upload-${this.sequence}`;
      const check = checkUploadFile(entry.target.kind, entry.file);
      this.jobs.set(id, { entry, controller: null });
      added.push({
        id,
        name: entry.file.name,
        size: entry.file.size,
        kind: entry.target.kind,
        phase: check.ok ? "queued" : "error",
        progress: 0,
        error: check.ok ? null : check.message,
        result: null,
      });
      ids.push(id);
    }
    if (added.length > 0) {
      this.items = [...this.items, ...added];
      this.emit();
      this.pump();
    }
    return ids;
  };

  cancel = (id: string): boolean => {
    const item = this.find(id);
    if (!item || !isCancellable(item.phase)) return false;
    const job = this.jobs.get(id);
    if (item.phase === "queued") {
      this.patch(id, { phase: "cancelled" });
    } else {
      // The runner rejects with an abort; the settle handler marks the item cancelled.
      job?.controller?.abort();
    }
    return true;
  };

  remove = (id: string): boolean => {
    const item = this.find(id);
    if (!item || item.phase === "validating") return false;
    this.jobs.get(id)?.controller?.abort();
    this.jobs.delete(id);
    this.items = this.items.filter((candidate) => candidate.id !== id);
    this.emit();
    this.pump();
    return true;
  };

  retry = (id: string): boolean => {
    const item = this.find(id);
    if (!item || (item.phase !== "error" && item.phase !== "cancelled") || !this.jobs.has(id)) return false;
    this.patch(id, { phase: "queued", progress: 0, error: null, result: null });
    this.pump();
    return true;
  };

  /** Drops finished (done/cancelled) items from the list. */
  clearFinished = (): void => {
    const keep = this.items.filter((item) => item.phase !== "done" && item.phase !== "cancelled");
    if (keep.length === this.items.length) return;
    for (const item of this.items) {
      if (!keep.includes(item)) this.jobs.delete(item.id);
    }
    this.items = keep;
    this.emit();
  };

  /**
   * Stops the whole queue (used when the page that owns it goes away): files still waiting are
   * marked cancelled, transfers in flight are aborted, and no further upload starts — not even from
   * an aborted transfer settling — until resume(). A file the server is already validating is left
   * to finish (it may already have been added to the library).
   */
  abortAll = (): void => {
    this.stopped = true;
    if (this.items.some((item) => item.phase === "queued")) {
      this.items = this.items.map((item) => (item.phase === "queued" ? { ...item, phase: "cancelled" } : item));
      this.emit();
    }
    for (const job of this.jobs.values()) job.controller?.abort();
  };

  /**
   * Lets uploads start again after abortAll(), e.g. when React Strict Mode re-runs the owning
   * effect. Files added or retried while stopped start now.
   */
  resume = (): void => {
    if (!this.stopped) return;
    this.stopped = false;
    this.pump();
  };

  /** Whether abortAll() stopped the queue (and resume() has not been called since). */
  isStopped = (): boolean => this.stopped;

  private find(id: string): UploadQueueItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private patch(id: string, changes: Partial<UploadQueueItem>): void {
    let changed = false;
    this.items = this.items.map((item) => {
      if (item.id !== id) return item;
      changed = true;
      return { ...item, ...changes };
    });
    if (changed) this.emit();
  }

  private pump(): void {
    if (this.stopped) return;
    let active = this.items.filter((item) => isActivePhase(item.phase)).length;
    for (const item of this.items) {
      if (active >= this.concurrency) break;
      if (item.phase === "queued") {
        this.start(item.id);
        active += 1;
      }
    }
  }

  private start(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const controller = new AbortController();
    job.controller = controller;
    const isCurrent = () => this.jobs.get(id) === job && job.controller === controller;

    this.patch(id, { phase: "signing", progress: 0, error: null, result: null });

    let lastProgress = 0;
    const onProgress = (fraction: number) => {
      if (!isCurrent()) return;
      if (fraction < 1 && fraction - lastProgress < PROGRESS_STEP) return;
      lastProgress = fraction;
      this.patch(id, { progress: fraction });
    };

    let run: Promise<CompleteUploadResponse>;
    try {
      run = this.upload({
        request: buildSignUploadRequest(job.entry.target, job.entry.file),
        file: job.entry.file,
        metadata: job.entry.metadata,
        signal: controller.signal,
        onProgress,
        onPhase: (phase) => {
          if (isCurrent()) this.patch(id, { phase });
        },
      });
    } catch (error) {
      run = Promise.reject(error);
    }

    run.then(
      (result) => {
        if (!isCurrent()) return;
        this.patch(id, { phase: "done", progress: 1, result });
        const done = this.find(id);
        if (done) this.onUploaded?.(done);
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        if (isUploadAbort(error) || controller.signal.aborted) {
          this.patch(id, { phase: "cancelled" });
          return;
        }
        if (!(error instanceof UploadError)) console.error("[uploads] unexpected upload failure", error);
        const message = error instanceof UploadError ? error.message : "Upload failed unexpectedly. Please try again.";
        this.patch(id, { phase: "error", error: message });
      },
    ).finally(() => {
      if (job.controller === controller) job.controller = null;
      this.pump();
    });
  }
}
