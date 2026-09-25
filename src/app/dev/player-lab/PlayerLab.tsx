"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, FlaskConical, RotateCcw, Trash2 } from "lucide-react";
import { PlayerEngineStore } from "@/components/player/engine-store";
import { useFlagPreference, useScreenWakeLock } from "@/components/player/hooks";
import { keepAwakePreference } from "@/components/player/local-preference";
import { PlayerContextProvider, type PlayerContextValue } from "@/components/player/PlayerProvider";
import { createIdleSnapshot, isAudioActive } from "@/components/player/player-view";
import { RadioScreen } from "@/components/player/RadioScreen";
import { VenueAppShell } from "@/components/player/VenueAppShell";
import type { VenueLinks } from "@/components/player/venue-shell-context";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Switch,
} from "@/components/ui";
import { clearPlayerSessionState, createBrowserEngineDeps } from "@/lib/player/browser";
import { DEFAULT_ENGINE_TUNING, createPlayerEngine } from "@/lib/player/engine";
import type { EngineTuning, PlayerSnapshot } from "@/lib/player/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import {
  LAB_SHORT_URL_SECONDS,
  LAB_SLOW_LATENCY_MS,
  LabFaultStore,
  createLabPlayerApi,
  type LabFaultName,
  type LabFaults,
} from "./lab-api";
import { buildLabBootstrap, firstPlayableGenreId, type LabCatalog } from "./lab-catalog";
import { LabLogStore, formatLogDetail, type LabLogEntry, type LabLogSource } from "./lab-log";

type TuningPreset = "short" | "default";

interface LabSetup {
  businessKey: string;
  everyNTracks: number;
  tuning: TuningPreset;
}

/** Shortened timings so transitions, stalls and retries happen within seconds on ~30 s demo loops. */
const SHORT_TUNING: Partial<EngineTuning> = {
  trackListRefreshMs: 15_000,
  announcementRefreshMs: 20_000,
  stallReloadMs: 5_000,
  stallFailMs: 12_000,
  networkRetryDelaysMs: [1_000, 2_000, 4_000],
  preloadDelayMs: 2_000,
  playTimeoutMs: 8_000,
};

/** The lab page is the radio; Account and Help open the static dev previews of those pages. */
const LAB_LINKS: VenueLinks = {
  radio: "/dev/player-lab",
  account: "/dev/preview/radio/account",
  help: "/dev/preview/radio/help",
};

const MIN_EVERY_N = 1;
const MAX_EVERY_N = 10;

const FAULTS: readonly { name: LabFaultName; label: string; description: string }[] = [
  {
    name: "nextSignGone",
    label: "Next sign → 410",
    description: "One-shot: the next media sign request answers “gone”, as if the item was disabled.",
  },
  {
    name: "nextTrackBrokenUrl",
    label: "Next track URL → broken",
    description: "One-shot: the next signed track points at a missing file (media error, then a fresh URL).",
  },
  { name: "announcementsFail", label: "Announcements fail", description: "Announcement list and signing answer 500; music must continue." },
  { name: "offline", label: "API offline", description: "Every request fails like a dropped connection (network error with backoff)." },
  { name: "sessionExpired", label: "Session expired (401)", description: "Every request answers 401; the player must stop and ask to sign in." },
  { name: "slowApi", label: `Slow API (${LAB_SLOW_LATENCY_MS / 1000} s)`, description: "Every request is slow, to watch the loading states." },
  {
    name: "shortUrls",
    label: `Short-lived URLs (${LAB_SHORT_URL_SECONDS} s)`,
    description: "Signed URLs expire quickly (the dev audio route enforces it) to exercise re-signing.",
  },
];

const SOURCE_TONES: Record<LabLogSource, "info" | "accent" | "neutral"> = { engine: "accent", api: "info", lab: "neutral" };

function clampEveryN(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(MAX_EVERY_N, Math.max(MIN_EVERY_N, Math.round(value)));
}

