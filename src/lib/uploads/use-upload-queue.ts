"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { isActivePhase, UploadQueue, type UploadQueueEntry, type UploadQueueItem, type UploadRunner } from "./queue";

export type { UploadItemPhase, UploadQueueEntry, UploadQueueItem, UploadRunner } from "./queue";

export interface UseUploadQueueOptions {
  /** Parallel uploads (default 2). Read once, when the queue is created. */
  concurrency?: number;
  /**
   * Replaces the real sign → upload → complete runner (uploadFile), e.g. a simulated uploader in a
   * development preview. Read once, when the queue is created.
   */
  upload?: UploadRunner;
  /** Called for each successful upload, e.g. `() => router.refresh()`. */
  onUploaded?: (item: UploadQueueItem) => void;
}

export interface UploadQueueControls {
  items: readonly UploadQueueItem[];
  /** True while any item is queued or in flight. */
  busy: boolean;
  add: (entries: Iterable<UploadQueueEntry>) => string[];
  cancel: (id: string) => boolean;
  remove: (id: string) => boolean;
  retry: (id: string) => boolean;
  clearFinished: () => void;
}

/**
 * Multi-file upload queue for admin pages (concurrency 2, cancel/remove/retry). When the component
 * unmounts the whole queue stops: transfers in flight are aborted and files still waiting are
 * cancelled, so nothing keeps uploading without a page to show it. The tab warns before closing
 * while busy; to also warn before in-app navigation, report `busy` to the admin unsaved-changes
 * guard (useUnsavedChangesGuard).
 */
export function useUploadQueue(options: UseUploadQueueOptions = {}): UploadQueueControls {
  const [queue] = useState(() => new UploadQueue({ concurrency: options.concurrency, upload: options.upload }));
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const busy = items.some((item) => item.phase === "queued" || isActivePhase(item.phase));
  const { onUploaded } = options;

  useEffect(() => {
    queue.setOnUploaded(onUploaded ?? null);
  }, [queue, onUploaded]);

  // Stop (not destroy) on unmount: under Strict Mode the cleanup and setup run again right after
  // mounting, and resume() keeps the same queue usable.
  useEffect(() => {
    queue.resume();
    return () => queue.abortAll();
  }, [queue]);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return {
    items,
    busy,
    add: queue.add,
    cancel: queue.cancel,
    remove: queue.remove,
    retry: queue.retry,
    clearFinished: queue.clearFinished,
  };
}
