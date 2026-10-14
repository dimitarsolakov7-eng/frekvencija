// Planning and Supabase I/O for `npm run demo:remove`, the counterpart of `npm run seed:dev`: finds
// the rows the seed created, lists their Storage objects, and deletes them. Every row must carry a
// seed marker (the example.com contact email of a demo venue, an example.com sign-in address, the
// demo artist on a "Test Loop" track, a demo genre slug), so real venues, users, music, genres and the
// platform settings are never touched; anything that looks similar but has no marker is listed as
// kept. Objects are removed before the row that points at them, so a failed run can simply be re-run.
import { parseArgs } from "node:util";
import type { Tables } from "../../src/types/database";
import { DEMO_ADMIN, DEMO_ARTIST, DEMO_BUSINESSES, DEMO_GENRES } from "./demo-catalog";
import type { EnvSource } from "./env";
import { normaliseEmail } from "./seed-plan";
import { MissingMigrationError, ScriptStepError, isMissingSchemaError, type AdminClient } from "./supabase-admin";
import { formatTable } from "./table";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RemoveCliOptions {
  yes: boolean;
  genres: boolean;
  dryRun: boolean;
  help: boolean;
}

export const REMOVE_USAGE = `Usage: npm run demo:remove -- --yes [--genres]
       npm run demo:remove -- --dry-run [--genres]

Deletes the demo data written by npm run seed:dev: the example venues EmeraldBar and Hotel Aurora
(with their announcements, logo, genre access and staff memberships), the demo users, and the
synthetic "Test Loop" tracks, together with their files in Storage. Real venues, users, music, genres
and the platform settings are never touched: anything without a seed marker is kept and listed.
Safe to re-run; a run that finds nothing deletes nothing.

  --yes       Required to delete anything.
  --genres    Also delete the demo genres (House, Deep House, Lounge, Jazz, Pop, Rock, R&B,
              Balkan Hits, Chillout) and their covers. A genre that still has other tracks is kept.
  --dry-run   Read the project and print what a real run would delete, without deleting anything.
  --help      Show this help.

Demo user addresses come from SEED_ADMIN_EMAIL, SEED_EMERALDBAR_EMAIL and SEED_AURORA_EMAIL as for
the seed. The demo admin is deleted only when its address is under example.com, and never when it is
the only platform admin.`;

/** Parses demo:remove arguments; throws a TypeError for unknown options. */
export function parseRemoveArgs(argv: string[]): RemoveCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      yes: { type: "boolean", default: false },
      genres: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return { yes: values.yes, genres: values.genres, dryRun: values["dry-run"], help: values.help };
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** example.com is reserved (RFC 2606): an address under it can never belong to a real person. */
export function isExampleAddress(email: string): boolean {
  const domain = normaliseEmail(email).split("@")[1] ?? "";
  return domain === "example.com" || domain.endsWith(".example.com");
}

/** Titles produced by demo-catalog.ts, e.g. "Test Loop 07 — Deep House (synthetic)". */
const DEMO_TRACK_TITLE = /^Test Loop \d{2} — .+ \(synthetic\)$/u;

export function isDemoTrack(track: { title: string; artist: string }): boolean {
  return track.artist === DEMO_ARTIST && DEMO_TRACK_TITLE.test(track.title);
}

/** The demo venue a business row belongs to: same name (case-insensitive) and the seed-marker contact email. */
function demoBusinessFor(row: { name: string; contact_email: string | null }) {
  return DEMO_BUSINESSES.find(
    (business) =>
      row.name.trim().toLowerCase() === business.name.toLowerCase() &&
      normaliseEmail(row.contact_email ?? "") === business.contactEmail.toLowerCase(),
  );
}

