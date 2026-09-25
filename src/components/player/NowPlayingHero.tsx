import type { MouseEvent } from "react";
import { RotateCcw } from "lucide-react";
import { Button, CoverImage, Spinner, buttonClasses } from "@/components/ui";
import type { PlayerGenre } from "@/lib/api/contracts";
import type { PlayerSnapshot } from "@/lib/player/types";
import { cn } from "@/lib/utils/cn";
import { PrimaryActionIcon } from "./PrimaryActionIcon";
import {
  SESSION_EXPIRED_LOGIN_PATH,
  describeHero,
  describePlayerError,
  heroStatus,
  skipUnavailableReason,
  type PrimaryAction,
  type StatusTone,
} from "./player-view";

export interface NowPlayingHeroProps {
  snapshot: PlayerSnapshot;
  genre: PlayerGenre | null;
  stationName: string;
  hasGenres: boolean;
  canStart: boolean;
  action: PrimaryAction;
  /** Runs the primary action synchronously (user gesture). */
  onPrimary(): void;
  onRetry(): void;
  /** Session expired: sign out cleanly and go to the login page. */
  onSignIn(): void;
  signingIn: boolean;
  /** In-page anchor of the genre grid, e.g. "#genres". */
  genresAnchor: `#${string}`;
}

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-fg/80",
  info: "text-fg/85",
  accent: "text-accent-text",
  success: "text-accent-text",
  warning: "text-warning",
  danger: "text-danger",
};

const ROUND_CONTROL = cn(
  "inline-flex size-18 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-card sm:size-22",
  "transition-colors hover:bg-accent-hover active:bg-accent-active aria-disabled:pointer-events-none aria-disabled:opacity-50",
  "[&_svg]:size-8 sm:[&_svg]:size-9",
);

/** Same look as <Button size="xl" className="rounded-full px-7"> (buttonClasses dims aria-disabled too). */
const PILL_CONTROL = buttonClasses({ size: "xl", className: "rounded-full px-7" });

/**
 * The one large emerald control: round for Play/Pause, a labelled pill for Start / Resume / Retry.
 * It is always the same host <button> — only its look, label and icon change — so the element
 * that has keyboard focus survives every state change (Start Radio → Pause, Retry → Pause, a stop
 * with nothing to press). A state without an action keeps it focusable but aria-disabled.
 */
export function HeroPrimaryControl({ action, onPrimary }: { action: PrimaryAction; onPrimary(): void }) {
  const round = action.kind === "pause" || action.kind === "resume" || action.kind === "none";
  return (
    <button
      type="button"
      aria-label={round ? action.label : undefined}
      aria-disabled={action.disabled || undefined}
      onClick={() => {
        if (!action.disabled) onPrimary();
      }}
      className={round ? ROUND_CONTROL : PILL_CONTROL}
    >
      <PrimaryActionIcon kind={action.kind} />
      {round ? null : action.label}
    </button>
  );
}

