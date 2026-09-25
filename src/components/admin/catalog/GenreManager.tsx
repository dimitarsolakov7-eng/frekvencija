"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, SearchX } from "lucide-react";
import { useConfirmDiscard, useUnsavedChangesGuard } from "@/components/admin/shell/unsaved-changes";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button, Card, Drawer, EmptyState, SearchInput, useToast } from "@/components/ui";
import type { ActionState } from "@/lib/actions/state";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import { callAction } from "./call-action";
import { GenreCard } from "./GenreCard";
import { GenreCoverField } from "./GenreCoverField";
import {
  EMPTY_GENRE_DRAFT,
  genreDraftFormData,
  genreDraftFromItem,
  isGenreDraftDirty,
  rebaseGenreDraft,
  type GenreDraft,
} from "./genre-draft";
import { applyOrder, genreMatchesSearch, moveInOrder, moveToIndex, type MoveDirection } from "./genre-helpers";
import { DEFAULT_CATALOG_SERVICES, type CatalogServices, type GenreActions } from "./services";
import { GenreEditor } from "./GenreEditor";
import { genreTracksHref, MUSIC_PATH } from "./track-query";
import type { AdminGenreItem, BusinessOption } from "./types";
import { DESKTOP_MEDIA_QUERY, isDesktopViewport, useMediaQuery } from "./use-media-query";

export interface GenreManagerProps {
  /** Genres in display order (with signed covers and track counts). */
  genres: AdminGenreItem[];
  businesses: BusinessOption[];
  actions: GenreActions;
  /** Upload calls; defaults to the real route handlers. */
  services?: CatalogServices;
  /** Route of the music library for "Manage tracks" (default /admin/music). */
  musicPath?: string;
  /** Where "Add a business" links in the business picker (default /admin/businesses). */
  businessesPath?: string;
}

type EditorMode = { kind: "edit"; id: string } | { kind: "create" };

interface EditorState {
  /** "create" or "edit:{id}". */
  modeKey: string;
  /** syncKey() of the genre the baseline came from ("create" for a new genre). */
  syncKey: string;
  baseline: GenreDraft;
  values: GenreDraft;
}

/** Changes shown before the server confirms them (useOptimistic). */
type OptimisticChange = { type: "order"; ids: string[] } | { type: "enabled"; id: string; value: boolean };

/**
 * Changes the server confirmed for a given `genres` prop. In the app the refreshed props already
 * contain them; they matter when the props do not change (the development preview).
 */
interface Confirmed {
  source: readonly AdminGenreItem[];
  order: string[] | null;
  enabled: Record<string, boolean>;
}

/** A just-uploaded or removed cover, shown until the props catch up (they still hold `previousPath`). */
interface CoverOverride {
  previousPath: string | null;
  path: string | null;
  url: string | null;
}

/** Drag in progress: the dragged genre, the card under the pointer, and the touch/pen pointer id. */
interface DragState {
  id: string;
  overId: string | null;
  pointerId: number | null;
}

type Confirmation =
  | { kind: "delete"; genre: AdminGenreItem }
  | { kind: "deactivate"; genre: AdminGenreItem }
  | { kind: "remove-cover"; genre: AdminGenreItem };

function applyChange(genres: AdminGenreItem[], change: OptimisticChange): AdminGenreItem[] {
  switch (change.type) {
    case "order":
      return applyOrder(genres, change.ids);
    case "enabled":
      return genres.map((genre) => (genre.id === change.id ? { ...genre, isEnabled: change.value } : genre));
  }
}

function syncKey(genre: AdminGenreItem): string {
  return [genre.id, genre.name, genre.slug, genre.description ?? "", genre.isEnabled, genre.availableToAll, [...genre.accessBusinessIds].sort().join(",")].join("|");
}

function editorStateFor(mode: EditorMode, genre: AdminGenreItem | null, businesses: readonly BusinessOption[]): EditorState {
  if (mode.kind === "create" || !genre) {
    return { modeKey: "create", syncKey: "create", baseline: EMPTY_GENRE_DRAFT, values: EMPTY_GENRE_DRAFT };
  }
  const draft = genreDraftFromItem(genre, businesses);
  return { modeKey: `edit:${genre.id}`, syncKey: syncKey(genre), baseline: draft, values: draft };
}

