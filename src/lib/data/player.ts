/**
 * Server-side data access for the business-user player (docs/ARCHITECTURE.md §5.2, §7, §9;
 * docs/REDESIGN.md §3–§4).
 *
 * Every function takes the signed-in user's OWN Supabase client, so RLS decides what is visible:
 * genres the venue may use (and their covers in Storage), playable tracks in those genres, and the
 * venue's own playable announcements. The business id always comes from the session context, never
 * from a request.
 * The explicit filters below repeat the RLS rules on purpose (defence in depth), and rows are
 * re-checked in code before they are returned.
 */
import "server-only";
import type {
  AnnouncementPlacement,
  AnnouncementSummary,
  BusinessType,
  PlaybackPreferences,
  PlayerBootstrap,
  PlayerGenre,
  SupportContact,
  TrackSummary,
  UpdatePreferencesRequest,
} from "@/lib/api/contracts";
import type { BusinessUserSessionContext } from "@/lib/auth/session";
import { mediaTtlFor, signLogoObject } from "@/lib/media/signing";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { TablesInsert } from "@/types/database";

/** A query failed for a reason other than "not visible". The cause holds the PostgREST error. */
export class PlayerDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlayerDataError";
  }
}

function queryFailed(what: string, cause: unknown): never {
  throw new PlayerDataError(`Could not load ${what}.`, { cause });
}

/** Column defaults of playback_preferences (§5.2), used when the user has no saved row yet. */
export const DEFAULT_PLAYBACK_PREFERENCES: Readonly<PlaybackPreferences> = Object.freeze({
  genreId: null,
  volume: 0.8,
  muted: false,
});

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

const BUSINESS_COLUMNS =
  "id, name, station_name, business_type, logo_path, announcement_language, announcement_every_n_tracks, announcement_volume, branding_version";

/** Values of the business_type enum (REDESIGN.md §3); anything else is shown as "other". */
export const BUSINESS_TYPES: readonly BusinessType[] = ["cafe", "restaurant", "hotel", "bar", "other"];

function toBusinessType(value: unknown): BusinessType {
  return BUSINESS_TYPES.find((type) => type === value) ?? "other";
}

interface OwnBusiness {
  id: string;
  name: string;
  stationName: string;
  type: BusinessType;
  logoPath: string | null;
  language: string;
  announcementEveryNTracks: number;
  announcementVolume: number;
  brandingVersion: number;
}

/** The caller's own business row (RLS: `id = member_business_id()`), or null when it is not visible. */
async function fetchOwnBusiness(supabase: TypedSupabaseClient, businessId: string): Promise<OwnBusiness | null> {
  const { data, error } = await supabase.from("businesses").select(BUSINESS_COLUMNS).eq("id", businessId).maybeSingle();
  if (error) queryFailed("the venue", error);
  if (!data || data.id !== businessId) return null;
  return {
    id: data.id,
    name: data.name,
    stationName: data.station_name,
    type: toBusinessType(data.business_type),
    logoPath: data.logo_path,
    language: data.announcement_language,
    announcementEveryNTracks: finiteNumber(data.announcement_every_n_tracks) ?? 4,
    announcementVolume: finiteNumber(data.announcement_volume) ?? 1,
    brandingVersion: Number(data.branding_version),
  };
}

/** Signed logo URL, or null. A logo problem must never break the player, so this never throws. */
async function signLogoUrl(supabase: TypedSupabaseClient, logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  try {
    return (await signLogoObject(supabase, logoPath)).url;
  } catch (error) {
    console.warn("[player] could not sign the venue logo; showing the monogram instead", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Genres & tracks
// ---------------------------------------------------------------------------

/** True when RLS lets the caller see the genre (enabled, assigned to the venue, venue active). */
export async function isGenreVisible(supabase: TypedSupabaseClient, genreId: string): Promise<boolean> {
  const { data, error } = await supabase.from("genres").select("id").eq("id", genreId).maybeSingle();
  if (error) queryFailed("the genre", error);
  return data !== null && data.id === genreId;
}

async function fetchVisibleGenres(supabase: TypedSupabaseClient) {
  const { data, error } = await supabase
    .from("genres")
    .select("id, name, slug, description, sort_order, cover_path")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) queryFailed("the genres", error);
  return data;
}

/** Private bucket holding owner-uploaded genre covers (`{genre_id}/{random}.{ext}`, REDESIGN.md §3). */
export const GENRE_COVER_BUCKET = "genre-covers";

/** One entry of Storage's batch signing response (`createSignedUrls`). */
interface BatchSignedUrl {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
}

/** Minimal structural view of the Storage batch-signing API (the typed Supabase client satisfies it). */
export interface StorageBatchSigningClient {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{ data: BatchSignedUrl[]; error: null } | { data: null; error: { message: string } }>;
    };
  };
}

