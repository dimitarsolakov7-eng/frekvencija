/** Bounded, observable event log for the dev player lab (engine log hook, fake API, lab actions). */

export type LabLogSource = "engine" | "api" | "lab";

export interface LabLogEntry {
  seq: number;
  /** Milliseconds since the log was created. */
  elapsedMs: number;
  source: LabLogSource;
  event: string;
  detail?: Record<string, unknown>;
}

export class LabLogStore {
  private entries: readonly LabLogEntry[] = [];
  private seq = 0;
  private readonly listeners = new Set<() => void>();
  private readonly startedAt: number;

  constructor(
    private readonly capacity = 400,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAt = now();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Oldest first; a new array identity on every change. */
  readonly getSnapshot = (): readonly LabLogEntry[] => this.entries;

  readonly push = (source: LabLogSource, event: string, detail?: Record<string, unknown>): void => {
    this.seq += 1;
    const entry: LabLogEntry = { seq: this.seq, elapsedMs: this.now() - this.startedAt, source, event, detail };
    const kept = this.entries.length >= this.capacity ? this.entries.slice(this.entries.length - this.capacity + 1) : this.entries;
    this.entries = [...kept, entry];
    this.notify();
  };

  readonly clear = (): void => {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.notify();
  };

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** Compact one-line rendering of an entry's detail for the log panel. */
export function formatLogDetail(detail: Record<string, unknown> | undefined): string {
  if (!detail) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return parts.join("  ");
}