/** The demo sign-in addresses, as the seed resolved them (env overrides, else the example.com defaults). */
export function demoUserEmails(env: EnvSource): { admin: string; venueUsers: string[] } {
  const pick = (envVar: string, fallback: string) => normaliseEmail(env[envVar]?.trim() || fallback);
  return {
    admin: pick(DEMO_ADMIN.envVar, DEMO_ADMIN.defaultEmail),
    venueUsers: DEMO_BUSINESSES.map((business) => pick(business.user.envVar, business.user.defaultEmail)),
  };
}

// ---------------------------------------------------------------------------
// Existing rows (read-only)
// ---------------------------------------------------------------------------

export interface DemoState {
  /** Businesses with a demo venue's name (the marker email is checked by the planner). */
  businesses: Pick<Tables<"businesses">, "id" | "name" | "contact_email" | "logo_path">[];
  announcements: Pick<Tables<"announcements">, "id" | "business_id" | "audio_path" | "text">[];
  /** Memberships of the demo venues, plus every membership of the profiles below. */
  members: Pick<Tables<"business_members">, "business_id" | "user_id">[];
  /** Profiles of the demo venues' members, plus the demo addresses (the seed's defaults or SEED_* values). */
  profiles: Pick<Tables<"profiles">, "id" | "email" | "role">[];
  /** Number of platform admins in the project (the demo admin is never the last one standing). */
  adminCount: number;
  /** Tracks credited to the demo artist (the title pattern is checked by the planner). */
  tracks: Pick<Tables<"tracks">, "id" | "title" | "artist" | "storage_path">[];
  /** Genres with a demo slug. */
  genres: Pick<Tables<"genres">, "id" | "slug" | "name" | "cover_path" | "available_to_all">[];
  /** Every track link of those genres (to tell demo tracks from the owner's own). */
  genreTracks: Pick<Tables<"track_genres">, "genre_id" | "track_id">[];
  /** Every access row of those genres (to tell demo venues from real ones). */
  genreAccess: Pick<Tables<"business_genre_access">, "business_id" | "genre_id">[];
}