/**
 * Signs genre cover objects in ONE Storage request with the caller's own client, so Storage RLS
 * (`genre-covers: member read accessible covers`) decides again what the venue may see. Returns
 * path → signed URL for the objects that could be signed; a missing, forbidden or failed object is
 * simply absent. Never throws: covers are decoration and the UI falls back to default artwork.
 */
export async function signGenreCoverUrls(
  client: StorageBatchSigningClient,
  paths: readonly (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => typeof path === "string" && path !== ""))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  try {
    const { data, error } = await client.storage.from(GENRE_COVER_BUCKET).createSignedUrls(unique, mediaTtlFor(null));
    if (error || !Array.isArray(data)) {
      console.warn("[player] could not sign the genre covers; showing the default artwork instead", error);
      return urls;
    }
    data.forEach((entry, index) => {
      // Storage echoes each path; fall back to the request order only if it did not.
      const path = entry.path ?? (data.length === unique.length ? unique[index] : null);
      if (path === null || !unique.includes(path) || entry.error || typeof entry.signedUrl !== "string" || entry.signedUrl === "") {
        return;
      }
      urls.set(path, entry.signedUrl);
    });
    const unsigned = unique.length - urls.size;
    if (unsigned > 0) console.warn(`[player] ${unsigned} genre cover(s) could not be signed; showing the default artwork instead`);
  } catch (error) {
    console.warn("[player] could not sign the genre covers; showing the default artwork instead", error);
  }
  return urls;
}

/** Playable track counts per visible genre (security-invoker RPC, so RLS applies). */
async function fetchPlayableCounts(supabase: TypedSupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("genre_track_counts");
  if (error) queryFailed("the genre track counts", error);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.genre_id, Math.max(0, finiteNumber(row.playable_count) ?? 0));
  }
  return counts;
}

/**
 * Page size for track lists. PostgREST caps every response at `max_rows` (Supabase default 1000), so
 * lists are fetched page by page; a page shorter than this ends the list. Keep it ≤ max_rows.
 */
export const TRACK_PAGE_SIZE = 1000;
/** Safety bound on pages per genre (50 000 tracks), so a runaway loop can never happen. */
const MAX_TRACK_PAGES = 50;

interface TrackRow {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  is_active: boolean;
  removed_at: string | null;
  track_genres: { genre_id: string }[];
}

function isPlayableInGenre(row: TrackRow, genreId: string): boolean {
  return row.is_active && row.removed_at === null && row.track_genres.some((link) => link.genre_id === genreId);
}

function toTrackSummary(row: TrackRow): TrackSummary | null {
  const durationSeconds = finiteNumber(row.duration_seconds);
  // The DB guarantees duration > 0; a bad value must not poison the whole list for the player.
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return { id: row.id, title: row.title, artist: row.artist, durationSeconds };
}

const TRACK_COLUMNS = "id, title, artist, duration_seconds, is_active, removed_at, track_genres!inner(genre_id)";
const SIGNABLE_TRACK_COLUMNS =
  "id, title, artist, duration_seconds, is_active, removed_at, storage_path, track_genres!inner(genre_id)";

/**
 * Playable tracks linked to the genre, in a stable order (oldest first, then id). Uses an inner join
 * on track_genres, whose RLS only exposes links of genres accessible to the caller's active venue.
 */
