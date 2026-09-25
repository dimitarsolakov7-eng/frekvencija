// Supabase I/O for `npm run seed:dev`: reads the existing rows the planner needs, then executes a
// SeedPlan with the secret-key client. Order: users (so the admin id can be recorded as
// creator/approver) → genres → businesses → exclusive access → memberships → tracks → announcements.
// Objects are uploaded before the row that points at them, and removed again when the row cannot be
// written, so a failed run never leaves a row pointing at a missing file.
import { randomBytes, randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { AppRole, BusinessTypeEnum, TablesInsert } from "../../src/types/database";
import { DEMO_BUSINESSES, businessTypeLabel, type DemoBusinessKey } from "./demo-catalog";
import type { DemoAudioManifest } from "./manifest";
import { generatePassword } from "./passwords";
import type { AnnouncementPlan, ExistingState, SeedPlan, SeedUserSpec, TrackPlan } from "./seed-plan";
import {
  MissingMigrationError,
  ScriptStepError,
  describeError,
  findAuthUserIdByEmail,
  findProfileByEmail,
  isEmailExistsError,
  isMissingSchemaError,
  promoteToPlatformAdmin,
  type AdminClient,
} from "./supabase-admin";

export interface CreatedCredential {
  email: string;
  password: string;
  role: AppRole;
  venue: string | null;
}

export interface SeedSummary {
  users: { email: string; role: AppRole; venue: string | null; status: "created" | "existing" | "existing, promoted" }[];
  businesses: { name: string; id: string; type: BusinessTypeEnum; status: "created" | "existing" | "existing, type set" }[];
  genres: { created: number; existing: number };
  genreAccessCreated: number;
  membershipsCreated: number;
  tracks: { created: number; existing: number };
  announcements: { created: number; audioAttached: number; existing: number };
}

type Bucket = "music" | "announcements";

/**
 * Reads the rows the planner needs to recognise existing demo data (read-only). Doubles as the schema
 * preflight: platform_settings and businesses.business_type only exist once every migration is applied,
 * so a missing migration raises MissingMigrationError here, before anything is written.
 */
export async function readExistingState(client: AdminClient, manifest: DemoAudioManifest, users: SeedUserSpec[]): Promise<ExistingState> {
  function fail(step: string, error: unknown): never {
    throw isMissingSchemaError(error) ? new MissingMigrationError(step, error) : new ScriptStepError(`read ${step}`, error);
  }
  const check = <T>(step: string, result: { data: T[] | null; error: unknown }): T[] => {
    if (result.error) fail(step, result.error);
    return result.data ?? [];
  };

  // The singleton row is created by the migration; the seed only reads the default frequency from it.
  const settings = await client.from("platform_settings").select("default_announcement_every_n_tracks").eq("id", true).maybeSingle();
  if (settings.error) fail("platform settings", settings.error);
  const platformSettings = settings.data ?? null;

  const genres = check("genres", await client.from("genres").select("id, slug, name"));
  const businesses: ExistingState["businesses"] = [];
  for (const business of DEMO_BUSINESSES) {
    // ilike without wildcards = case-insensitive equality (demo names contain no % or _).
    const rows = check(
      "businesses",
      await client
        .from("businesses")
        .select("id, name, contact_email, branding_version, is_active, business_type, announcement_every_n_tracks")
        .ilike("name", business.name),
    );
    businesses.push(...rows);
  }
  const businessIds = businesses.map((row) => row.id);
  const genreAccess =
    businessIds.length > 0
      ? check("genre access", await client.from("business_genre_access").select("business_id, genre_id").in("business_id", businessIds))
      : [];
  const announcements =
    businessIds.length > 0
      ? check(
          "announcements",
          await client
            .from("announcements")
            .select("id, business_id, template_key, status, audio_path, needs_review, branding_version")
            .in("business_id", businessIds),
        )
      : [];
  const titles = manifest.entries.filter((entry) => entry.kind === "track").map((entry) => entry.title);
  const tracks = titles.length > 0 ? check("tracks", await client.from("tracks").select("id, title, is_active, removed_at").in("title", titles)) : [];
  const profiles = check("profiles", await client.from("profiles").select("id, email, role").in("email", users.map((user) => user.email)));
  const memberships =
    profiles.length > 0
      ? check("memberships", await client.from("business_members").select("business_id, user_id").in("user_id", profiles.map((row) => row.id)))
      : [];
  return { genres, businesses, genreAccess, tracks, announcements, profiles, memberships, platformSettings };
}

const randomObjectName = () => `${randomBytes(16).toString("hex")}.mp3`;

async function uploadObject(client: AdminClient, bucket: Bucket, path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, bytes, {
    contentType: "audio/mpeg",
    cacheControl: "31536000", // immutable: random path, never overwritten
    upsert: false,
  });
  if (error) throw new ScriptStepError(`upload ${bucket}/${path}`, error);
}