/** Pointer this close to the top/bottom edge scrolls the page during a touch drag. */
const AUTO_SCROLL_EDGE = 72;

/**
 * /admin/genres (screen 08): searchable card grid with drag-and-drop reordering (mouse: HTML5 drag
 * and drop; touch/pen: pointer events on the handle) plus keyboard reordering (arrow keys on the
 * handle, Move up/Move down in the "…" menu), each saved at once through reorder_genres with an
 * optimistic update. The "Edit genre" panel (a drawer below 1024px) edits the cover, name,
 * description, availability and status; "Add genre" uses the same panel.
 */
export function GenreManager({
  genres,
  businesses,
  actions,
  services = DEFAULT_CATALOG_SERVICES,
  musicPath = MUSIC_PATH,
  businessesPath = "/admin/businesses",
}: GenreManagerProps) {
  const router = useRouter();
  const toast = useToast();
  const instructionsId = useId();
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [, startReorder] = useTransition();
  const [saving, startSaving] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [search, setSearch] = useState("");

  // --- Genres as shown ---------------------------------------------------------
  const [confirmed, setConfirmed] = useState<Confirmed>({ source: genres, order: null, enabled: {} });
  const confirmedHere = confirmed.source === genres;
  const base = confirmedHere
    ? applyOrder(genres, confirmed.order ?? []).map((genre) =>
        genre.id in confirmed.enabled ? { ...genre, isEnabled: confirmed.enabled[genre.id] } : genre,
      )
    : genres;
  const [optimistic, applyOptimistic] = useOptimistic(base, applyChange);
  const [covers, setCovers] = useState<Record<string, CoverOverride>>({});
  const items = optimistic.map((genre) => {
    const cover = covers[genre.id];
    return cover && cover.previousPath === genre.coverPath ? { ...genre, coverPath: cover.path, coverUrl: cover.url } : genre;
  });
  const searching = search.trim() !== "";
  const visible = searching ? items.filter((genre) => genreMatchesSearch(genre, search)) : items;
  const canReorder = !searching && items.length > 1;

  // --- Editor --------------------------------------------------------------------
  const [mode, setMode] = useState<EditorMode>(() => (genres[0] ? { kind: "edit", id: genres[0].id } : { kind: "create" }));
  const modeGenre = mode.kind === "edit" ? items.find((genre) => genre.id === mode.id) : undefined;
  // A genre that disappeared (deleted here or elsewhere) hands the panel to the first genre.
  const effectiveMode: EditorMode =
    mode.kind === "create" || modeGenre ? mode : items[0] ? { kind: "edit", id: items[0].id } : { kind: "create" };
  const editedGenre = effectiveMode.kind === "edit" ? (items.find((genre) => genre.id === effectiveMode.id) ?? null) : null;
  const [editor, setEditor] = useState<EditorState>(() => editorStateFor(effectiveMode, editedGenre, businesses));
  const modeKey = effectiveMode.kind === "create" ? "create" : `edit:${effectiveMode.id}`;
  const targetSync = editedGenre ? syncKey(editedGenre) : "create";
  const editorDirty = isGenreDraftDirty(editor.values, editor.baseline);
  if (editor.modeKey !== modeKey || editor.syncKey !== targetSync) {
    if (editor.modeKey !== modeKey || !editorDirty || !editedGenre) {
      // Another genre, or fresh data while nothing is edited: start from the saved values.
      setEditor(editorStateFor(effectiveMode, editedGenre, businesses));
    } else {
      // Fresh data for the genre being edited ("Deactivate genre", the card menu, a save, another
      // admin): fields that were not edited follow the server and the baseline becomes the server's,
      // so the panel shows the real status and Save cannot silently undo the change.
      const fresh = genreDraftFromItem(editedGenre, businesses);
      setEditor({ ...editor, syncKey: targetSync, baseline: fresh, values: rebaseGenreDraft(editor.values, editor.baseline, fresh) });
    }
  }
  const dirty = editor.modeKey === modeKey && editorDirty;
  const [saveError, setSaveError] = useState<ActionState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // --- Dialogs and drag ------------------------------------------------------------
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmKey, setConfirmKey] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (focusRequest > 0) nameInputRef.current?.focus();
  }, [focusRequest]);

  // A deleted genre takes its card (and the menu that opened the dialog) with it: continue from the
  // search box, or the Add genre button when no genre is left.
  const searchRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [afterDeleteFocus, setAfterDeleteFocus] = useState(0);
  useEffect(() => {
    if (afterDeleteFocus === 0) return;
    (searchRef.current ?? addButtonRef.current)?.focus();
  }, [afterDeleteFocus]);

  // Leaving the page (any link, reload, closing the tab) with unsaved edits asks first.
  const unsavedMessage =
    effectiveMode.kind === "create"
      ? "The new genre hasn’t been created yet."
      : `Your changes to “${editedGenre?.name ?? "this genre"}” haven’t been saved.`;
  useUnsavedChangesGuard(dirty, { message: unsavedMessage });
  const confirmDiscard = useConfirmDiscard();

  // Keyboard reordering moves the card's DOM node; keep focus on the moved genre's handle.
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const handles = Array.from(document.querySelectorAll<HTMLElement>(`[data-genre-handle="${id}"]`));
    const shown = handles.find((element) => element.offsetParent !== null);
    if (shown && document.activeElement !== shown) shown.focus();
  });

  // ---------------------------------------------------------------------------------

  function openConfirmation(next: Confirmation) {
    setConfirmKey((key) => key + 1);
    setConfirmation(next);
  }

  function rawGenre(id: string): AdminGenreItem | undefined {
    return genres.find((genre) => genre.id === id);
  }

  /** Switches the panel (asking before dropping unsaved edits) and opens the drawer below 1024px. */
  function changeMode(next: EditorMode) {
    const nextKey = next.kind === "create" ? "create" : `edit:${next.id}`;
    const proceed = () => {
      if (nextKey !== modeKey) {
        const genre = next.kind === "edit" ? (items.find((candidate) => candidate.id === next.id) ?? null) : null;
        setMode(next);
        setEditor(editorStateFor(next, genre, businesses));
        setSaveError(null);
      }
      if (!isDesktopViewport()) setDrawerOpen(true);
      else setFocusRequest((count) => count + 1);
    };
    if (nextKey === modeKey || !dirty) {
      proceed();
      return;
    }
    void confirmDiscard({ message: unsavedMessage }).then((discard) => {
      if (discard) proceed();
    });
  }

  function persistOrder(next: string[], message: string) {
    setAnnouncement(message);
    const source = genres;
    startReorder(async () => {
      applyOptimistic({ type: "order", ids: next });
      const result = await callAction(() => actions.reorderGenres(next));
      if (!result) return;
      if (result.ok) {
        setConfirmed((current) => ({
          source,
          order: next,
          enabled: current.source === source ? current.enabled : {},
        }));
      } else {
        setAnnouncement("The new order could not be saved.");
        toast.error("The new order wasn't saved", { description: result.message ?? undefined });
      }
    });
  }

  function move(genre: AdminGenreItem, direction: MoveDirection) {
    if (!canReorder) return;
    const ids = items.map((item) => item.id);
    const next = moveInOrder(ids, genre.id, direction);
    if (!next) return;
    persistOrder(next, `${genre.name} moved to position ${next.indexOf(genre.id) + 1} of ${next.length}.`);
  }

  function setEnabled(genre: AdminGenreItem, value: boolean): Promise<ActionState | null> {
    const source = genres;
    setTogglingId(genre.id);
    return new Promise((resolve) => {
      startReorder(async () => {
        applyOptimistic({ type: "enabled", id: genre.id, value });
        const result = await callAction(() => actions.setGenreEnabled(genre.id, value));
        setTogglingId(null);
        if (result?.ok) {
          setConfirmed((current) => ({
            source,
            order: current.source === source ? current.order : null,
            enabled: { ...(current.source === source ? current.enabled : {}), [genre.id]: value },
          }));
        }
        resolve(result);
      });
    });
  }

  function toggleActive(genre: AdminGenreItem) {
    if (genre.isEnabled) {
      openConfirmation({ kind: "deactivate", genre });
      return;
    }
    void setEnabled(genre, true).then((result) => {
      if (!result) return;
      if (result.ok) toast.success(result.message ?? "Genre activated.");
      else toast.error(`“${genre.name}” wasn't changed`, { description: result.message ?? undefined });
    });
  }

  function save() {
    const values = editor.values;
    setSaveError(null);
    if (effectiveMode.kind === "create") {
      startSaving(async () => {
        const result = await callAction(() => actions.createGenre(genreDraftFormData(values)));
        if (!result) return;
        const createdId = result.values?.createdGenreId;
        if (result.ok || createdId) {
          setEditor((current) => (current.modeKey === "create" ? { ...current, baseline: values } : current));
          if (createdId) setMode({ kind: "edit", id: createdId });
          if (result.ok) toast.success(result.message ?? "Genre created.");
          else toast.warning(result.message ?? "The genre was created with problems.", { durationMs: null });
        } else {
          setSaveError(result);
        }
      });
      return;
    }
    const genreId = effectiveMode.id;
    // Only what the admin edited: fields changed elsewhere meanwhile (e.g. the genre was deactivated)
    // are left as they are on the server.
    const edits = genreDraftFormData(values, editor.baseline);
    startSaving(async () => {
      const result = await callAction(() => actions.saveGenre(genreId, edits));
      if (!result) return;
      if (result.ok) {
        setEditor((current) => (current.modeKey === `edit:${genreId}` ? { ...current, baseline: values } : current));
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

  function coverUploaded(genre: AdminGenreItem, cover: { coverPath: string; coverUrl: string }) {
    const previousPath = rawGenre(genre.id)?.coverPath ?? null;
    setCovers((current) => ({ ...current, [genre.id]: { previousPath, path: cover.coverPath, url: cover.coverUrl } }));
    toast.success(`New cover saved for “${genre.name}”.`);
    router.refresh();
  }

  async function confirmAction(run: () => Promise<ActionState | null>, reportError: (message: string) => void, onDone?: (result: ActionState) => void) {
    const result = await run();
    if (!result) return;
    if (result.ok) {
      setConfirmation(null);
      onDone?.(result);
      toast.success(result.message ?? "Done.");
    } else {
      reportError(result.message ?? "Something went wrong. Please try again.");
    }
  }

  // --- Drag and drop -------------------------------------------------------------------

  function beginDrag(id: string, pointerId: number | null) {
    const next = { id, overId: null, pointerId };
    dragRef.current = next;
    setDrag(next);
  }

  function hover(overId: string | null) {
    const current = dragRef.current;
    if (!current || current.overId === overId) return;
    const next = { ...current, overId };
    dragRef.current = next;
    setDrag(next);
  }

  function endDrag(commit: boolean) {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!commit || !current || !current.overId || current.overId === current.id) return;
    const ids = items.map((genre) => genre.id);
    const target = ids.indexOf(current.overId);
    const next = moveToIndex(ids, current.id, target);
    const genre = items.find((candidate) => candidate.id === current.id);
    if (next && genre) persistOrder(next, `${genre.name} moved to position ${target + 1} of ${ids.length}.`);
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, genre: AdminGenreItem) {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    // Firefox only starts a drag that carries data.
    event.dataTransfer.setData("text/plain", genre.name);
    const card = event.currentTarget.closest<HTMLElement>("[data-genre-card]");
    if (card) {
      const rect = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(card, event.clientX - rect.left, event.clientY - rect.top);
    }
    beginDrag(genre.id, null);
  }

  function handleCardDragOver(event: DragEvent<HTMLLIElement>, genre: AdminGenreItem) {
    const current = dragRef.current;
    if (!current || current.pointerId !== null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    hover(genre.id);
  }

  function handleCardDrop(event: DragEvent<HTMLLIElement>, genre: AdminGenreItem) {
    if (!dragRef.current || dragRef.current.pointerId !== null) return;
    event.preventDefault();
    hover(genre.id);
    endDrag(true);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, genre: AdminGenreItem) {
    // Mouse drags use HTML5 drag and drop; touch and pen use pointer events.
    if (event.pointerType === "mouse" || !canReorder || !event.isPrimary) return;
    try {
      // Keeps pointermove/up coming to the handle while the finger travels over other cards.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (e.g. lifted at once); the drag ends on pointerup/cancel.
    }
    beginDrag(genre.id, event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-genre-card]");
    hover(target?.dataset.genreCard ?? null);
    if (event.clientY < AUTO_SCROLL_EDGE) window.scrollBy({ top: -16 });
    else if (event.clientY > window.innerHeight - AUTO_SCROLL_EDGE) window.scrollBy({ top: 16 });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    endDrag(true);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    endDrag(false);
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLDivElement>, genre: AdminGenreItem) {
    if (event.key === "Escape" && dragRef.current) {
      event.preventDefault();
      endDrag(false);
      return;
    }
    if (!canReorder) return;
    const ids = items.map((item) => item.id);
    const index = ids.indexOf(genre.id);
    let target: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") target = index - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") target = index + 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = ids.length - 1;
    if (target === null) return;
    event.preventDefault();
    const next = moveToIndex(ids, genre.id, target);
    if (!next) return;
    pendingFocus.current = genre.id;
    persistOrder(next, `${genre.name} moved to position ${next.indexOf(genre.id) + 1} of ${next.length}.`);
  }

  // --- Rendering -------------------------------------------------------------------------

  const addButton = (
    <Button ref={addButtonRef} icon={<Plus aria-hidden="true" />} onClick={() => changeMode({ kind: "create" })}>
      Add genre
    </Button>
  );

  const confirmGenre = confirmation?.genre ?? null;
  const panelTitle = effectiveMode.kind === "create" ? "Add genre" : "Edit genre";
  const coverField = editedGenre ? (
    <GenreCoverField
      key={editedGenre.id}
      genreId={editedGenre.id}
      genreName={editedGenre.name}
      slug={editedGenre.slug}
      coverUrl={editedGenre.coverUrl}
      hasCover={editedGenre.coverPath !== null}
      upload={services.upload}
      onUploaded={(cover) => coverUploaded(editedGenre, cover)}
      onRemove={() => openConfirmation({ kind: "remove-cover", genre: editedGenre })}
    />
  ) : null;

  function editorView(withNameRef: boolean) {
    return (
      <GenreEditor
        key={modeKey}
        mode={effectiveMode.kind}
        genre={editedGenre}
        businesses={businesses}
        draft={editor.values}
        onDraftChange={(values) => setEditor((current) => ({ ...current, values }))}
        dirty={dirty}
        saving={saving}
        error={saveError}
        onSave={save}
        onDiscard={discardEdits}
        cover={coverField}
        onToggleActive={() => {
          if (editedGenre) toggleActive(editedGenre);
        }}
        togglingActive={editedGenre !== null && togglingId === editedGenre.id}
        manageTracksHref={editedGenre ? genreTracksHref(editedGenre.id, musicPath) : null}
        businessesHref={businessesPath}
        nameInputRef={withNameRef ? nameInputRef : undefined}
      />
    );
  }

  return (
    <>
      <PageHeading title="Genres" description="Give every space the right sound." actions={addButton} />
      <p id={instructionsId} className="sr-only">
        Drag to reorder, or use the arrow keys, Home and End on this handle. The new order is saved at once.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Genres" className="grid min-w-0 gap-4">
          {items.length > 0 && (
            <div className="grid gap-2">
              <SearchInput
                ref={searchRef}
                label="Search genres"
                placeholder="Search genres"
                value={search}
                onValueChange={setSearch}
                autoComplete="off"
              />
              {searching && (
                <p className="text-sm text-fg-muted" aria-live="polite">
                  {visible.length === 1 ? "1 genre matches" : `${visible.length} genres match`} · Clear the search to reorder.
                </p>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid />}
              title="No genres yet"
              description="Genres are the stations venues choose from, such as House, Lounge or Jazz. Add one, then upload music into it."
              action={addButton}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title={`No genres match “${search.trim()}”`}
              description="Try another name, or clear the search."
              action={
                <Button variant="secondary" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <div className="@container">
              <ol className="grid grid-cols-2 gap-3 @xl:gap-4 @4xl:grid-cols-3" aria-describedby={canReorder ? instructionsId : undefined}>
                {visible.map((genre) => (
                  <GenreCard
                    key={genre.id}
                    genre={genre}
                    position={items.indexOf(genre) + 1}
                    total={items.length}
                    selected={editedGenre?.id === genre.id}
                    canReorder={canReorder}
                    dragging={drag?.id === genre.id}
                    dropTarget={drag !== null && drag.overId === genre.id && drag.id !== genre.id}
                    instructionsId={instructionsId}
                    onSelect={() => changeMode({ kind: "edit", id: genre.id })}
                    onMove={(direction) => move(genre, direction)}
                    onToggleActive={() => toggleActive(genre)}
                    onDelete={() => openConfirmation({ kind: "delete", genre })}
                    onHandleKeyDown={(event) => handleHandleKeyDown(event, genre)}
                    onHandleDragStart={(event) => handleDragStart(event, genre)}
                    onHandleDragEnd={() => endDrag(false)}
                    onHandlePointerDown={(event) => handlePointerDown(event, genre)}
                    onHandlePointerMove={handlePointerMove}
                    onHandlePointerUp={handlePointerUp}
                    onHandlePointerCancel={handlePointerCancel}
                    onCardDragOver={(event) => handleCardDragOver(event, genre)}
                    onCardDrop={(event) => handleCardDrop(event, genre)}
                  />
                ))}
              </ol>
            </div>
          )}
        </section>

        <Card
          role="region"
          aria-labelledby="genre-editor-heading"
          className="hidden p-5 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
        >
          <h2 id="genre-editor-heading" className="section-title mb-4 font-bold text-fg">
            {panelTitle}
          </h2>
          {editorView(isDesktop)}
        </Card>
      </div>

      <Drawer
        open={drawerOpen && !isDesktop}
        onClose={() => setDrawerOpen(false)}
        title={panelTitle}
        description={editedGenre?.name}
        size="lg"
      >
        {!isDesktop && editorView(false)}
      </Drawer>

      <ActionConfirmDialog
        key={`delete-${confirmKey}`}
        open={confirmation?.kind === "delete"}
        title={confirmGenre ? `Delete “${confirmGenre.name}”?` : "Delete genre?"}
        description="This can’t be undone."
        confirmLabel="Delete genre"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) =>
          confirmGenre
            ? confirmAction(() => callAction(() => actions.deleteGenre(confirmGenre.id)), reportError, () =>
                setAfterDeleteFocus((count) => count + 1),
              )
            : Promise.resolve()
        }
      >
        {confirmGenre && (
          <>
            <p>
              {confirmGenre.totalCount > 0
                ? `Its ${confirmGenre.totalCount === 1 ? "track stays" : `${confirmGenre.totalCount} tracks stay`} in the music library with their audio, but lose this genre; a track with no other genre won’t play anywhere until you give it one.`
                : "It has no tracks."}
            </p>
            <p>Business access to it and its cover image are removed, and venues playing it are asked to choose another genre.</p>
            {confirmGenre.isEnabled && <p>To only hide it from venues, deactivate it instead.</p>}
          </>
        )}
      </ActionConfirmDialog>
      <ActionConfirmDialog
        key={`deactivate-${confirmKey}`}
        open={confirmation?.kind === "deactivate"}
        title={confirmGenre ? `Deactivate “${confirmGenre.name}”?` : "Deactivate genre?"}
        confirmLabel="Deactivate genre"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) => (confirmGenre ? confirmAction(() => setEnabled(confirmGenre, false), reportError) : Promise.resolve())}
      >
        <p>
          Venues can no longer choose it, and venues playing it are asked to pick another genre. Its tracks and audio stay in the
          music library; you can activate it again at any time.
        </p>
      </ActionConfirmDialog>
      <ActionConfirmDialog
        key={`cover-${confirmKey}`}
        open={confirmation?.kind === "remove-cover"}
        title={confirmGenre ? `Remove the cover of “${confirmGenre.name}”?` : "Remove cover?"}
        confirmLabel="Remove cover"
        onCancel={() => setConfirmation(null)}
        onConfirm={(reportError) =>
          confirmGenre
            ? confirmAction(() => callAction(() => actions.removeGenreCover(confirmGenre.id)), reportError, () => {
                const previousPath = rawGenre(confirmGenre.id)?.coverPath ?? null;
                setCovers((current) => ({ ...current, [confirmGenre.id]: { previousPath, path: null, url: null } }));
                router.refresh();
              })
            : Promise.resolve()
        }
      >
        <p>The genre shows its default artwork again. The image file is deleted.</p>
      </ActionConfirmDialog>
    </>
  );
}
