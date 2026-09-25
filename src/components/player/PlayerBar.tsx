"use client";

import { useRef, useState } from "react";
import { SkipForward, SlidersHorizontal } from "lucide-react";
import { EqualizerBars } from "@/components/brand";
import { CoverImage, Drawer, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { PrimaryActionIcon } from "./PrimaryActionIcon";
import { usePlayer } from "./PlayerProvider";
import {
  describeBarItem,
  getPrimaryAction,
  hasPlayableGenre,
  liveStatusText,
  runPrimaryAction,
  skipUnavailableReason,
} from "./player-view";
import { TrackProgress } from "./TrackProgress";
import { VolumeControl } from "./VolumeControl";

/**
 * Unavailable controls use aria-disabled, not `disabled`, so they keep keyboard focus when the
 * state changes under them (e.g. Skip while a song gives way to the station voice) and can still
 * explain themselves. These classes dim them and cancel the hover look.
 */
const UNAVAILABLE = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const UNAVAILABLE_GHOST = `${UNAVAILABLE} aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-muted aria-disabled:active:bg-transparent`;
const UNAVAILABLE_PRIMARY = `${UNAVAILABLE} aria-disabled:pointer-events-none`;

/**
 * The persistent bottom player (screens 03/04) on every venue page, including /radio. It controls
 * the same engine as the big button: artwork, title/artist (or the announcement label), Play/Pause,
 * Skip, read-only progress and volume. There is deliberately no "previous" control. Skip applies to
 * music only: during the station voice it is unavailable and says so.
 *
 * It also hosts the player's single polite live region, so state changes are announced once, on any
 * venue page, and playback progress never is. Rendered as a card; <AppShell> supplies the gutter.
 */
export function PlayerBar() {
  const { snapshot, commands, bootstrap } = usePlayer();
  const { business, genres } = bootstrap;
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);

  const canStart = hasPlayableGenre(genres);
  const context = { hasGenres: genres.length > 0, canStart };
  const genre = genres.find((item) => item.id === snapshot.genreId) ?? null;
  const action = getPrimaryAction(snapshot, canStart);
  const item = describeBarItem(snapshot, { ...context, genre, stationName: business.stationName });
  const playing = snapshot.status === "playing";
  const busy = snapshot.status === "loading" || snapshot.status === "buffering";
  const showProgress = snapshot.current !== null || busy;
  // The title becomes the button's accessible description ("Skip is available during music.").
  const skipReason = skipUnavailableReason(snapshot);

  const volume = (
    <VolumeControl
      volume={snapshot.volume}
      muted={snapshot.muted}
      controllable={snapshot.volumeControllable}
      onVolumeChange={commands.setVolume}
      onMutedChange={commands.setMuted}
      variant="compact"
    />
  );

  return (
    <section aria-label="Radio player" className="rounded-card border border-border bg-surface shadow-overlay">
      <p role="status" className="sr-only">
        {liveStatusText(snapshot, context)}
      </p>

      <div className="flex items-center gap-2.5 p-2.5 sm:gap-4 sm:p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-6 lg:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <CoverImage
            src={genre?.coverUrl}
            artworkKey={genre?.slug ?? null}
            sizes="64px"
            className="size-12 shrink-0 rounded-control sm:size-14 lg:size-16"
          />
          <div className="grid min-w-0 gap-0.5">
            <p className="flex min-w-0 items-center gap-2 font-semibold text-fg">
              {playing && <EqualizerBars playing size="sm" />}
              <span className="truncate">{item.title}</span>
            </p>
            <p className={cn("truncate text-sm", snapshot.status === "error" ? "text-danger" : "text-fg-muted")}>{item.subtitle}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <div className="flex items-center gap-1 sm:gap-3">
            <IconButton
              aria-label={action.label}
              variant="primary"
              size="lg"
              round
              icon={<PrimaryActionIcon kind={action.kind} />}
              aria-disabled={action.disabled || undefined}
              onClick={() => {
                if (!action.disabled) runPrimaryAction(commands, action.kind);
              }}
              className={UNAVAILABLE_PRIMARY}
            />
            <IconButton
              aria-label="Skip"
              title={skipReason ?? undefined}
              variant="ghost"
              size="md"
              round
              icon={<SkipForward fill="currentColor" />}
              aria-disabled={snapshot.canSkip ? undefined : true}
              onClick={() => {
                if (snapshot.canSkip) commands.skip();
              }}
              className={UNAVAILABLE_GHOST}
            />
          </div>
          {showProgress && (
            <TrackProgress
              positionSeconds={snapshot.positionSeconds}
              durationSeconds={snapshot.durationSeconds}
              loading={busy && snapshot.current === null}
              className="hidden w-full max-w-xl lg:flex"
            />
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end">
          <div className="hidden sm:block">{volume}</div>
          <IconButton
            ref={volumeButtonRef}
            aria-label="Volume"
            aria-haspopup="dialog"
            variant="ghost"
            size="md"
            icon={<SlidersHorizontal />}
            onClick={() => setVolumeOpen(true)}
            className="sm:hidden"
          />
        </div>
      </div>

      {showProgress && (
        <TrackProgress
          positionSeconds={snapshot.positionSeconds}
          durationSeconds={snapshot.durationSeconds}
          loading={busy && snapshot.current === null}
          className="px-3 pb-2.5 lg:hidden"
        />
      )}

      <Drawer
        open={volumeOpen}
        onClose={() => setVolumeOpen(false)}
        title="Volume"
        description={`Sets the radio's volume on this device. ${business.stationName} keeps playing.`}
        side="bottom"
        returnFocusRef={volumeButtonRef}
      >
        <VolumeControl
          volume={snapshot.volume}
          muted={snapshot.muted}
          controllable={snapshot.volumeControllable}
          onVolumeChange={commands.setVolume}
          onMutedChange={commands.setMuted}
          className="py-2"
        />
      </Drawer>
    </section>
  );
}