/** Best-effort cleanup after a failed row write; reports (never hides) a cleanup failure. */
async function removeObject(client: AdminClient, bucket: Bucket, path: string, log: (line: string) => void): Promise<void> {
  const { error } = await client.storage.from(bucket).remove([path]);
  if (error) log(`  ! could not remove orphaned object ${bucket}/${path}: ${describeError(error)} (delete it in the Storage dashboard)`);
}

async function withUploadedObject(
  client: AdminClient,
  bucket: Bucket,
  path: string,
  bytes: Uint8Array,
  log: (line: string) => void,
  writeRow: () => Promise<void>,
): Promise<void> {
  await uploadObject(client, bucket, path, bytes);
  try {
    await writeRow();
  } catch (error) {
    await removeObject(client, bucket, path, log);
    throw error;
  }
}

function audioFor(audio: Map<string, Uint8Array>, id: string): Uint8Array {
  const bytes = audio.get(id);
  if (!bytes) throw new Error(`Audio for manifest entry "${id}" was not loaded`);
  return bytes;
}

/**
 * Applies the plan. Passwords of users created by this run are pushed to `credentials` as soon as each
 * user exists, so the caller can still print them if a later step fails.
 */
export async function applySeedPlan(
  client: AdminClient,
  plan: SeedPlan,
  audio: Map<string, Uint8Array>,
  credentials: CreatedCredential[],
  log: (line: string) => void,
): Promise<SeedSummary> {
  if (plan.conflicts.length > 0) throw new Error("The seed plan has conflicts; nothing was written.");
  const summary: SeedSummary = {
    users: [],
    businesses: [],
    genres: { created: 0, existing: 0 },
    genreAccessCreated: 0,
    membershipsCreated: 0,
    tracks: { created: 0, existing: 0 },
    announcements: { created: 0, audioAttached: 0, existing: 0 },
  };
  const venueName = (key: DemoBusinessKey | null) => plan.businesses.find((b) => b.business.key === key)?.business.name ?? null;

  // 1. Users ---------------------------------------------------------------------------------------
  log("Users…");
  const userIds = new Map<string, string>();
  let adminId: string | null = null;
  for (const user of plan.users) {
    let userId = user.userId;
    let status: SeedSummary["users"][number]["status"] = "existing";
    if (user.action === "create") {
      const password = generatePassword();
      const { data, error } = await client.auth.admin.createUser({ email: user.email, password, email_confirm: true });
      if (error && !isEmailExistsError(error)) throw new ScriptStepError(`create user ${user.email}`, error);
      if (error) {
        // Registered meanwhile (or an auth user without a profile row): keep its existing password.
        userId = (await findProfileByEmail(client, user.email))?.id ?? (await findAuthUserIdByEmail(client, user.email));
        if (!userId) throw new ScriptStepError(`find existing user ${user.email}`, error);
        log(`  ${user.email} already exists; its password is unchanged`);
      } else {
        userId = data.user.id;
        status = "created";
        credentials.push({ email: user.email, password, role: user.role, venue: venueName(user.businessKey) });
        // The auth trigger created the profile; the upsert also covers a database without the trigger.
        const { error: profileError } = await client
          .from("profiles")
          .upsert({ id: userId, email: user.email, full_name: user.fullName }, { onConflict: "id" });
        if (profileError) throw new ScriptStepError(`set the profile name of ${user.email}`, profileError);
        log(`  created ${user.email} (${user.role})`);
      }
    }
    if (!userId) throw new Error(`No user id for ${user.email}`);
    if (user.promote) {
      await promoteToPlatformAdmin(client, userId, user.email);
      if (status === "existing") status = "existing, promoted";
      log(`  ${user.email} is a platform admin`);
    }
    if (user.role === "platform_admin") adminId = userId;
    userIds.set(user.email, userId);
    summary.users.push({ email: user.email, role: user.role, venue: venueName(user.businessKey), status });
  }

  // 2. Genres --------------------------------------------------------------------------------------
  log("Genres…");
  const genreIds = new Map<string, string>();
  for (const genre of plan.genres) if (genre.id) genreIds.set(genre.genre.slug, genre.id);
  const newGenres: TablesInsert<"genres">[] = plan.genres
    .filter((genre) => genre.action === "create")
    .map(({ genre }) => ({
      name: genre.name,
      slug: genre.slug,
      description: genre.description,
      sort_order: genre.sortOrder,
      is_enabled: true,
      available_to_all: genre.availableToAll,
    }));
  if (newGenres.length > 0) {
    const { data, error } = await client.from("genres").insert(newGenres).select("id, slug");
    if (error) throw new ScriptStepError("create genres", error);
    for (const row of data) genreIds.set(row.slug, row.id);
  }
  summary.genres = { created: newGenres.length, existing: plan.genres.length - newGenres.length };

  // 3. Businesses ----------------------------------------------------------------------------------
  log("Businesses…");
  const businesses = new Map<DemoBusinessKey, { id: string; brandingVersion: number }>();
  for (const plannedBusiness of plan.businesses) {
    const { business } = plannedBusiness;
    if (plannedBusiness.action === "reuse") {
      const { id, brandingVersion } = plannedBusiness;
      if (!id || brandingVersion === null) throw new Error(`Existing business ${business.name} has no id`);
      let type = plannedBusiness.currentType ?? business.businessType;
      let status: SeedSummary["businesses"][number]["status"] = "existing";
      if (plannedBusiness.setType) {
        // Only while the row still has the column default, so a type an admin chose meanwhile is kept.
        // business_type is not branding: this never flags the venue's announcements for review.
        const { data, error } = await client
          .from("businesses")
          .update({ business_type: business.businessType })
          .eq("id", id)
          .eq("business_type", "other")
          .select("id");
        if (error) throw new ScriptStepError(`set the business type of ${business.name}`, error);
        if (data.length > 0) {
          type = business.businessType;
          status = "existing, type set";
          log(`  ${business.name}: business type set to ${businessTypeLabel(business.businessType)}`);
        }
      }
      businesses.set(business.key, { id, brandingVersion });
      summary.businesses.push({ name: business.name, id, type, status });
      continue;
    }
    const { data, error } = await client
      .from("businesses")
      .insert({
        name: business.name,
        station_name: business.stationName,
        name_pronunciation: business.namePronunciation,
        station_name_pronunciation: business.stationNamePronunciation,
        contact_email: business.contactEmail,
        business_type: business.businessType,
        announcement_language: "en",
        is_active: true,
        // The platform default (platform_settings), as the admin's "Add business" prefills it.
        announcement_every_n_tracks: plannedBusiness.everyNTracks,
        announcement_volume: 1,
      })
      .select("id, branding_version")
      .single();
    if (error) throw new ScriptStepError(`create business ${business.name}`, error);
    businesses.set(business.key, { id: data.id, brandingVersion: data.branding_version });
    summary.businesses.push({ name: business.name, id: data.id, type: business.businessType, status: "created" });
  }
  const businessFor = (key: string) => {
    const business = businesses.get(key as DemoBusinessKey);
    if (!business) throw new Error(`Business "${key}" was not created`);
    return business;
  };
  const genreIdFor = (slug: string) => {
    const id = genreIds.get(slug);
    if (!id) throw new Error(`Genre "${slug}" was not created`);
    return id;
  };

  // 4. Exclusive genre access ----------------------------------------------------------------------
  const accessRows = plan.genreAccess
    .filter((access) => access.action === "create")
    .map((access) => ({ business_id: businessFor(access.businessKey).id, genre_id: genreIdFor(access.genreSlug) }));
  if (accessRows.length > 0) {
    const { error } = await client.from("business_genre_access").upsert(accessRows, { onConflict: "business_id,genre_id", ignoreDuplicates: true });
    if (error) throw new ScriptStepError("grant exclusive genre access", error);
  }
  summary.genreAccessCreated = accessRows.length;

  // 5. Memberships ---------------------------------------------------------------------------------
  for (const user of plan.users) {
    if (user.membership !== "create" || !user.businessKey) continue;
    const userId = userIds.get(user.email);
    if (!userId) throw new Error(`No user id for ${user.email}`);
    const { error } = await client.from("business_members").insert({ business_id: businessFor(user.businessKey).id, user_id: userId });
    if (error) throw new ScriptStepError(`add ${user.email} to ${venueName(user.businessKey)}`, error);
    summary.membershipsCreated++;
  }

  // 6. Tracks --------------------------------------------------------------------------------------
  log("Tracks…");
  const trackGenreRows: { track_id: string; genre_id: string }[] = [];
  for (const track of plan.tracks) {
    const trackId = track.action === "reuse" && track.id ? track.id : await createTrack(client, track, audio, adminId, log);
    trackGenreRows.push({ track_id: trackId, genre_id: genreIdFor(track.entry.genre) });
    if (track.action === "reuse") summary.tracks.existing++;
    else summary.tracks.created++;
  }
  if (trackGenreRows.length > 0) {
    const { error } = await client.from("track_genres").upsert(trackGenreRows, { onConflict: "track_id,genre_id", ignoreDuplicates: true });
    if (error) throw new ScriptStepError("link tracks to genres", error);
  }

  // 7. Announcements -------------------------------------------------------------------------------
  log("Announcements…");
  for (const announcement of plan.announcements) {
    if (announcement.action === "reuse") {
      summary.announcements.existing++;
      continue;
    }
    await writeAnnouncement(client, announcement, businessFor(announcement.entry.business), audio, adminId, log);
    if (announcement.action === "create") summary.announcements.created++;
    else summary.announcements.audioAttached++;
  }

  return summary;
}