function SnapshotView({ snapshot }: { snapshot: PlayerSnapshot }) {
  const rows: [string, string][] = [
    ["status", snapshot.status],
    ["errorCode", String(snapshot.errorCode)],
    ["message", String(snapshot.message)],
    ["notice", String(snapshot.notice)],
    [
      "current",
      snapshot.current ? `${snapshot.current.kind}: ${snapshot.current.kind === "track" ? snapshot.current.title : snapshot.current.label}` : "null",
    ],
    ["position", `${formatDuration(snapshot.positionSeconds)} / ${formatDuration(snapshot.durationSeconds)}`],
    ["genreId", String(snapshot.genreId)],
    ["volume / muted", `${Math.round(snapshot.volume * 100)}% / ${snapshot.muted}`],
    ["hasStarted", String(snapshot.hasStarted)],
    ["tracksSinceAnnouncement", String(snapshot.tracksSinceAnnouncement)],
    ["tracksUntilAnnouncement", String(snapshot.tracksUntilAnnouncement)],
    ["upcoming", snapshot.upcoming.map((track) => track.title).join(", ") || "[]"],
    ["canSkip", String(snapshot.canSkip)],
    ["announcementInProgress", String(snapshot.announcementInProgress)],
    ["volumeControllable", String(snapshot.volumeControllable)],
  ];
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-mono text-xs leading-5 text-fg-subtle">{label}</dt>
            <dd className="font-mono text-xs leading-5 break-words text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-control border border-border bg-surface-2 p-3">
        <summary className="cursor-pointer text-sm text-fg-muted">Raw snapshot JSON</summary>
        <pre className="mt-2 overflow-x-auto font-mono text-xs text-fg">{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}

function EventLog({ entries, onClear }: { entries: readonly LabLogEntry[]; onClear(): void }) {
  const newestFirst = [...entries].reverse();
  return (
    <Card>
      <CardHeader
        actions={
          <Button variant="ghost" size="sm" icon={<Trash2 aria-hidden="true" />} onClick={onClear}>
            Clear
          </Button>
        }
      >
        <CardTitle as="h3">Event log</CardTitle>
        <CardDescription>Engine log hook, fake API calls and lab actions, newest first ({entries.length} kept).</CardDescription>
      </CardHeader>
      <CardContent>
        {newestFirst.length === 0 ? (
          <p className="text-sm text-fg-muted">No events yet.</p>
        ) : (
          <ol aria-label="Event log entries" className="grid max-h-[28rem] gap-1 overflow-y-auto pr-1">
            {newestFirst.map((entry) => (
              <li
                key={entry.seq}
                className={cn(
                  "grid gap-0.5 rounded-md px-2 py-1.5 font-mono text-xs",
                  entry.event === "fatal" || entry.detail?.outcome === "error" ? "bg-danger/10" : "bg-surface-2/60",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-fg-subtle tabular-nums">+{(entry.elapsedMs / 1000).toFixed(1)}s</span>
                  <Badge tone={SOURCE_TONES[entry.source]}>{entry.source}</Badge>
                  <span className="text-fg">{entry.event}</span>
                </span>
                {entry.detail && <span className="break-words text-fg-muted">{formatLogDetail(entry.detail)}</span>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

interface LabControlsProps {
  catalog: LabCatalog;
  draft: LabSetup;
  setup: LabSetup;
  onDraftChange(next: LabSetup): void;
  onApply(): void;
  faults: Readonly<LabFaults>;
  onFaultChange(name: LabFaultName, value: boolean): void;
  onFaultsReset(): void;
  snapshot: PlayerSnapshot;
  entries: readonly LabLogEntry[];
  onClearLog(): void;
}

/** The collapsible diagnostics panel: engine setup, fault injection, live snapshot and event log. */
function LabControls(props: LabControlsProps) {
  const { catalog, draft, setup, onDraftChange, onApply, faults, snapshot, entries } = props;
  const business = catalog.businesses.find((item) => item.key === setup.businessKey) ?? catalog.businesses[0] ?? null;
  const tuning = setup.tuning === "short" ? { ...DEFAULT_ENGINE_TUNING, ...SHORT_TUNING } : DEFAULT_ENGINE_TUNING;
  const activeFaults = FAULTS.filter((fault) => faults[fault.name]).length;

  return (
    <details className="group mb-6 rounded-card border border-warning/30 bg-surface lg:mb-8">
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-card px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <FlaskConical aria-hidden="true" className="size-5 shrink-0 text-accent-text" />
        <span className="font-semibold text-fg">Player lab</span>
        <Badge tone="warning" dot>
          Development only
        </Badge>
        <span className="text-sm text-fg-muted">
          Synthetic audio · engine: {snapshot.status}
          {activeFaults > 0 && ` · ${activeFaults} fault${activeFaults === 1 ? "" : "s"} on`}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm text-fg-muted">
          <span className="hidden sm:inline">Setup, faults, snapshot and log</span>
          <ChevronDown aria-hidden="true" className="size-5 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="grid gap-6 border-t border-border p-4 sm:p-5">
        <Alert
          tone="info"
          title="Synthetic test audio"
          description={`${catalog.notice} Audio is served by /api/dev/audio/[id]; the API is simulated in this browser tab. Account and Help open their static previews.`}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="grid content-start gap-6">
            <Card variant="inset">
              <CardHeader>
                <CardTitle as="h3">Engine setup</CardTitle>
                <CardDescription>
                  Applying creates a fresh engine (the old one is destroyed) and resets the welcome announcement for this tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Demo venue">
                    <Select value={draft.businessKey} onChange={(event) => onDraftChange({ ...draft, businessKey: event.currentTarget.value })}>
                      {catalog.businesses.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.name} ({item.announcements.length} announcements)
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Announcement every N tracks" hint={`${MIN_EVERY_N}–${MAX_EVERY_N}`}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={MIN_EVERY_N}
                      max={MAX_EVERY_N}
                      value={String(draft.everyNTracks)}
                      onChange={(event) => onDraftChange({ ...draft, everyNTracks: clampEveryN(Number(event.currentTarget.value)) })}
                    />
                  </Field>
                  <Field label="Timings">
                    <Select
                      value={draft.tuning}
                      onChange={(event) => onDraftChange({ ...draft, tuning: event.currentTarget.value === "default" ? "default" : "short" })}
                    >
                      <option value="short">Shortened (lab)</option>
                      <option value="default">Production defaults</option>
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button icon={<RotateCcw aria-hidden="true" />} onClick={onApply}>
                    Apply &amp; restart engine
                  </Button>
                  <p className="text-sm text-fg-muted">
                    Running: {business?.name ?? "—"}, every {setup.everyNTracks} track{setup.everyNTracks === 1 ? "" : "s"},{" "}
                    {setup.tuning === "short" ? "shortened" : "default"} timings (preload {tuning.preloadDelayMs / 1000} s, stall reload{" "}
                    {tuning.stallReloadMs / 1000} s / fail {tuning.stallFailMs / 1000} s, play timeout {tuning.playTimeoutMs / 1000} s).
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card variant="inset">
              <CardHeader
                actions={
                  <Button variant="ghost" size="sm" onClick={props.onFaultsReset}>
                    Clear all faults
                  </Button>
                }
              >
                <CardTitle as="h3">Fault injection</CardTitle>
                <CardDescription>Takes effect on the next request. One-shot faults switch themselves off once used.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {FAULTS.map((fault) => (
                  <Switch
                    key={fault.name}
                    label={fault.label}
                    description={fault.description}
                    checked={faults[fault.name]}
                    onCheckedChange={(checked) => props.onFaultChange(fault.name, checked)}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid content-start gap-6">
            <Card variant="inset">
              <CardHeader>
                <CardTitle as="h3">Live snapshot</CardTitle>
                <CardDescription>engine.getSnapshot(), as React receives it.</CardDescription>
              </CardHeader>
              <CardContent>
                <SnapshotView snapshot={snapshot} />
              </CardContent>
            </Card>
            <EventLog entries={entries} onClear={props.onClearLog} />
          </div>
        </div>
      </div>
    </details>
  );
}

/**
 * /dev/player-lab: the real venue radio (VenueAppShell + RadioScreen + player bar) driven by the
 * real PlayerEngine with browser audio, against an in-browser fake API and the synthetic demo audio,
 * plus the collapsible fault-injection and diagnostics panel. Needs no Supabase.
 */
export function PlayerLab({ catalog }: { catalog: LabCatalog }) {
  const initialGenreId = firstPlayableGenreId(catalog);
  const [draft, setDraft] = useState<LabSetup>(() => ({
    businessKey: catalog.businesses[0]?.key ?? "emeraldbar",
    everyNTracks: 2,
    tuning: "short",
  }));
  // A new object identity (from Apply) recreates the engine.
  const [setup, setSetup] = useState<LabSetup>(draft);
  const [lab] = useState(() => ({
    store: new PlayerEngineStore(createIdleSnapshot({ genreId: initialGenreId, volume: 0.8, muted: false })),
    faults: new LabFaultStore(),
    log: new LabLogStore(),
  }));
  const { store, faults: faultStore, log } = lab;

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const faults = useSyncExternalStore(faultStore.subscribe, faultStore.getSnapshot, faultStore.getSnapshot);
  const entries = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);

  const bootstrap = useMemo(
    () => buildLabBootstrap(catalog, { businessKey: setup.businessKey, everyNTracks: setup.everyNTracks }),
    [catalog, setup],
  );
  // Creating the fake API has no side effects; the engine and the voice preview share it (and its faults).
  const api = useMemo(
    () =>
      createLabPlayerApi({
        catalog,
        businessKey: setup.businessKey,
        everyNTracks: setup.everyNTracks,
        faults: faultStore,
        log: (event, detail) => log.push("api", event, detail),
      }),
    [catalog, faultStore, log, setup],
  );

  useEffect(() => {
    const engine = createPlayerEngine(
      createBrowserEngineDeps({ api, log: (event, detail) => log.push("engine", event, detail) }),
      {
        userId: bootstrap.userId,
        businessId: bootstrap.business.id,
        stationName: bootstrap.business.stationName,
        businessName: bootstrap.business.name,
        logoUrl: null,
        initialGenreId: bootstrap.preferences.genreId,
        initialVolume: bootstrap.preferences.volume,
        initialMuted: bootstrap.preferences.muted,
        announcementEveryNTracks: bootstrap.business.announcementEveryNTracks,
        announcementVolume: bootstrap.business.announcementVolume,
      },
      setup.tuning === "short" ? SHORT_TUNING : undefined,
    );
    let last = engine.getSnapshot();
    const unsubscribe = engine.subscribe(() => {
      const next = engine.getSnapshot();
      if (next.status !== last.status || next.errorCode !== last.errorCode || next.current !== last.current) {
        log.push("lab", "snapshot", {
          status: next.status,
          errorCode: next.errorCode ?? undefined,
          current: next.current ? `${next.current.kind}:${next.current.id}` : undefined,
        });
      }
      last = next;
    });
    log.push("lab", "engine.created", {
      business: bootstrap.business.name,
      everyNTracks: setup.everyNTracks,
      tuning: setup.tuning,
      announcements: bootstrap.announcements.length,
    });
    store.attach(engine);
    return () => {
      unsubscribe();
      store.detach(engine);
      engine.destroy();
      log.push("lab", "engine.destroyed");
    };
  }, [api, bootstrap, log, setup, store]);

  const [keepAwake, setKeepAwake] = useFlagPreference(keepAwakePreference);
  const wakeLock = useScreenWakeLock(keepAwake && isAudioActive(snapshot.status));

  const value: PlayerContextValue = {
    snapshot,
    commands: store.commands,
    bootstrap,
    signOut: async () => {
      // The lab has no session; the button only proves the wiring.
      log.push("lab", "signOut.simulated");
    },
    wakeLock: { ...wakeLock, enabled: keepAwake, setEnabled: setKeepAwake },
    signAnnouncement: (id, signal) => api.signMedia({ kind: "announcement", id }, signal),
  };

  return (
    <PlayerContextProvider value={value}>
      <VenueAppShell business={bootstrap.business} email="lab-user@example.com" links={LAB_LINKS}>
        <LabControls
          catalog={catalog}
          draft={draft}
          setup={setup}
          onDraftChange={setDraft}
          onApply={() => {
            // destroy() keeps the welcome-played flag (as in a real session); the lab wants it back.
            clearPlayerSessionState();
            setSetup({ ...draft });
          }}
          faults={faults}
          onFaultChange={(name, checked) => {
            faultStore.set(name, checked);
            log.push("lab", checked ? "fault.on" : "fault.off", { fault: name });
          }}
          onFaultsReset={faultStore.reset}
          snapshot={snapshot}
          entries={entries}
          onClearLog={log.clear}
        />
        <RadioScreen />
      </VenueAppShell>
    </PlayerContextProvider>
  );
}
