/**
 * Shuffle bag: every eligible id plays once per cycle (no repeats until the pool is exhausted), and
 * the first id of a new cycle differs from the last id of the previous cycle whenever the pool has
 * more than one id. Randomness is injected so tests are deterministic.
 *
 * The next cycle is planned as soon as it can be (not when it starts), so peek() can show what
 * comes after the end of the current cycle without drawing randomness or changing anything. The
 * plan is kept consistent with the pool: setPool()/exclude() drop ids from it and insert new ids at
 * random positions, exactly as they do for the current cycle.
 */
export class ShuffleBag {
  /** Ids from the most recent setPool() call, including excluded ones (so exclusions can be lifted). */
  private allIds: string[] = [];
  /** Eligible ids: allIds minus excluded. */
  private eligible = new Set<string>();
  /** Rest of the current cycle; next() takes from the front. */
  private remaining: string[] = [];
  /**
   * The next cycle, already shuffled: always a permutation of the eligible ids (empty when there are
   * none) whose first id differs from the id played right before it whenever the pool has > 1 id.
   */
  private planned: string[] = [];
  private readonly excluded = new Set<string>();
  private lastId: string | null = null;
  private cycles = 0;

  constructor(
    private readonly random: () => number = Math.random,
    ids: readonly string[] = [],
  ) {
    this.setPool(ids);
  }

  /** Number of eligible ids. */
  get size(): number {
    return this.eligible.size;
  }

  get isEmpty(): boolean {
    return this.eligible.size === 0;
  }

  /** Exactly one eligible id: it repeats every cycle. */
  get isSingleTrack(): boolean {
    return this.eligible.size === 1;
  }

  /** Ids left before the next call to next() starts a new cycle. */
  get remainingInCycle(): number {
    return this.remaining.length;
  }

  /** Number of cycles started so far. */
  get cycleCount(): number {
    return this.cycles;
  }

  get last(): string | null {
    return this.lastId;
  }

  has(id: string): boolean {
    return this.eligible.has(id);
  }

  isExcluded(id: string): boolean {
    return this.excluded.has(id);
  }

  /**
   * The ids the next calls to next() will return, in order, without consuming or reordering
   * anything (and without drawing randomness). It covers the rest of the current cycle plus the
   * planned next cycle, so it can return fewer than `count` ids for a small pool. The preview stays
   * exact until the pool changes (setPool/exclude/clearExclusions).
   */
  peek(count: number): string[] {
    if (!(count > 0) || this.eligible.size === 0) return [];
    const limit = Number.isFinite(count) ? Math.floor(count) : this.remaining.length + this.planned.length;
    const head = this.remaining.slice(0, limit);
    return head.length >= limit ? head : head.concat(this.planned.slice(0, limit - head.length));
  }

  /**
   * Replace the pool. Ids no longer present (or excluded) leave the remaining cycle immediately;
   * ids that are new to the pool are inserted at random positions of the remaining cycle (when a
   * cycle is in progress) so they become eligible without waiting for the next cycle. The planned
   * next cycle gets the same treatment. Setting the same ids again changes nothing.
   */
  setPool(ids: readonly string[]): void {
    const unique = [...new Set(ids)];
    const previous = this.eligible;
    this.allIds = unique;
    this.eligible = new Set(unique.filter((id) => !this.excluded.has(id)));
    this.remaining = this.remaining.filter((id) => this.eligible.has(id));
    const added = [...this.eligible].filter((id) => !previous.has(id));
    if (this.remaining.length > 0) {
      for (const id of added) this.insertIntoCycle(id);
    }
    this.updatePlan(added);
  }

  /** Returns the next id, starting a new cycle when needed; null when the pool is empty. */
  next(): string | null {
    if (this.eligible.size === 0) return null;
    if (this.remaining.length === 0) this.startCycle();
    const id = this.remaining.shift() ?? null;
    this.lastId = id;
    return id;
  }

  /**
   * Takes `id` out of the order as if next() had just returned it. For callers that choose with
   * peek() and only commit once the id is really used (e.g. an announcement is heard): normally
   * `id` is the next one and this is exactly next(); if the pool changed in between, `id` is taken
   * from wherever it is in the current cycle. Either way the id after it is never `id` again when
   * the pool has more than one id.
   */
  take(id: string): void {
    if (this.remaining.length === 0 && this.planned.includes(id)) this.startCycle();
    const index = this.remaining.indexOf(id);
    if (index !== -1) this.remaining.splice(index, 1);
    this.lastId = id;
    this.fixPlanStart();
  }

  /** Remove an id for the rest of the session (e.g. it failed to play). Survives setPool(). */
  exclude(id: string): void {
    this.excluded.add(id);
    this.eligible.delete(id);
    this.remaining = this.remaining.filter((candidate) => candidate !== id);
    this.planned = this.planned.filter((candidate) => candidate !== id);
    this.fixPlanStart();
  }

  /** Make excluded ids eligible again (manual retry). */
  clearExclusions(): void {
    if (this.excluded.size === 0) return;
    this.excluded.clear();
    this.setPool(this.allIds);
  }

  /** The planned cycle becomes the current one, and the cycle after it is planned. */
  private startCycle(): void {
    this.remaining = this.planned;
    this.cycles += 1;
    this.planned = this.shuffled([...this.eligible]);
    this.fixPlanStart();
  }

  /** Keeps the plan a permutation of the eligible ids after the pool changed. */
  private updatePlan(added: readonly string[]): void {
    if (this.eligible.size === 0) {
      this.planned = [];
      return;
    }
    const kept = this.planned.filter((id) => this.eligible.has(id));
    if (kept.length === 0) {
      this.planned = this.shuffled([...this.eligible]);
    } else {
      this.planned = kept;
      for (const id of added) this.planned.splice(this.randomIndex(this.planned.length + 1), 0, id);
    }
    this.fixPlanStart();
  }

  /** The planned cycle must not start with the id that will play right before it (pool > 1). */
  private fixPlanStart(): void {
    if (this.planned.length < 2) return;
    const before = this.remaining.length > 0 ? this.remaining[this.remaining.length - 1] : this.lastId;
    if (this.planned[0] !== before) return;
    const swapWith = 1 + this.randomIndex(this.planned.length - 1);
    [this.planned[0], this.planned[swapWith]] = [this.planned[swapWith], this.planned[0]];
  }

  /** Fisher–Yates shuffle of `order` (in place; returned for convenience). */
  private shuffled(order: string[]): string[] {
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.randomIndex(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  private insertIntoCycle(id: string): void {
    // Never place the id that just played at the front (e.g. a re-admitted excluded id).
    const position =
      id === this.lastId
        ? 1 + this.randomIndex(this.remaining.length)
        : this.randomIndex(this.remaining.length + 1);
    this.remaining.splice(position, 0, id);
  }

  /** Uniform integer in [0, bound). Guards against random() returning exactly 1 or garbage. */
  private randomIndex(bound: number): number {
    const r = this.random();
    const safe = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0;
    return Math.floor(safe * bound);
  }
}