/** Explains an error or an empty genre with its one useful next step (not a live region). */
function PlaybackNotice({
  snapshot,
  onRetry,
  onSignIn,
  signingIn,
  genresAnchor,
}: Pick<NowPlayingHeroProps, "snapshot" | "onRetry" | "onSignIn" | "signingIn" | "genresAnchor">) {
  const chooseGenre = (label: string) => (
    <a href={genresAnchor} className={buttonClasses({ variant: "secondary" })}>
      {label}
    </a>
  );

  if (snapshot.status === "empty") {
    return (
      <div className="grid max-w-xl gap-3 rounded-card border border-warning/30 bg-canvas/80 p-4 backdrop-blur-sm">
        <div className="grid gap-1">
          <p className="font-semibold text-fg">No tracks in this genre yet</p>
          <p className="text-sm text-fg-muted text-pretty">Choose another genre, or check again once music has been added.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {chooseGenre("Choose another genre")}
          <Button variant="ghost" icon={<RotateCcw aria-hidden="true" />} onClick={onRetry}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  if (snapshot.status !== "error") return null;
  const view = describePlayerError(snapshot.errorCode, snapshot.message);
  let actions = null;
  switch (view.action) {
    case "sign-in":
      actions = (
        <a
          href={SESSION_EXPIRED_LOGIN_PATH}
          aria-disabled={signingIn || undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            // Without JavaScript the link still works; with it, the stale session is cleared first.
            event.preventDefault();
            if (!signingIn) onSignIn();
          }}
          className={buttonClasses({ variant: "primary" })}
        >
          {signingIn ? "Signing out…" : view.actionLabel}
        </a>
      );
      break;
    case "choose-genre":
      actions = chooseGenre(view.actionLabel);
      break;
    case "reload":
      actions = (
        <Button variant="secondary" icon={<RotateCcw aria-hidden="true" />} onClick={() => window.location.reload()}>
          {view.actionLabel}
        </Button>
      );
      break;
    case "retry":
      // The big button already says Retry; offer the way out as well when the genre itself is the problem.
      actions = snapshot.errorCode === "catalogue_unavailable" ? chooseGenre("Choose another genre") : null;
      break;
  }

  return (
    <div
      className={cn(
        "grid max-w-xl gap-3 rounded-card border bg-canvas/80 p-4 backdrop-blur-sm",
        snapshot.errorCode === "network" ? "border-warning/30" : "border-danger/35",
      )}
    >
      <div className="grid gap-1">
        <p className="font-semibold text-fg">{view.title}</p>
        <p className="text-sm text-fg-muted text-pretty">{view.description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * "Now playing" hero (screens 03/04): the current genre's artwork under a dark gradient, the genre
 * name, the track (or "Station announcement" / "Welcome announcement") and one large emerald
 * control. The status line is plain text; announcements happen in the player bar's live region.
 */
export function NowPlayingHero(props: NowPlayingHeroProps) {
  const { snapshot, genre, stationName, hasGenres, canStart, action, onPrimary } = props;
  const context = { hasGenres, canStart };
  const hero = describeHero(snapshot, { ...context, genre, stationName });
  // Errors and empty genres are explained by the notice below; the status line would repeat it.
  const status = snapshot.status === "error" || snapshot.status === "empty" ? null : heroStatus(snapshot, context);
  // During the station voice the player bar's Skip is unavailable; say why where it is visible.
  const skipNote = skipUnavailableReason(snapshot);

  return (
    <section aria-labelledby="now-playing-heading" className="flex min-w-0">
      <CoverImage
        src={genre?.coverUrl}
        artworkKey={genre?.slug ?? null}
        priority
        sizes="(max-width: 1024px) 100vw, 62vw"
        className="flex min-h-72 w-full rounded-card border border-border shadow-card sm:min-h-80 lg:min-h-92"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-linear-to-t from-canvas/95 via-canvas/60 to-canvas/15 sm:bg-linear-to-r sm:from-canvas/92 sm:via-canvas/55 sm:to-canvas/5"
        />
        <div className="flex w-full flex-col justify-between gap-8 p-5 sm:p-7 lg:p-8">
          <div className="grid max-w-xl gap-1">
            <p className="eyebrow text-fg/80">{hero.eyebrow}</p>
            <h2 id="now-playing-heading" className="text-4xl leading-tight font-bold tracking-tight text-fg text-balance sm:text-5xl">
              {hero.heading}
            </h2>
            {hero.title && <p className="mt-2 truncate text-xl font-semibold text-fg sm:text-2xl">{hero.title}</p>}
            {hero.subtitle && <p className="text-base text-fg/85 text-pretty sm:text-lg">{hero.subtitle}</p>}
          </div>

          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <HeroPrimaryControl action={action} onPrimary={onPrimary} />
              {status && (
                <p className={cn("flex items-center gap-2 text-sm font-medium sm:text-base", TONE_TEXT[status.tone])}>
                  {status.busy && <Spinner size="sm" decorative />}
                  <span>{status.text}</span>
                </p>
              )}
            </div>
            <PlaybackNotice {...props} />
            {snapshot.notice && <p className="max-w-xl text-sm text-fg/80 text-pretty">{snapshot.notice}</p>}
            {skipNote && <p className="max-w-xl text-sm text-fg/80 text-pretty">{skipNote}</p>}
          </div>
        </div>
      </CoverImage>
    </section>
  );
}