async function createTrack(
  client: AdminClient,
  track: TrackPlan,
  audio: Map<string, Uint8Array>,
  adminId: string | null,
  log: (line: string) => void,
): Promise<string> {
  const { entry } = track;
  const bytes = audioFor(audio, entry.id);
  const id = randomUUID();
  const path = `tracks/${id}/${randomObjectName()}`;
  await withUploadedObject(client, "music", path, bytes, log, async () => {
    const { error } = await client.from("tracks").insert({
      id,
      title: entry.title,
      artist: entry.artist,
      duration_seconds: entry.durationSeconds,
      storage_path: path,
      file_size_bytes: bytes.length,
      mime_type: "audio/mpeg",
      bitrate_kbps: entry.bitrateKbps,
      sample_rate_hz: entry.sampleRateHz,
      original_filename: posix.basename(entry.file),
      is_active: true,
      created_by: adminId,
    });
    if (error) throw new ScriptStepError(`create track "${entry.title}"`, error);
  });
  log(`  uploaded ${entry.title}`);
  return id;
}

async function writeAnnouncement(
  client: AdminClient,
  announcement: AnnouncementPlan,
  business: { id: string; brandingVersion: number },
  audio: Map<string, Uint8Array>,
  adminId: string | null,
  log: (line: string) => void,
): Promise<void> {
  const { entry } = announcement;
  const bytes = audioFor(audio, entry.id);
  const id = announcement.id ?? randomUUID();
  const path = `${business.id}/${id}/${randomObjectName()}`;
  const now = new Date().toISOString();
  // Approved, playable state: active + audio + approval + current branding (docs/ARCHITECTURE.md §5.2).
  const approvedAudio = {
    status: "active",
    source: "upload",
    audio_path: path,
    audio_duration_seconds: entry.durationSeconds,
    audio_size_bytes: bytes.length,
    needs_review: false,
    review_reason: null,
    last_error: null,
    branding_version: business.brandingVersion,
    approved_at: now,
    approved_by: adminId,
  } as const;
  await withUploadedObject(client, "announcements", path, bytes, log, async () => {
    if (announcement.action === "create") {
      const { error } = await client.from("announcements").insert({
        id,
        business_id: business.id,
        template_key: entry.templateKey,
        placement: entry.placement,
        text: entry.text,
        spoken_text: entry.spokenText,
        language: "en",
        created_by: adminId,
        ...approvedAudio,
      });
      if (error) throw new ScriptStepError(`create announcement "${entry.text}"`, error);
    } else {
      const { error } = await client.from("announcements").update(approvedAudio).eq("id", id);
      if (error) throw new ScriptStepError(`attach audio to announcement "${entry.text}"`, error);
    }
  });
  log(`  ${announcement.action === "create" ? "created" : "attached audio to"} "${entry.text}"`);
}