/** Reads the rows the planner needs. Like the seed, a missing migration is reported before anything happens. */
export async function readDemoState(client: AdminClient, env: EnvSource = process.env): Promise<DemoState> {
  const check = <T>(step: string, result: { data: T[] | null; error: unknown }): T[] => {
    if (result.error) {
      throw isMissingSchemaError(result.error) ? new MissingMigrationError(step, result.error) : new ScriptStepError(`read ${step}`, result.error);
    }
    return result.data ?? [];
  };

  const businesses: DemoState["businesses"] = [];
  for (const business of DEMO_BUSINESSES) {
    // ilike without wildcards = case-insensitive equality (demo names contain no % or _).
    businesses.push(
      ...check("businesses", await client.from("businesses").select("id, name, contact_email, logo_path").ilike("name", business.name)),
    );
  }
  const businessIds = businesses.map((row) => row.id);
  const announcements =
    businessIds.length > 0
      ? check("announcements", await client.from("announcements").select("id, business_id, audio_path, text").in("business_id", businessIds))
      : [];
  const members =
    businessIds.length > 0
      ? check("memberships", await client.from("business_members").select("business_id, user_id").in("business_id", businessIds))
      : [];

  // Demo users are found by membership and by address, so a user whose venue is already gone (an
  // interrupted earlier run) is still found; their other memberships show whether a real venue uses them.
  const emails = demoUserEmails(env);
  const memberIds = [...new Set(members.map((row) => row.user_id))];
  const profiles = memberIds.length > 0 ? check("profiles", await client.from("profiles").select("id, email, role").in("id", memberIds)) : [];
  const byAddress = check("profiles", await client.from("profiles").select("id, email, role").in("email", [emails.admin, ...emails.venueUsers]));
  for (const profile of byAddress) if (!profiles.some((row) => row.id === profile.id)) profiles.push(profile);
  const profileIds = profiles.map((row) => row.id);
  const otherMemberships = profileIds.length > 0 ? check("memberships", await client.from("business_members").select("business_id, user_id").in("user_id", profileIds)) : [];
  for (const membership of otherMemberships) {
    if (!members.some((row) => row.business_id === membership.business_id && row.user_id === membership.user_id)) members.push(membership);
  }
  const adminCount = check("profiles", await client.from("profiles").select("id").eq("role", "platform_admin")).length;

  const tracks = check("tracks", await client.from("tracks").select("id, title, artist, storage_path").eq("artist", DEMO_ARTIST));

  const genres = check(
    "genres",
    await client
      .from("genres")
      .select("id, slug, name, cover_path, available_to_all")
      .in(
        "slug",
        DEMO_GENRES.map((genre) => genre.slug),
      ),
  );
  const genreIds = genres.map((row) => row.id);
  const genreTracks = genreIds.length > 0 ? check("track links", await client.from("track_genres").select("genre_id, track_id").in("genre_id", genreIds)) : [];
  const genreAccess =
    genreIds.length > 0 ? check("genre access", await client.from("business_genre_access").select("business_id, genre_id").in("genre_id", genreIds)) : [];

  return { businesses, announcements, members, profiles, adminCount, tracks, genres, genreTracks, genreAccess };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface BusinessRemoval {
  id: string;
  name: string;
  contactEmail: string;
  logoPath: string | null;
  announcements: { id: string; audioPath: string | null; text: string }[];
  /** Staff memberships that go with the venue (their accounts are listed under users or keptUsers). */
  memberCount: number;
}

export interface UserRemoval {
  id: string;
  email: string;
  role: string;
  venue: string | null;
}

export interface TrackRemoval {
  id: string;
  title: string;
  storagePath: string;
}

export interface GenreRemoval {
  id: string;
  slug: string;
  name: string;
  coverPath: string | null;
}

export interface GenreReopen {
  id: string;
  name: string;
}

export interface RemovePlan {
  businesses: BusinessRemoval[];
  users: UserRemoval[];
  tracks: TrackRemoval[];
  /** Only with --genres: demo genres without other tracks. */
  genres: GenreRemoval[];
  /** Demo genres the seed made exclusive to demo venues: offered to all businesses again (not with --genres). */
  reopenGenres: GenreReopen[];
  /** Rows that looked like demo data but are kept, and other remarks. */
  notes: string[];
}

export function isEmptyPlan(plan: RemovePlan): boolean {
  return plan.businesses.length === 0 && plan.users.length === 0 && plan.tracks.length === 0 && plan.genres.length === 0 && plan.reopenGenres.length === 0;
}

/** Decides, from a snapshot, exactly which rows and objects a run deletes. Pure, so --dry-run shows the real plan. */
export function buildRemovePlan(state: DemoState, options: { genres: boolean; env?: EnvSource }): RemovePlan {
  const env = options.env ?? process.env;
  const notes: string[] = [];
  const emails = demoUserEmails(env);

  // Businesses: name + marker email. A same-named venue without the marker is the owner's and is kept.
  const businesses: BusinessRemoval[] = [];
  for (const row of state.businesses) {
    const demo = demoBusinessFor(row);
    if (!demo) {
      notes.push(`"${row.name}" (contact ${row.contact_email ?? "none"}) is not seed demo data (its contact email is not the seed marker); it is kept.`);
      continue;
    }
    businesses.push({
      id: row.id,
      name: row.name,
      contactEmail: row.contact_email ?? demo.contactEmail,
      logoPath: row.logo_path,
      announcements: state.announcements
        .filter((announcement) => announcement.business_id === row.id)
        .map((announcement) => ({ id: announcement.id, audioPath: announcement.audio_path, text: announcement.text })),
      memberCount: state.members.filter((member) => member.business_id === row.id).length,
    });
  }
  const demoBusinessIds = new Set(businesses.map((business) => business.id));
  const venueOf = (userId: string) => {
    const membership = state.members.find((member) => member.user_id === userId && demoBusinessIds.has(member.business_id));
    return membership ? (businesses.find((business) => business.id === membership.business_id)?.name ?? null) : null;
  };
  const usedByRealVenue = (userId: string) => state.members.some((member) => member.user_id === userId && !demoBusinessIds.has(member.business_id));

  // Users: staff of demo venues with a demo address (example.com, or the SEED_* address the seed was
  // given), never an admin and never a member of a real venue. The demo admin only when it is under
  // example.com and not the last admin.
  const users: UserRemoval[] = [];
  const seen = new Set<string>();
  for (const profile of state.profiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    const email = normaliseEmail(profile.email);
    const venue = venueOf(profile.id);
    const seedAddress = emails.venueUsers.includes(email);
    if (profile.role === "platform_admin") {
      if (email !== emails.admin || !isExampleAddress(email)) {
        if (venue) notes.push(`${profile.email} is a platform admin and a member of ${venue}; the account is kept (the membership goes with the venue).`);
        continue;
      }
      if (state.adminCount <= 1) {
        notes.push(
          `${profile.email} is the only platform admin, so it is kept. Make your own account an admin first ` +
            "(npm run admin:create -- you@yourcompany.com) and run this again.",
        );
        continue;
      }
      users.push({ id: profile.id, email: profile.email, role: profile.role, venue });
      continue;
    }
    if (!venue && !seedAddress) continue; // The demo admin address with another role: not seed data.
    if (!isExampleAddress(email) && !seedAddress) {
      notes.push(`${profile.email} is a member of ${venue} but not a demo address; the account is kept and can be invited to another venue.`);
    } else if (usedByRealVenue(profile.id)) {
      notes.push(`${profile.email} is also a member of another venue; the account is kept.`);
    } else {
      users.push({ id: profile.id, email: profile.email, role: profile.role, venue });
    }
  }

  // Tracks: demo artist + "Test Loop NN — Genre (synthetic)" title.
  const tracks: TrackRemoval[] = [];
  for (const row of state.tracks) {
    if (isDemoTrack(row)) tracks.push({ id: row.id, title: row.title, storagePath: row.storage_path });
    else notes.push(`Track "${row.title}" is credited to ${DEMO_ARTIST} but is not a demo loop; it is kept.`);
  }
  const demoTrackIds = new Set(tracks.map((track) => track.id));

  // Genres: deleted only with --genres and only when no other track uses them. Otherwise, an exclusive
  // demo genre whose only access rows belonged to demo venues is offered to all businesses again, so
  // it does not end up as "Selected businesses" with nobody selected.
  const genres: GenreRemoval[] = [];
  const reopenGenres: GenreReopen[] = [];
  for (const genre of state.genres) {
    const otherTracks = state.genreTracks.filter((link) => link.genre_id === genre.id && !demoTrackIds.has(link.track_id)).length;
    const otherAccess = state.genreAccess.filter((access) => access.genre_id === genre.id && !demoBusinessIds.has(access.business_id)).length;
    if (options.genres) {
      if (otherTracks > 0) {
        notes.push(`Genre "${genre.name}" has ${otherTracks} other track${otherTracks === 1 ? "" : "s"}; it is kept.`);
        continue;
      }
      if (otherAccess > 0) notes.push(`Genre "${genre.name}" was offered to ${otherAccess} other business${otherAccess === 1 ? "" : "es"}; that access goes with it.`);
      genres.push({ id: genre.id, slug: genre.slug, name: genre.name, coverPath: genre.cover_path });
    } else if (!genre.available_to_all && otherAccess === 0) {
      reopenGenres.push({ id: genre.id, name: genre.name });
    }
  }
  if (!options.genres && state.genres.length > 0) {
    notes.push(`The ${state.genres.length} demo genres are kept (empty, ready for your music); pass --genres to delete them too.`);
  }
  if (reopenGenres.length > 0) {
    notes.push(`${reopenGenres.map((genre) => `"${genre.name}"`).join(" and ")} were offered only to demo venues; they are set to all businesses.`);
  }

  return { businesses, users, tracks, genres, reopenGenres, notes };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function formatRemovePlan(plan: RemovePlan): string {
  const out: string[] = [];
  const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

  out.push(`\nBusinesses (${plan.businesses.length}; with their announcements, logo, genre access and staff memberships)`);
  out.push(
    formatTable(
      ["Name", "Contact (seed marker)", "Announcements", "Logo", "Members"],
      plan.businesses.map((business) => [
        business.name,
        business.contactEmail,
        String(business.announcements.length),
        business.logoPath ? "yes" : "-",
        String(business.memberCount),
      ]),
    ),
  );

  out.push(`\nUsers (${plan.users.length}; sign-in accounts)`);
  out.push(formatTable(["Email", "Role", "Venue"], plan.users.map((user) => [user.email, user.role, user.venue ?? "-"])));

  out.push(`\nTracks (${plan.tracks.length}; rows and their files in bucket "music")`);
  out.push(formatTable(["Title", "File"], plan.tracks.map((track) => [track.title, track.storagePath])));

  if (plan.genres.length > 0) {
    out.push(`\nGenres (${plan.genres.length}; --genres)`);
    out.push(formatTable(["Name", "Slug", "Cover"], plan.genres.map((genre) => [genre.name, genre.slug, genre.coverPath ? "yes" : "-"])));
  }

  if (plan.notes.length > 0) out.push(`\nNotes:\n${plan.notes.map((note) => `  - ${note}`).join("\n")}`);
  out.push(
    isEmptyPlan(plan)
      ? "\nNo demo data found: nothing to delete."
      : `\nTotal: ${n(plan.businesses.length, "business")}, ${n(plan.users.length, "user")}, ${n(plan.tracks.length, "track")}` +
          (plan.genres.length > 0 ? `, ${n(plan.genres.length, "genre")}` : "") +
          ".",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Storage helpers (mirror src/lib/data/admin/businesses.ts, which cannot run under tsx)
// ---------------------------------------------------------------------------

type Bucket = "music" | "announcements" | "logos" | "genre-covers";

const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 200;
const REMOVE_BATCH_SIZE = 100;

/** All object paths under `prefix` in a bucket, following folders `depth` levels deep. */
async function listObjectsUnder(client: AdminClient, bucket: Bucket, prefix: string, depth: number): Promise<string[]> {
  const files: string[] = [];
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: LIST_PAGE_SIZE,
      offset: page * LIST_PAGE_SIZE,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new ScriptStepError(`list ${bucket}/${prefix}`, error);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        if (depth > 0) files.push(...(await listObjectsUnder(client, bucket, path, depth - 1)));
      } else {
        files.push(path);
      }
    }
    if (entries.length < LIST_PAGE_SIZE) return files;
  }
  throw new ScriptStepError(`list ${bucket}/${prefix}`, new Error("too many files to list"));
}

/** Removes objects in batches; objects that are already gone are not an error. Returns how many were requested. */
async function removeObjects(client: AdminClient, bucket: Bucket, paths: readonly string[]): Promise<number> {
  const unique = [...new Set(paths)];
  for (let index = 0; index < unique.length; index += REMOVE_BATCH_SIZE) {
    const batch = unique.slice(index, index + REMOVE_BATCH_SIZE);
    const { error } = await client.storage.from(bucket).remove(batch);
    if (error) throw new ScriptStepError(`delete ${batch.length} file(s) from ${bucket}`, error);
  }
  return unique.length;
}

/** Only paths inside `prefix/`: a bad database value can never delete another row's files. */
function insidePrefix(prefix: string, paths: (string | null)[]): string[] {
  const folder = `${prefix}/`;
  return paths.filter((path): path is string => Boolean(path && path.startsWith(folder) && !path.slice(folder.length).split("/").includes("..")));
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface RemoveSummary {
  businesses: number;
  announcements: number;
  users: number;
  tracks: number;
  genres: number;
  genresReopened: number;
  /** Storage objects whose removal was requested. */
  objects: number;
}

/**
 * Executes the plan: for every row, its Storage objects first (listed under the row's own folder plus
 * the paths the database knows), then the row. Businesses cascade to announcements, memberships,
 * genre access and playback preferences; tracks to their genre links; deleting an auth user removes
 * its profile. A step that fails stops the run with the step named; re-running continues from there.
 */
export async function applyRemovePlan(client: AdminClient, plan: RemovePlan, log: (line: string) => void): Promise<RemoveSummary> {
  const summary: RemoveSummary = { businesses: 0, announcements: 0, users: 0, tracks: 0, genres: 0, genresReopened: 0, objects: 0 };

  // 1. Businesses ----------------------------------------------------------------------------------
  if (plan.businesses.length > 0) log("Businesses…");
  for (const business of plan.businesses) {
    const announcementPaths = insidePrefix(business.id, [
      ...(await listObjectsUnder(client, "announcements", business.id, 1)),
      ...business.announcements.map((announcement) => announcement.audioPath),
    ]);
    const logoPaths = insidePrefix(business.id, [...(await listObjectsUnder(client, "logos", business.id, 0)), business.logoPath]);
    summary.objects += await removeObjects(client, "announcements", announcementPaths);
    summary.objects += await removeObjects(client, "logos", logoPaths);
    const { error } = await client.from("businesses").delete().eq("id", business.id);
    if (error) throw new ScriptStepError(`delete business ${business.name}`, error);
    summary.businesses += 1;
    summary.announcements += business.announcements.length;
    log(`  deleted ${business.name} (${business.announcements.length} announcements, ${announcementPaths.length + logoPaths.length} files)`);
  }

  // 2. Tracks --------------------------------------------------------------------------------------
  if (plan.tracks.length > 0) {
    log("Tracks…");
    const paths: string[] = [];
    for (const track of plan.tracks) {
      const folder = `tracks/${track.id}`;
      paths.push(...insidePrefix(folder, [...(await listObjectsUnder(client, "music", folder, 0)), track.storagePath]));
    }
    summary.objects += await removeObjects(client, "music", paths);
    const { error } = await client
      .from("tracks")
      .delete()
      .in(
        "id",
        plan.tracks.map((track) => track.id),
      );
    if (error) throw new ScriptStepError("delete the demo tracks", error);
    summary.tracks = plan.tracks.length;
    log(`  deleted ${plan.tracks.length} tracks (${paths.length} files)`);
  }

  // 3. Genres --------------------------------------------------------------------------------------
  if (plan.genres.length > 0) log("Genres…");
  for (const genre of plan.genres) {
    if (genre.coverPath) summary.objects += await removeObjects(client, "genre-covers", [genre.coverPath]);
    const { error } = await client.from("genres").delete().eq("id", genre.id);
    if (error) throw new ScriptStepError(`delete genre ${genre.name}`, error);
    summary.genres += 1;
    log(`  deleted ${genre.name}`);
  }
  if (plan.reopenGenres.length > 0) {
    const { error } = await client
      .from("genres")
      .update({ available_to_all: true })
      .in(
        "id",
        plan.reopenGenres.map((genre) => genre.id),
      );
    if (error) throw new ScriptStepError("offer the demo genres to all businesses", error);
    summary.genresReopened = plan.reopenGenres.length;
    log(`  ${plan.reopenGenres.map((genre) => genre.name).join(", ")}: now offered to all businesses`);
  }

  // 4. Users ---------------------------------------------------------------------------------------
  if (plan.users.length > 0) log("Users…");
  for (const user of plan.users) {
    const { error } = await client.auth.admin.deleteUser(user.id);
    if (error && error.code !== "user_not_found") throw new ScriptStepError(`delete user ${user.email}`, error);
    summary.users += 1;
    log(`  deleted ${user.email}${error ? " (was already gone)" : ""}`);
  }

  return summary;
}
