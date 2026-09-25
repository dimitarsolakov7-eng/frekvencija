/**
 * Bridges one PlayerEngine to React. The engine is created in an effect (never during render), so
 * components subscribe to this store instead: until an engine is attached it serves a static idle
 * snapshot (also used for the server render), and its command functions are stable wrappers that
 * call the current engine synchronously, which keeps play() inside the user's gesture.
 */
import type { DestroyOptions, PlayerCommands, PlayerEngineApi, PlayerSnapshot } from "@/lib/player/types";

export class PlayerEngineStore {
  private engine: PlayerEngineApi | null = null;
  private unsubscribeEngine: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly idleSnapshot: PlayerSnapshot;

  /** Stable command functions; each is a no-op while no engine is attached. */
  readonly commands: PlayerCommands;

  constructor(idleSnapshot: PlayerSnapshot) {
    this.idleSnapshot = idleSnapshot;
    this.commands = {
      start: () => this.engine?.start(),
      pause: () => this.engine?.pause(),
      resume: () => this.engine?.resume(),
      togglePlay: () => this.engine?.togglePlay(),
      skip: () => this.engine?.skip(),
      selectGenre: (genreId) => this.engine?.selectGenre(genreId),
      setVolume: (volume) => this.engine?.setVolume(volume),
      setMuted: (muted) => this.engine?.setMuted(muted),
      retry: () => this.engine?.retry(),
      destroy: (options) => this.destroyEngine(options),
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The engine's cached snapshot, or the static idle snapshot while none is attached. */
  readonly getSnapshot = (): PlayerSnapshot => this.engine?.getSnapshot() ?? this.idleSnapshot;

  /** Server render and hydration: always the idle snapshot. */
  readonly getServerSnapshot = (): PlayerSnapshot => this.idleSnapshot;

  get hasEngine(): boolean {
    return this.engine !== null;
  }

  /** Makes `engine` the current one (detaching any previous engine without destroying it). */
  attach(engine: PlayerEngineApi): void {
    if (this.engine === engine) return;
    this.unsubscribeEngine?.();
    this.engine = engine;
    this.unsubscribeEngine = engine.subscribe(this.notify);
    this.notify();
  }

  /** Detaches `engine` if it is the current one. The caller decides whether to destroy it. */
  detach(engine: PlayerEngineApi): void {
    if (this.engine !== engine) return;
    this.unsubscribeEngine?.();
    this.unsubscribeEngine = null;
    this.engine = null;
    this.notify();
  }

  /** Stops audio and releases the current engine (logout, session change). Idempotent. */
  destroyEngine(options?: DestroyOptions): void {
    const engine = this.engine;
    if (!engine) return;
    this.detach(engine);
    engine.destroy(options);
  }

  private readonly notify = (): void => {
    for (const listener of [...this.listeners]) listener();
  };
}
