"use client";

import { useState } from "react";
import { ListMusic } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { ComingUpCard } from "./ComingUpCard";
import { GenreGrid } from "./GenreGrid";
import { useFlagPreference, usePlayerShortcuts } from "./hooks";
import { shortcutsPreference } from "./local-preference";
import { NowPlayingHero } from "./NowPlayingHero";
import { usePlayer } from "./PlayerProvider";
import {
  SESSION_EXPIRED_LOGIN_PATH,
  comingUpEmptyText,
  getPrimaryAction,
  hasPlayableGenre,
  isAudioActive,
  pickVoiceClip,
  playGenre,
  runPrimaryAction,
  stationVoiceCountdown,
} from "./player-view";
import { StationVoiceCard } from "./StationVoiceCard";
import { useVoicePreview } from "./use-voice-preview";
import { VenueAccountMenu } from "./VenueAccountMenu";
import { radioPlaybackKey } from "./voice-preview";

const GENRES_ID = "genres";

/**
 * The venue's radio (/radio, screens 03/04), rendered over the player context: station heading,
 * the now-playing hero, "Your station voice", "Coming up" and the genre grid. Every control calls
 * the engine synchronously from its click/keydown handler so play() stays inside the gesture.
 */
export function RadioScreen() {
  const { snapshot, commands, bootstrap, signOut, signAnnouncement } = usePlayer();
  const { business, genres, announcements } = bootstrap;
  const [shortcutsEnabled] = useFlagPreference(shortcutsPreference);
  const [signingIn, setSigningIn] = useState(false);

  const canStart = hasPlayableGenre(genres);
  const hasGenres = genres.length > 0;
  const genre = genres.find((item) => item.id === snapshot.genreId) ?? null;
  const action = getPrimaryAction(snapshot, canStart);
  const clip = pickVoiceClip(announcements);
  const hasRotation = announcements.some((item) => item.placement === "rotation" || item.placement === "both");

  const preview = useVoicePreview({
    signAnnouncement,
    commands,
    radioActive: isAudioActive(snapshot.status),
    radioKey: radioPlaybackKey(snapshot),
    volume: snapshot.volume,
    muted: snapshot.muted,
    announcementVolume: business.announcementVolume,
  });

  usePlayerShortcuts(shortcutsEnabled, (shortcut) => {
    switch (shortcut) {
      case "toggle":
        if (action.disabled || action.kind === "none") return false;
        runPrimaryAction(commands, action.kind);
        return true;
      case "mute":
        commands.setMuted(!snapshot.muted);
        return true;
      case "skip":
        // Music only: N does nothing while the station voice plays (the Skip button says why).
        if (!snapshot.canSkip) return false;
        commands.skip();
        return true;
    }
  });

  const signInAgain = () => {
    setSigningIn(true);
    void signOut({ destination: SESSION_EXPIRED_LOGIN_PATH });
  };

  return (
    <div className="grid gap-6 lg:gap-8">
      <header className="flex items-start justify-between gap-6">
        <div className="grid min-w-0 gap-1.5">
          <p className="eyebrow text-fg-muted">Your station</p>
          <h1 id="station-name" className="page-title text-fg">
            {business.stationName}
          </h1>
          <p className="text-base text-fg-muted text-pretty sm:text-lg">Choose the sound for your space.</p>
        </div>
        {/* Phones and tablets have the same menu in the top bar. */}
        <div className="hidden shrink-0 lg:block">
          <VenueAccountMenu name={business.name} logoUrl={business.logoUrl} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(19rem,1fr)] lg:gap-6">
        <NowPlayingHero
          snapshot={snapshot}
          genre={genre}
          stationName={business.stationName}
          hasGenres={hasGenres}
          canStart={canStart}
          action={action}
          onPrimary={() => runPrimaryAction(commands, action.kind)}
          onRetry={commands.retry}
          onSignIn={signInAgain}
          signingIn={signingIn}
          genresAnchor={`#${GENRES_ID}`}
        />
        <div className="grid content-start gap-4 md:grid-cols-2 lg:grid-cols-1">
          <StationVoiceCard
            clip={clip}
            hasRotation={hasRotation}
            everyNTracks={business.announcementEveryNTracks}
            preview={preview.view}
            onPreview={() => {
              if (clip) preview.start(clip.id);
            }}
            onStop={preview.stop}
            onResumeRadio={preview.resumeRadio}
            onDismiss={preview.dismiss}
          />
          <ComingUpCard
            upcoming={snapshot.upcoming}
            genre={genre}
            emptyText={comingUpEmptyText(snapshot)}
            voiceNote={hasRotation ? stationVoiceCountdown(snapshot) : null}
          />
        </div>
      </div>

      <section id={GENRES_ID} aria-labelledby="genres-title" className="grid gap-4">
        <h2 id="genres-title" className="section-title text-fg">
          Find your atmosphere
        </h2>
        {hasGenres ? (
          <GenreGrid
            genres={genres}
            snapshot={snapshot}
            onSelect={commands.selectGenre}
            onPlay={(genreId) => playGenre(commands, snapshot, genreId)}
          />
        ) : (
          <EmptyState
            icon={<ListMusic />}
            title="No genres to choose from yet"
            description={`No genres have been assigned to ${business.name} yet. Once your administrator adds them, reload this page and choose the sound for your space.`}
          />
        )}
      </section>
    </div>
  );
}