export async function listGenreTracks(supabase: TypedSupabaseClient, genreId: string): Promise<TrackSummary[]> {
  const tracks: TrackSummary[] = [];
  for (let page = 0; page < MAX_TRACK_PAGES; page += 1) {
    const from = page * TRACK_PAGE_SIZE;
    const { data, error } = await supabase
      .from("tracks")
      .select(TRACK_COLUMNS)
      .eq("track_genres.genre_id", genreId)
      .eq("is_active", true)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + TRACK_PAGE_SIZE - 1);
    if (error) queryFailed("the genre's tracks", error);

    for (const row of data) {
      if (!isPlayableInGenre(row, genreId)) continue;
      const summary = toTrackSummary(row);
      if (summary) tracks.push(summary);
    }
    if (data.length < TRACK_PAGE_SIZE) return tracks;
  }
  console.warn(`[player] genre ${genreId} has more than ${MAX_TRACK_PAGES * TRACK_PAGE_SIZE} tracks; the list was truncated.`);
  return tracks;
}

export interface SignableTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  storagePath: string;
}

/**
 * The track when it is playable, linked to `genreId`, and visible to the caller under RLS; otherwise
 * null. Called before every signed URL so disabled/removed tracks and revoked genres drop out.
 */
export async function findSignableTrack(
  supabase: TypedSupabaseClient,
  trackId: string,
  genreId: string,
): Promise<SignableTrack | null> {
  const { data, error } = await supabase
    .from("tracks")
    .select(SIGNABLE_TRACK_COLUMNS)
    .eq("id", trackId)
    .eq("track_genres.genre_id", genreId)
    .eq("is_active", true)
    .is("removed_at", null)
    .maybeSingle();
  if (error) queryFailed("the track", error);
  if (!data || data.id !== trackId || !isPlayableInGenre(data, genreId)) return null;
  const summary = toTrackSummary(data);
  if (!summary || !data.storage_path) return null;
  return { ...summary, storagePath: data.storage_path };
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

interface AnnouncementRow {
  id: string;
  business_id: string;
  placement: AnnouncementPlacement;
  status: string;
  needs_review: boolean;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  branding_version: number;
}

const ANNOUNCEMENT_COLUMNS =
  "id, business_id, placement, status, needs_review, audio_path, audio_duration_seconds, branding_version";
/** The list shown to the venue also carries the display wording (never the audio path). */
const ANNOUNCEMENT_LIST_COLUMNS =
  "id, business_id, placement, status, needs_review, audio_path, audio_duration_seconds, branding_version, text";

interface AnnouncementListRow extends AnnouncementRow {
  text: string;
}

/**
 * §5.2 "playable": active, not awaiting review, has audio, approved at the venue's current branding
 * version. RLS already enforces this; it is repeated so stale branding can never reach the player.
 */
function isPlayableAnnouncement(row: AnnouncementRow, business: Pick<OwnBusiness, "id" | "brandingVersion">): boolean {
  return (
    row.business_id === business.id &&
    row.status === "active" &&
    !row.needs_review &&
    typeof row.audio_path === "string" &&
    row.audio_path !== "" &&
    Number(row.branding_version) === business.brandingVersion
  );
}

function durationOrNull(value: unknown): number | null {
  const duration = finiteNumber(value);
  return duration !== null && duration > 0 ? duration : null;
}

async function fetchActiveAnnouncementRows(supabase: TypedSupabaseClient, businessId: string): Promise<AnnouncementListRow[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select(ANNOUNCEMENT_LIST_COLUMNS)
    .eq("business_id", businessId)
    .eq("status", "active")
    .eq("needs_review", false)
    .not("audio_path", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) queryFailed("the announcements", error);
  return data;
}

/**
 * The venue's playable announcements (placement, duration and display wording), oldest first. The
 * single eligibility rule for both GET /api/player/announcements and the player bootstrap.
 */
function toPlayableAnnouncements(
  rows: readonly AnnouncementListRow[],
  business: Pick<OwnBusiness, "id" | "brandingVersion">,
): AnnouncementSummary[] {
  return rows
    .filter((row) => isPlayableAnnouncement(row, business))
    .map((row) => ({
      id: row.id,
      placement: row.placement,
      durationSeconds: durationOrNull(row.audio_duration_seconds),
      text: typeof row.text === "string" ? row.text : "",
    }));
}

export interface AnnouncementPlayback {
  settings: { everyNTracks: number; volume: number };
  brandingVersion: number;
  announcements: AnnouncementSummary[];
}

/**
 * The venue's announcement settings and its playable announcements, or null when the business row
 * is not visible to the caller (membership removed after the session was resolved).
 */
export async function loadAnnouncementPlayback(
  supabase: TypedSupabaseClient,
  businessId: string,
): Promise<AnnouncementPlayback | null> {
  const [business, rows] = await Promise.all([
    fetchOwnBusiness(supabase, businessId),
    fetchActiveAnnouncementRows(supabase, businessId),
  ]);
  if (!business) return null;
  return {
    settings: { everyNTracks: business.announcementEveryNTracks, volume: business.announcementVolume },
    brandingVersion: business.brandingVersion,
    announcements: toPlayableAnnouncements(rows, business),
  };
}

export interface SignableAnnouncement {
  id: string;
  durationSeconds: number | null;
  audioPath: string;
}

/**
 * The announcement when it belongs to the caller's venue and is playable at the venue's current
 * branding version; otherwise null (another venue's id, not approved, stale branding, no audio).
 */
export async function findSignableAnnouncement(
  supabase: TypedSupabaseClient,
  businessId: string,
  announcementId: string,
): Promise<SignableAnnouncement | null> {
  const [business, result] = await Promise.all([
    fetchOwnBusiness(supabase, businessId),
    supabase
      .from("announcements")
      .select(ANNOUNCEMENT_COLUMNS)
      .eq("id", announcementId)
      .eq("business_id", businessId)
      .eq("status", "active")
      .eq("needs_review", false)
      .not("audio_path", "is", null)
      .maybeSingle(),
  ]);
  if (result.error) queryFailed("the announcement", result.error);
  const row = result.data;
  if (!business || !row || row.id !== announcementId || !isPlayableAnnouncement(row, business) || !row.audio_path) {
    return null;
  }
  return { id: row.id, durationSeconds: durationOrNull(row.audio_duration_seconds), audioPath: row.audio_path };
}

// ---------------------------------------------------------------------------
// Playback preferences
// ---------------------------------------------------------------------------

const PREFERENCES_CONFLICT_TARGET = "user_id,business_id";

function clampVolume(value: unknown): number {
  const volume = finiteNumber(value);
  if (volume === null) return DEFAULT_PLAYBACK_PREFERENCES.volume;
  return Math.min(1, Math.max(0, volume));
}

function toPlaybackPreferences(row: { genre_id: string | null; volume: number; muted: boolean }): PlaybackPreferences {
  return { genreId: row.genre_id, volume: clampVolume(row.volume), muted: row.muted };
}

async function fetchPreferencesRow(supabase: TypedSupabaseClient, ctx: BusinessUserSessionContext) {
  const { data, error } = await supabase
    .from("playback_preferences")
    .select("genre_id, volume, muted")
    .eq("user_id", ctx.userId)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (error) queryFailed("the playback preferences", error);
  return data;
}

export type SavePreferencesResult =
  | { ok: true; preferences: PlaybackPreferences }
  /** The database refused the row (RLS with-check or a genre deleted meanwhile). */
  | { ok: false; reason: "rejected" };

/**
 * Upserts the caller's preferences for their venue; omitted fields keep their stored value (or the
 * column default on first save). The caller must already have checked that a new genreId is
 * visible. A stored genre that is no longer available is cleared, because the RLS with-check
 * would otherwise refuse every later volume/mute change.
 */
export async function savePlaybackPreferences(
  supabase: TypedSupabaseClient,
  ctx: BusinessUserSessionContext,
  update: UpdatePreferencesRequest,
): Promise<SavePreferencesResult> {
  const payload: TablesInsert<"playback_preferences"> = { user_id: ctx.userId, business_id: ctx.business.id };
  if (update.volume !== undefined) payload.volume = update.volume;
  if (update.muted !== undefined) payload.muted = update.muted;

  if (update.genreId !== undefined) {
    payload.genre_id = update.genreId;
  } else {
    const { data, error } = await supabase
      .from("playback_preferences")
      .select("genre_id, genres ( id )")
      .eq("user_id", ctx.userId)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (error) queryFailed("the playback preferences", error);
    // The embedded genre is null when RLS hides it (disabled, unassigned) or it no longer exists.
    if (data?.genre_id && !data.genres) payload.genre_id = null;
  }

  const { data, error } = await supabase
    .from("playback_preferences")
    .upsert(payload, { onConflict: PREFERENCES_CONFLICT_TARGET })
    .select("genre_id, volume, muted")
    .single();
  if (error) {
    // 42501: RLS with-check refused the row; 23503: the genre was deleted after the visibility check.
    if (error.code === "42501" || error.code === "23503") return { ok: false, reason: "rejected" };
    queryFailed("the saved playback preferences", error);
  }
  return { ok: true, preferences: toPlaybackPreferences(data) };
}

// ---------------------------------------------------------------------------
// Platform support contact
// ---------------------------------------------------------------------------

/** Shown when the owner has not configured (or the database cannot return) contact details. */
export const EMPTY_SUPPORT_CONTACT: Readonly<SupportContact> = Object.freeze({ email: null, phone: null });

function contactValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The owner's contact details from the platform_settings singleton (readable by every signed-in
 * user). Each value is null when unset. Contact details are a convenience, so a missing row or a
 * failing query only yields nulls (logged) and never breaks the player.
 */
