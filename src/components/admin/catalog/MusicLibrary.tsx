"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Music, Plus, SearchX } from "lucide-react";
import { useConfirmDiscard, useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { PageHeading } from "@/components/shell/PageHeading";
import { Alert, Button, ButtonLink, Card, Drawer, EmptyState, Select, Tabs, useToast, type TabItem } from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import type { AdminTrack } from "@/lib/api/contracts";
import { useUploadQueue } from "@/lib/uploads/use-upload-queue";
import { isActivePhase, type UploadQueueItem } from "@/lib/uploads/queue";
import { cn } from "@/lib/utils/cn";
import { AUDIO_ACCEPT, checkUploadFile } from "@/lib/validation/limits";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import { CatalogApiError } from "./api";
import { BulkActionBar, type BulkActionKind } from "./BulkActionBar";
import { callAction } from "./call-action";
import { DEFAULT_CATALOG_SERVICES, type CatalogServices, type MusicActions } from "./services";
import { TrackEditor, type TrackPreviewState } from "./TrackEditor";
import { TrackFilters } from "./TrackFilters";
import {
  isTrackDraftDirty,
  pruneSelection,
  toggleSelection,
  trackDraftFormData,
  trackDraftFromTrack,
  uploadsInProgressMessage,
  type TrackDraft,
} from "./track-helpers";
import {
  countForStatus,
  DEFAULT_TRACK_QUERY,
  hasActiveFilters,
  MUSIC_PATH,
  NO_GENRE,
  TRACK_SORT_LABELS,
  TRACK_SORTS,
  TRACK_STATUS_LABELS,
  trackListHref,
  type TrackListQuery,
  type TrackSort,
} from "./track-query";
import { TrackPagination } from "./TrackPagination";
import { TrackReplaceDialog } from "./TrackReplaceDialog";
import { TrackTable, type TrackRowIntent } from "./TrackTable";
import type { GenreOption, TrackPage } from "./types";
import { UploadQueuePanel } from "./UploadQueuePanel";
import { DESKTOP_MEDIA_QUERY, isDesktopViewport, useMediaQuery } from "./use-media-query";

export interface MusicLibraryProps {
  query: TrackListQuery;
  /** Every genre in display order (with signed covers). */
  genres: GenreOption[];
  page: TrackPage;
  /** The ?genre= link pointed at a genre that no longer exists (the filter was dropped). */
  unknownGenre?: boolean;
  actions: MusicActions;
  /** Upload and preview calls; defaults to the real route handlers. */
  services?: CatalogServices;
  /** Route of this screen (default /admin/music); a development preview passes its own. */
  basePath?: string;
  /** Where "Create a genre" links (default /admin/genres). */
  genresPath?: string;
}

type LibraryTab = "tracks" | "uploads";

/** The "Selected track" editor: a snapshot of the track and the draft being edited. */
interface EditorState {
  track: AdminTrack | null;
  /** syncKey() of `track` when the draft was (re)based on it. */
  key: string | null;
  baseline: TrackDraft;
  values: TrackDraft;
}

type Confirmation =
  | { kind: "remove"; track: AdminTrack }
  | { kind: "delete"; track: AdminTrack }
  | { kind: "bulk-remove"; ids: string[] };

const EMPTY_DRAFT: TrackDraft = { title: "", artist: "", genreIds: [] };
/** Wait this long after an upload finishes before refreshing, so a batch refreshes once. */
const REFRESH_DELAY_MS = 800;

function syncKey(track: AdminTrack): string {
  return [track.id, track.updatedAt, track.title, track.artist, [...track.genreIds].sort().join(",")].join("|");
}

function editorFor(track: AdminTrack | null, genres: readonly GenreOption[]): EditorState {
  if (!track) return { track: null, key: null, baseline: EMPTY_DRAFT, values: EMPTY_DRAFT };
  const draft = trackDraftFromTrack(track, genres);
  return { track, key: syncKey(track), baseline: draft, values: draft };
}

function uploadedTrack(item: UploadQueueItem): AdminTrack | null {
  return item.result && (item.result.kind === "track" || item.result.kind === "track-replace") ? item.result.track : null;
}

function isSort(value: string): value is TrackSort {
  return (TRACK_SORTS as readonly string[]).includes(value);
}

function describeView(query: TrackListQuery, genres: readonly GenreOption[]): string {
  const parts = [`Tracks: ${TRACK_STATUS_LABELS[query.status]}`];
  if (query.genre === NO_GENRE) parts.push("without a genre");
  else if (query.genre) parts.push(`in ${genres.find((genre) => genre.id === query.genre)?.name ?? "the selected genre"}`);
  if (query.q) parts.push(`matching “${query.q}”`);
  parts.push(TRACK_SORT_LABELS[query.sort].toLowerCase());
  return parts.join(", ");
}

/**
 * /admin/music (screen 05): the shared catalogue with filters, a selectable table with bulk actions
 * and "…" menus, the "Selected track" editor (sticky right column from 1024px, a drawer below), and
 * the upload queue ("+ Upload music" opens the file picker). Props-driven: the page passes data loaded
 * on the server and the Server Actions; /dev/preview/music passes fixtures and no-op actions.
 */
export function MusicLibrary({
  query,
  genres,
  page,
  unknownGenre = false,
  actions,
  services = DEFAULT_CATALOG_SERVICES,
  basePath = MUSIC_PATH,
  genresPath = "/admin/genres",
}: MusicLibraryProps) {
  const router = useRouter();
  const toast = useToast();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [navigating, startNavigation] = useTransition();
  const [, startRowAction] = useTransition();
  const [saving, startSaving] = useTransition();
  const [tab, setTab] = useState<LibraryTab>("tracks");
  const [notice, setNotice] = useState("");

  // --- Uploads ---------------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const refreshTimer = useRef<number | null>(null);
  const handleUploaded = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DELAY_MS);
  }, [router]);
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );
  const queue = useUploadQueue({ onUploaded: handleUploaded, upload: services.upload });
  // "Manage tracks" of a genre opens this page filtered to it: new uploads go there by default.
  const [uploadGenreIds, setUploadGenreIds] = useState<string[]>(() =>
    query.genre && genres.some((genre) => genre.id === query.genre) ? [query.genre] : [],
  );
  const knownUploadGenreIds = uploadGenreIds.filter((id) => genres.some((genre) => genre.id === id));
  const uploadedTracks = queue.items.map(uploadedTrack).filter((track): track is AdminTrack => track !== null);
  const activeUploads = queue.items.filter((item) => item.phase === "queued" || isActivePhase(item.phase)).length;

  // --- Selected track editor -------------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(page.tracks[0]?.id ?? null);
  const [editor, setEditor] = useState<EditorState>(() => editorFor(page.tracks[0] ?? null, genres));
  const [saveError, setSaveError] = useState<ActionState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preview, setPreview] = useState<TrackPreviewState | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const listed = selectedId
    ? (page.tracks.find((track) => track.id === selectedId) ?? uploadedTracks.find((track) => track.id === selectedId))
    : undefined;
  const editorDirty = editor.track !== null && isTrackDraftDirty(editor.values, editor.baseline);
  // A track with unsaved edits stays in the editor even when it leaves the list (another filter or
  // page); otherwise the editor follows the list.
  const keepSnapshot = !listed && editorDirty && editor.track?.id === selectedId;
  const panelTrack: AdminTrack | null = listed ?? (keepSnapshot ? editor.track : (page.tracks[0] ?? null));
  const panelKey = panelTrack ? syncKey(panelTrack) : null;
  if (panelKey !== editor.key) {
    // Fresh data arrived (a save, an upload, another admin) or the track changed: re-base the draft,
    // unless it holds unsaved edits of this very track.
    if (!panelTrack || editor.track?.id !== panelTrack.id || !editorDirty) setEditor(editorFor(panelTrack, genres));
    else setEditor({ ...editor, key: panelKey, track: panelTrack });
  }
  const dirty = panelTrack !== null && editor.track?.id === panelTrack.id && editorDirty;
  const notListed = panelTrack !== null && !page.tracks.some((track) => track.id === panelTrack.id);

  useEffect(() => {
    if (focusRequest > 0) titleInputRef.current?.focus();
  }, [focusRequest]);

  // A finished bulk action removes the bulk bar (and the focused button with it): continue from the list.
  const resultsRef = useRef<HTMLDivElement>(null);
  const [resultsFocusRequest, setResultsFocusRequest] = useState(0);
  useEffect(() => {
    if (resultsFocusRequest > 0) resultsRef.current?.focus();
  }, [resultsFocusRequest]);

  useEffect(() => () => previewRequest.current?.abort(), []);

  // Leaving the page (any link, reload, closing the tab) asks first while track edits are unsaved or
  // uploads are still running: unmounting stops the upload queue. Paging and filtering stay on this
  // screen and keep both, so they are not guarded.
  const unsavedTrackMessage = editor.track ? `Your edits to “${editor.track.title}” haven’t been saved.` : undefined;
  useUnsavedChangesGuard(dirty, { message: unsavedTrackMessage });
  useUnsavedChangesGuard(queue.busy, { message: queue.busy ? uploadsInProgressMessage(activeUploads) : undefined });
  const confirmDiscard = useConfirmDiscard();

  // --- Bulk selection and dialogs ---------------------------------------------
  const visibleIds = page.tracks.map((track) => track.id);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const checked = pruneSelection(checkedIds, visibleIds);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkPending, setBulkPending] = useState<BulkActionKind | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmKey, setConfirmKey] = useState(0);
  const [replace, setReplace] = useState<{ track: AdminTrack; open: boolean; key: number } | null>(null);

  // ---------------------------------------------------------------------------

  function navigate(patch: Partial<TrackListQuery>) {
    const href = trackListHref(query, patch, basePath) as Route;
    setCheckedIds([]);
    startNavigation(() => router.push(href, { scroll: false }));
  }

  function openConfirmation(next: Confirmation) {
    setConfirmKey((key) => key + 1);
    setConfirmation(next);
  }

  function stopPreview() {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreview(null);
  }

  function loadPreview(track: AdminTrack) {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreview({ status: "loading", trackId: track.id });
    services.previewTrack(track.id, controller.signal).then(
      (response) => {
        if (previewRequest.current !== controller) return;
        setPreview({ status: "ready", trackId: track.id, url: response.url });
      },
      (error: unknown) => {
        if (previewRequest.current !== controller || controller.signal.aborted) return;
        setPreview({
          status: "error",
          trackId: track.id,
          message: error instanceof CatalogApiError ? error.message : "The preview couldn't be loaded. Please try again.",
        });
      },
    );
  }

  /** Opens a track in the editor (drawer below 1024px); asks before dropping unsaved edits. */
  function openTrack(track: AdminTrack, intent: TrackRowIntent) {
    const switching = track.id !== panelTrack?.id;
    const proceed = () => {
      if (switching) {
        setSelectedId(track.id);
        setEditor(editorFor(track, genres));
        setSaveError(null);
        stopPreview();
      }
      if (!isDesktopViewport()) setDrawerOpen(true);
      else if (intent === "edit") setFocusRequest((count) => count + 1);
      if (intent === "preview") loadPreview(track);
    };
    if (!switching || !dirty) {
      proceed();
      return;
    }
    void confirmDiscard({ message: unsavedTrackMessage }).then((discard) => {
      if (discard) proceed();
    });
  }

  function saveTrack() {
    if (!panelTrack) return;
    const trackId = panelTrack.id;
    const values = editor.values;
    setSaveError(null);
    startSaving(async () => {
      const result = await callAction(() => actions.updateTrack(trackId, trackDraftFormData(values)));
      if (!result) return;
      if (result.ok) {
        setEditor((current) => (current.track?.id === trackId ? { ...current, baseline: values } : current));
        toast.success(result.message ?? "Saved.");
      } else {
        setSaveError(result);
      }
    });
  }

  function discardEdits() {
    setEditor((current) => ({ ...current, values: current.baseline }));
    setSaveError(null);
  }

  function markBusy(trackId: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(trackId);
      else next.delete(trackId);
      return next;
    });
  }

  function runRowAction(track: AdminTrack, run: () => Promise<ActionState>) {
    markBusy(track.id, true);
    startRowAction(async () => {
      const result = await callAction(run);
      markBusy(track.id, false);
      if (!result) return;
      if (result.ok) toast.success(result.message ?? "Saved.");
      else toast.error(`“${track.title}” wasn't changed`, { description: result.message ?? undefined });
    });
  }

  async function confirmAction(run: () => Promise<ActionState>, reportError: (message: string) => void, onDone?: () => void) {
    const result = await callAction(run);
    if (!result) return;
    if (result.ok) {
      setConfirmation(null);
      onDone?.();
      toast.success(result.message ?? "Done.");
    } else {
      reportError(result.message ?? "Something went wrong. Please try again.");
    }
  }

  function runBulk(kind: "activate" | "deactivate") {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBulkPending(kind);
    startRowAction(async () => {
      const result = await callAction(() => actions.setTracksActive(ids, kind === "activate"));
      setBulkPending(null);
      if (!result) return;
      if (result.ok) {
        setCheckedIds([]);
        setResultsFocusRequest((count) => count + 1);
        toast.success(result.message ?? "Saved.");
      } else {
        toast.error("The selected tracks weren't changed", { description: result.message ?? undefined });
      }
    });
  }

  function openReplace(track: AdminTrack) {
    setReplace((current) => ({ track, open: true, key: (current?.key ?? 0) + 1 }));
  }

  function closeReplace() {
    setReplace((current) => (current ? { ...current, open: false } : current));
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const genreIds = [...knownUploadGenreIds];
    queue.add(files.map((file) => ({ file, target: { kind: "track" as const }, metadata: genreIds.length > 0 ? { genreIds } : undefined })));
    const rejected = files.filter((file) => !checkUploadFile("track", file).ok).length;
    const added = files.length - rejected;
    setNotice(
      rejected === 0
        ? `${added === 1 ? "1 file" : `${added} files`} added to the upload queue.`
        : `${added} of ${files.length} files added to the upload queue; ${rejected} can’t be uploaded — see the reasons in the queue.`,
    );
    if (tab === "tracks") {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      queueHeadingRef.current?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    addFiles(Array.from(input.files ?? []));
    // Allow picking the same file again (e.g. after fixing a rejected upload).
    input.value = "";
  }

  // --- Library pane ------------------------------------------------------------

  const catalogueEmpty = !query.q && !query.genre && countForStatus("all", page.statusCounts) === 0;
  const pageOutOfRange = page.tracks.length === 0 && page.total > 0;
  const uploadButton = (
    <Button icon={<Plus aria-hidden="true" />} onClick={openFilePicker}>
      Upload music
    </Button>
  );

  let results;
  if (catalogueEmpty) {
    results = (
      <EmptyState
        icon={<Music />}
        title="No music available yet."
        description={
          genres.length === 0
            ? "Create a genre first, then upload MP3 files. Venues can play them as soon as they are checked."
            : "Upload MP3 files. They appear here as soon as the server has checked them — no website update needed."
        }
        action={
          <>
            {uploadButton}
            {genres.length === 0 && (
              <ButtonLink href={genresPath as Route} variant="secondary">
                Create a genre
              </ButtonLink>
            )}
          </>
        }
      />
    );
  } else if (pageOutOfRange) {
    results = (
      <EmptyState
        icon={<SearchX />}
        title="This page is empty"
        description="The list is shorter than it was. Go back to the first page."
        action={
          <Button variant="secondary" onClick={() => navigate({ page: 1 })}>
            First page
          </Button>
        }
      />
    );
  } else if (page.tracks.length === 0) {
    results = (
      <EmptyState
        icon={<SearchX />}
        title="No tracks match"
        description="Try another search, genre or status."
        action={
          hasActiveFilters(query) ? (
            <Button variant="secondary" onClick={() => navigate({ ...DEFAULT_TRACK_QUERY, sort: query.sort })}>
              Clear filters
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    results = (
      <TrackTable
        tracks={page.tracks}
        genres={genres}
        caption={describeView(query, genres)}
        selectedTrackId={panelTrack?.id ?? null}
        checkedIds={checked}
        busyTrackIds={busyIds}
        onCheckedChange={(trackId, isChecked) => setCheckedIds(toggleSelection(checked, trackId, isChecked))}
        onCheckAll={(isChecked) => setCheckedIds(isChecked ? visibleIds : [])}
        onOpen={openTrack}
        onReplace={openReplace}
        onSetActive={(track, active) => runRowAction(track, () => actions.setTrackActive(track.id, active))}
        onRemove={(track) => openConfirmation({ kind: "remove", track })}
        onRestore={(track) => runRowAction(track, () => actions.restoreTrack(track.id))}
        onDelete={(track) => openConfirmation({ kind: "delete", track })}
      />
    );
  }

  const libraryPane = (
    <div className="grid gap-4">
      {unknownGenre && <Alert tone="info" title="That genre no longer exists" description="Showing tracks from every genre instead." />}
      {!catalogueEmpty && <TrackFilters query={query} genres={genres} onChange={navigate} />}
      {checked.length > 0 && (
        <BulkActionBar
          count={checked.length}
          pending={bulkPending}
          onActivate={() => runBulk("activate")}
          onDeactivate={() => runBulk("deactivate")}
          onRemove={() => openConfirmation({ kind: "bulk-remove", ids: [...checked] })}
          onClear={() => {
            setCheckedIds([]);
            setResultsFocusRequest((count) => count + 1);
          }}
        />
      )}
      <div
        ref={resultsRef}
        tabIndex={-1}
        aria-busy={navigating || undefined}
        className={cn("min-w-0 rounded-card transition-opacity focus:outline-none", navigating && "opacity-60")}
      >
        {results}
      </div>
      {!catalogueEmpty && page.tracks.length > 0 && (
        <TrackPagination
          query={query}
          page={page}
          basePath={basePath}
          extra={
            <Select
              aria-label="Sort tracks"
              value={query.sort}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isSort(value)) navigate({ sort: value });
              }}
              className="w-44!"
            >
              {TRACK_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {TRACK_SORT_LABELS[sort]}
                </option>
              ))}
            </Select>
          }
        />
      )}
      <p className="sr-only" aria-live="polite">
        {navigating ? "Updating the list…" : ""}
      </p>
    </div>
  );

  const queueProps = {
    items: queue.items,
    genres,
    uploadGenreIds: knownUploadGenreIds,
    onUploadGenreIdsChange: setUploadGenreIds,
    onChooseFiles: openFilePicker,
    onFiles: addFiles,
    onCancel: (id: string) => void queue.cancel(id),
    onRetry: (id: string) => void queue.retry(id),
    onRemove: (id: string) => void queue.remove(id),
    onClearFinished: queue.clearFinished,
    onOpenUploaded: (track: AdminTrack) => openTrack(track, "edit"),
  };

  const tabs: TabItem[] = [
    { value: "tracks", label: "All tracks", content: libraryPane },
    {
      value: "uploads",
      label: (
        <>
          Uploads
          {activeUploads > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-text tabular-nums">
              {activeUploads}
              <span className="sr-only"> in progress</span>
            </span>
          )}
        </>
      ),
      content: <UploadQueuePanel variant="full" {...queueProps} />,
    },
  ];

  function previewSelected() {
    if (panelTrack) loadPreview(panelTrack);
  }

  function replaceSelected() {
    if (panelTrack) openReplace(panelTrack);
  }

  function previewFailed() {
    if (!panelTrack) return;
    setPreview({
      status: "error",
      trackId: panelTrack.id,
      message: "The audio couldn't be played. The link may have expired or the file is missing.",
    });
  }

  function changeDraft(values: TrackDraft) {
    setEditor((current) => ({ ...current, values }));
  }

  const confirmTrack = confirmation && (confirmation.kind === "remove" || confirmation.kind === "delete") ? confirmation.track : null;

  return (
    <>
      <PageHeading title="Music library" description="One catalogue. Every venue." actions={uploadButton} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={AUDIO_ACCEPT}
        onChange={handleFileInput}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Tabs
          label="Music library"
          value={tab}
          onValueChange={(value) => setTab(value === "uploads" ? "uploads" : "tracks")}
          items={tabs}
          className="min-w-0"
        />
        <Card
          role="region"
          aria-labelledby="selected-track-heading"
          className="hidden p-5 lg:sticky lg:top-6 lg:mt-16 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
        >
          <h2 id="selected-track-heading" className="section-title mb-4 font-bold text-fg">
            Selected track
          </h2>
          {panelTrack ? (
            <TrackEditor
              track={panelTrack}
              genres={genres}
              draft={editor.values}
              onDraftChange={changeDraft}
              dirty={dirty}
              saving={saving}
              error={saveError}
              onSave={saveTrack}
              onDiscard={discardEdits}
              onReplace={replaceSelected}
              preview={preview}
              onPreview={previewSelected}
              onStopPreview={stopPreview}
              onPreviewFailed={previewFailed}
              notListed={notListed}
              genresHref={genresPath}
              // Only the visible copy (this panel on desktop, the drawer below) may hold the audio player.
              allowAudio={isDesktop}
              titleInputRef={isDesktop ? titleInputRef : undefined}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              {catalogueEmpty ? "Uploaded tracks appear here so you can edit their details." : "Choose a track in the list to edit it."}
            </p>
          )}
        </Card>
      </div>

      {tab === "tracks" && <UploadQueuePanel variant="compact" headingRef={queueHeadingRef} className="mt-6" {...queueProps} />}

      <Drawer
        open={drawerOpen && !isDesktop && panelTrack !== null}
        onClose={() => setDrawerOpen(false)}
        title="Selected track"
        description={panelTrack ? `${panelTrack.title} · ${panelTrack.artist}` : undefined}
        size="lg"
      >
        {!isDesktop && panelTrack && (
          <TrackEditor
            track={panelTrack}
            genres={genres}
            draft={editor.values}
            onDraftChange={changeDraft}
            dirty={dirty}
            saving={saving}
            error={saveError}
            onSave={saveTrack}
            onDiscard={discardEdits}
            onReplace={replaceSelected}
            preview={preview}
            onPreview={previewSelected}
            onStopPreview={stopPreview}
            onPreviewFailed={previewFailed}
            notListed={notListed}
            genresHref={genresPath}
            allowAudio
          />
        )}
      </Drawer>

      {replace && (
        <TrackReplaceDialog
          key={`replace-${replace.key}`}
          open={replace.open}
          track={replace.track}
          upload={services.upload}
          onClose={closeReplace}
          onReplaced={() => {
            closeReplace();
            if (preview?.trackId === replace.track.id) stopPreview();
            toast.success(`New audio saved for “${replace.track.title}”.`);
            router.refresh();
          }}
        />
      )}

      <ActionConfirmDialog
        key={`remove-${confirmKey}`}
        open={confirmation?.kind === "remove"}
        title={confirmTrack ? `Remove “${confirmTrack.title}” from playback?` : "Remove from playback?"}
        confirmLabel="Remove from playback"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) =>
          confirmTrack ? confirmAction(() => actions.removeTrack(confirmTrack.id), reportError) : Promise.resolve()
        }
      >
        <ul className="grid list-disc gap-1.5 pl-5">
          <li>Venues won’t play it again — even where it is already queued, because players check every track before it starts.</li>
          <li>A venue hearing it right now finishes the song.</li>
          <li>The file and details are kept. You can restore it, or delete it permanently, from its “…” menu.</li>
        </ul>
      </ActionConfirmDialog>
      <ActionConfirmDialog
        key={`delete-${confirmKey}`}
        open={confirmation?.kind === "delete"}
        title={confirmTrack ? `Delete “${confirmTrack.title}” permanently?` : "Delete permanently?"}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) =>
          confirmTrack
            ? confirmAction(() => actions.deleteTrack(confirmTrack.id), reportError, () => setResultsFocusRequest((count) => count + 1))
            : Promise.resolve()
        }
      >
        <p>The audio file is deleted from storage and the track disappears from the catalogue and every genre. This can’t be undone.</p>
      </ActionConfirmDialog>
      <ActionConfirmDialog
        key={`bulk-${confirmKey}`}
        open={confirmation?.kind === "bulk-remove"}
        title={
          confirmation?.kind === "bulk-remove"
            ? `Remove ${confirmation.ids.length === 1 ? "1 track" : `${confirmation.ids.length} tracks`} from playback?`
            : "Remove from playback?"
        }
        confirmLabel="Remove from playback"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) => {
          if (confirmation?.kind !== "bulk-remove") return Promise.resolve();
          const ids = confirmation.ids;
          setBulkPending("remove");
          return confirmAction(() => actions.removeTracks(ids), reportError, () => {
            setCheckedIds([]);
            setResultsFocusRequest((count) => count + 1);
          }).finally(() => setBulkPending(null));
        }}
      >
        <p>Venues stop playing them from their next track on, even where they are already queued. Files and details are kept and each track can be restored from its “…” menu.</p>
      </ActionConfirmDialog>
    </>
  );
}