export async function loadSupportContact(supabase: TypedSupabaseClient): Promise<SupportContact> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("contact_email, contact_phone")
      .eq("id", true)
      .maybeSingle();
    if (error) {
      console.warn("[player] could not read the platform contact details", error);
      return { ...EMPTY_SUPPORT_CONTACT };
    }
    return { email: contactValue(data?.contact_email), phone: contactValue(data?.contact_phone) };
  } catch (error) {
    console.warn("[player] could not read the platform contact details", error);
    return { ...EMPTY_SUPPORT_CONTACT };
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Everything the (venue) layout needs to start the player, loaded with the user's own client.
 * Throws PlayerDataError when a query fails or the venue row is not visible. Decoration never
 * fails the load: a logo or genre cover that cannot be signed yields a null URL, and unreadable
 * contact details yield `support: { email: null, phone: null }`.
 */
export async function loadPlayerBootstrap(
  supabase: TypedSupabaseClient,
  ctx: BusinessUserSessionContext,
): Promise<PlayerBootstrap> {
  const businessId = ctx.business.id;
  const [business, genreRows, playableCounts, preferencesRow, announcementRows, support] = await Promise.all([
    fetchOwnBusiness(supabase, businessId),
    fetchVisibleGenres(supabase),
    fetchPlayableCounts(supabase),
    fetchPreferencesRow(supabase, ctx),
    fetchActiveAnnouncementRows(supabase, businessId),
    loadSupportContact(supabase),
  ]);
  if (!business) {
    throw new PlayerDataError("The venue is not available to this account.");
  }

  // Both signings use the user's own client (Storage RLS applies) and never throw.
  const [logoUrl, coverUrls] = await Promise.all([
    signLogoUrl(supabase, business.logoPath),
    signGenreCoverUrls(supabase, genreRows.map((row) => row.cover_path)),
  ]);

  const genres: PlayerGenre[] = genreRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    trackCount: playableCounts.get(row.id) ?? 0,
    coverUrl: row.cover_path ? (coverUrls.get(row.cover_path) ?? null) : null,
  }));
  const visibleGenreIds = new Set(genres.map((genre) => genre.id));

  const saved = preferencesRow ? toPlaybackPreferences(preferencesRow) : { ...DEFAULT_PLAYBACK_PREFERENCES };
  const preferences: PlaybackPreferences = {
    ...saved,
    genreId: saved.genreId !== null && visibleGenreIds.has(saved.genreId) ? saved.genreId : null,
  };

  const announcements = toPlayableAnnouncements(announcementRows, business);
  const announcementCounts = { welcome: 0, rotation: 0 };
  for (const announcement of announcements) {
    if (announcement.placement === "welcome" || announcement.placement === "both") announcementCounts.welcome += 1;
    if (announcement.placement === "rotation" || announcement.placement === "both") announcementCounts.rotation += 1;
  }

  return {
    userId: ctx.userId,
    business: {
      id: business.id,
      name: business.name,
      stationName: business.stationName,
      type: business.type,
      logoUrl,
      language: business.language,
      announcementEveryNTracks: business.announcementEveryNTracks,
      announcementVolume: business.announcementVolume,
    },
    genres,
    preferences,
    announcementCounts,
    announcements,
    support,
  };
}
