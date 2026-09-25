// Pure planning logic for `npm run seed:dev`: CLI parsing, safety checks, user emails, and the plan
// (what to create vs. reuse) computed from a snapshot of existing rows. No I/O here, so every rule is
// unit-tested and `--dry-run` can print the plan without touching the network.
import { parseArgs } from "node:util";
import { DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS } from "../../src/config/platform";
import type { AppRole, BusinessTypeEnum, Tables } from "../../src/types/database";
import {
  DEMO_ADMIN,
  DEMO_BUSINESSES,
  DEMO_GENRES,
  businessTypeLabel,
  findDemoBusiness,
  findDemoGenre,
  type DemoBusiness,
  type DemoBusinessKey,
  type DemoGenre,
} from "./demo-catalog";
import { isLocalUrl, type EnvSource } from "./env";
import type { AnnouncementManifestEntry, DemoAudioManifest, TrackManifestEntry } from "./manifest";
import { formatTable } from "./table";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface SeedCliOptions {
  yes: boolean;
  allowRemote: boolean;
  dryRun: boolean;
  adminEmail: string | null;
  help: boolean;
}

export const SEED_USAGE = `Usage: npm run seed:dev -- --yes [--allow-remote] [--admin-email <email>]
       npm run seed:dev -- --dry-run

Creates demo genres, the example venues EmeraldBar (a bar) and Hotel Aurora (a hotel), demo users,
the synthetic demo tracks and the venues' demo announcements. Safe to re-run: existing demo rows are
reused. New venues get the platform's default announcement frequency (Settings); platform settings
themselves are never written. Needs every migration in supabase/migrations/ to be applied.

  --yes                 Required to write anything.
  --allow-remote        Also required when NEXT_PUBLIC_SUPABASE_URL is not localhost/127.0.0.1.
  --admin-email <email> Admin account email (default: SEED_ADMIN_EMAIL, else ${DEMO_ADMIN.defaultEmail}).
  --dry-run             Print the plan without any network call (nothing is written).
  --help                Show this help.

Venue user emails: SEED_EMERALDBAR_EMAIL, SEED_AURORA_EMAIL (defaults under example.com).
Never runs with NODE_ENV=production.`;

/** Parses seed:dev arguments; throws a TypeError for unknown options or a missing option value. */
export function parseSeedArgs(argv: string[]): SeedCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      yes: { type: "boolean", default: false },
      "allow-remote": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "admin-email": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    yes: values.yes,
    allowRemote: values["allow-remote"],
    dryRun: values["dry-run"],
    adminEmail: values["admin-email"] ?? null,
    help: values.help,
  };
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export interface SeedTarget {
  url: string | null;
  host: string | null;
  local: boolean;
}

export interface SafetyReport {
  target: SeedTarget;
  /** Why a real (non-dry) run must not proceed; empty ⇒ allowed. */
  refusals: string[];
}

export interface SafetyInput {
  nodeEnv: string | undefined;
  supabaseUrl: string | null;
  yes: boolean;
  allowRemote: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function evaluateSeedSafety(input: SafetyInput): SafetyReport {
  const host = input.supabaseUrl ? hostOf(input.supabaseUrl) : null;
  const target: SeedTarget = { url: input.supabaseUrl, host, local: input.supabaseUrl ? isLocalUrl(input.supabaseUrl) : false };
  const refusals: string[] = [];
  if (input.nodeEnv?.trim().toLowerCase() === "production") {
    refusals.push("NODE_ENV is \"production\". The development seed creates demo users with printed passwords and never runs in production.");
  }
  if (!input.supabaseUrl) {
    refusals.push("NEXT_PUBLIC_SUPABASE_URL is not set, so there is no project to seed. Add it to .env.local.");
  } else if (!target.local && !input.allowRemote) {
    refusals.push(
      `NEXT_PUBLIC_SUPABASE_URL points at ${host}, which is not localhost/127.0.0.1. The seed adds demo venues, ` +
        "demo users and synthetic tracks; if this really is a development project, pass --allow-remote as well.",
    );
  }
  if (!input.yes) {
    refusals.push(`Pass --yes to confirm that demo data should be written to ${host ?? "the configured project"}.`);
  }
  return { target, refusals };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Same shape as the businesses.contact_email check; auth normalises emails to lowercase. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export interface SeedUserSpec {
  role: AppRole;
  email: string;
  fullName: string;
  /** The venue a business user belongs to (null for the admin). */
  businessKey: DemoBusinessKey | null;
  /** Where the email came from, for messages ("--admin-email", "SEED_ADMIN_EMAIL", "default"). */
  source: string;
}

export function resolveSeedUsers(cli: Pick<SeedCliOptions, "adminEmail">, env: EnvSource): { users: SeedUserSpec[]; problems: string[] } {
  const pick = (flag: string | null, flagName: string | null, envVar: string, fallback: string) => {
    if (flag?.trim()) return { email: normaliseEmail(flag), source: flagName ?? envVar };
    const fromEnv = env[envVar]?.trim();
    if (fromEnv) return { email: normaliseEmail(fromEnv), source: envVar };
    return { email: fallback, source: "default" };
  };
  const admin = pick(cli.adminEmail, "--admin-email", DEMO_ADMIN.envVar, DEMO_ADMIN.defaultEmail);
  const users: SeedUserSpec[] = [
    { role: "platform_admin", email: admin.email, fullName: DEMO_ADMIN.fullName, businessKey: null, source: admin.source },
    ...DEMO_BUSINESSES.map((business): SeedUserSpec => {
      const chosen = pick(null, null, business.user.envVar, business.user.defaultEmail);
      return { role: "business_user", email: chosen.email, fullName: business.user.fullName, businessKey: business.key, source: chosen.source };
    }),
  ];
  const problems: string[] = [];
  for (const user of users) {
    if (!isPlausibleEmail(user.email)) problems.push(`"${user.email}" (from ${user.source}) is not a valid email address.`);
  }
  const seen = new Map<string, SeedUserSpec>();
  for (const user of users) {
    const other = seen.get(user.email);
    if (other) problems.push(`${user.email} is used for two demo users (${other.source} and ${user.source}); each needs its own email.`);
    seen.set(user.email, user);
  }
  return { users, problems };
}

// ---------------------------------------------------------------------------
// Existing rows (read by seed-dev.ts before planning)
// ---------------------------------------------------------------------------

export interface ExistingState {
  genres: Pick<Tables<"genres">, "id" | "slug" | "name">[];
  businesses: Pick<
    Tables<"businesses">,
    "id" | "name" | "contact_email" | "branding_version" | "is_active" | "business_type" | "announcement_every_n_tracks"
  >[];
  genreAccess: Pick<Tables<"business_genre_access">, "business_id" | "genre_id">[];
  tracks: Pick<Tables<"tracks">, "id" | "title" | "is_active" | "removed_at">[];
  announcements: Pick<
    Tables<"announcements">,
    "id" | "business_id" | "template_key" | "status" | "audio_path" | "needs_review" | "branding_version"
  >[];
  profiles: Pick<Tables<"profiles">, "id" | "email" | "role">[];
  memberships: Pick<Tables<"business_members">, "business_id" | "user_id">[];
  /**
   * The platform_settings singleton, read (never written) for the announcement frequency new venues
   * start with. null when the row is missing, and in a dry run, which reads nothing.
   */
  platformSettings: Pick<Tables<"platform_settings">, "default_announcement_every_n_tracks"> | null;
}

export const EMPTY_EXISTING_STATE: ExistingState = {
  genres: [],
  businesses: [],
  genreAccess: [],
  tracks: [],
  announcements: [],
  profiles: [],
  memberships: [],
  platformSettings: null,
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type RowAction = "create" | "reuse";

export interface GenrePlan {
  genre: DemoGenre;
  action: RowAction;
  id: string | null;
  /** Demo tracks in the manifest for this genre. */
  trackCount: number;
  /** Names of the venues given an access row (exclusive genres only). */
  exclusiveTo: string[];
}

export interface BusinessPlan {
  business: DemoBusiness;
  action: RowAction;
  id: string | null;
  brandingVersion: number | null;
  /** New row: the platform default (SeedPlan.announcementFrequency). Existing row: its own value, left unchanged. */
  everyNTracks: number;
  /** The existing row's business type (null for a new row). */
  currentType: BusinessTypeEnum | null;
  /**
   * An existing demo row still has the column default "other" (it was seeded before business types
   * existed), so the seed sets the demo type. A type an admin chose is left as it is.
   */
  setType: boolean;
}

export interface AnnouncementFrequencyPlan {
  /** Completed songs between announcements for demo venues created by this run. */
  everyNTracks: number;
  /** Where it comes from: platform_settings.default_announcement_every_n_tracks, or the built-in default (4). */
  source: "platform settings" | "built-in default";
}

export interface UserPlan extends SeedUserSpec {
  action: RowAction;
  userId: string | null;
  /** Current profiles.role for an existing user. */
  currentRole: AppRole | null;
  /** Set profiles.role = platform_admin. */
  promote: boolean;
  membership: "create" | "exists" | "none";
}

export interface GenreAccessPlan {
  businessKey: DemoBusinessKey;
  genreSlug: string;
  action: "create" | "exists";
}

export interface TrackPlan {
  entry: TrackManifestEntry;
  action: RowAction;
  id: string | null;
}

export interface AnnouncementPlan {
  entry: AnnouncementManifestEntry;
  /** attach-audio: the row exists (matched by venue + template) but has no audio yet. */
  action: "create" | "attach-audio" | "reuse";
  id: string | null;
}

export interface SeedPlan {
  users: UserPlan[];
  genres: GenrePlan[];
  businesses: BusinessPlan[];
  /** Announcement frequency for new demo venues (what "Add business" in the admin would prefill). */
  announcementFrequency: AnnouncementFrequencyPlan;
  genreAccess: GenreAccessPlan[];
  tracks: TrackPlan[];
  announcements: AnnouncementPlan[];
  /** Problems that make seeding unsafe; nothing may be written while any exist. */
  conflicts: string[];
  /** Informational remarks (existing rows left as they are, etc.). */
  notes: string[];
}

export interface SeedPlanInput {
  manifest: DemoAudioManifest;
  users: SeedUserSpec[];
  existing: ExistingState;
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function planGenres(existing: ExistingState, manifest: DemoAudioManifest, notes: string[]): GenrePlan[] {
  return DEMO_GENRES.map((genre) => {
    const bySlug = existing.genres.find((row) => row.slug === genre.slug);
    const byName = bySlug ? undefined : existing.genres.find((row) => sameText(row.name, genre.name));
    if (byName) notes.push(`Genre "${genre.name}" exists with slug "${byName.slug}"; it is reused as is.`);
    const match = bySlug ?? byName;
    return {
      genre,
      action: match ? "reuse" : "create",
      id: match?.id ?? null,
      trackCount: manifest.entries.filter((entry) => entry.kind === "track" && entry.genre === genre.slug).length,
      exclusiveTo: DEMO_BUSINESSES.filter((business) => business.exclusiveGenreSlugs.includes(genre.slug)).map((business) => business.name),
    };
  });
}

/** Mirrors the admin's "Add business": the platform default when the settings row has a valid one, else 4. */
function planAnnouncementFrequency(existing: ExistingState): AnnouncementFrequencyPlan {
  const value = existing.platformSettings?.default_announcement_every_n_tracks;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50
    ? { everyNTracks: value, source: "platform settings" }
    : { everyNTracks: DEFAULT_ANNOUNCEMENT_EVERY_N_TRACKS, source: "built-in default" };
}

function planBusinesses(existing: ExistingState, frequency: AnnouncementFrequencyPlan, conflicts: string[], notes: string[]): BusinessPlan[] {
  return DEMO_BUSINESSES.map((business): BusinessPlan => {
    const sameName = existing.businesses.filter((row) => sameText(row.name, business.name));
    const marked = sameName.filter((row) => sameText(row.contact_email, business.contactEmail));
    if (marked.length > 1) {
      conflicts.push(`${marked.length} demo businesses named "${business.name}" exist (contact ${business.contactEmail}); delete the extra ones first.`);
    } else if (marked.length === 0 && sameName.length > 0) {
      conflicts.push(
        `A business named "${business.name}" already exists but is not seed demo data (its contact email is not ${business.contactEmail}). ` +
          "The seed never modifies real venues: rename or delete it, then re-run.",
      );
    }
    const match = marked.length === 1 ? marked[0] : null;
    if (match && !match.is_active) notes.push(`Demo business "${business.name}" exists but is inactive; the seed leaves it inactive.`);
    // "other" is the column default, i.e. a demo row from before business types: give it the demo type.
    const setType = Boolean(match && match.business_type === "other" && business.businessType !== "other");
    if (match && !setType && match.business_type !== business.businessType) {
      notes.push(
        `Demo business "${business.name}" has the type ${businessTypeLabel(match.business_type)} ` +
          `(the demo type is ${businessTypeLabel(business.businessType)}); the seed leaves it as it is.`,
      );
    }
    return {
      business,
      action: match ? "reuse" : "create",
      id: match?.id ?? null,
      brandingVersion: match?.branding_version ?? null,
      everyNTracks: match ? match.announcement_every_n_tracks : frequency.everyNTracks,
      currentType: match?.business_type ?? null,
      setType,
    };
  });
}

function planUsers(input: SeedPlanInput, businesses: BusinessPlan[], conflicts: string[], notes: string[]): UserPlan[] {
  const { existing } = input;
  return input.users.map((spec): UserPlan => {
    const profile = existing.profiles.find((row) => normaliseEmail(row.email) === spec.email) ?? null;
    const memberships = profile ? existing.memberships.filter((row) => row.user_id === profile.id) : [];
    const base = { ...spec, action: profile ? ("reuse" as const) : ("create" as const), userId: profile?.id ?? null, currentRole: profile?.role ?? null };

    if (spec.role === "platform_admin") {
      if (memberships.length > 0) notes.push(`Admin ${spec.email} is also a venue member; that membership is left as is.`);
      return { ...base, promote: !profile || profile.role !== "platform_admin", membership: "none" };
    }

    const business = businesses.find((plan) => plan.business.key === spec.businessKey);
    if (profile?.role === "platform_admin") {
      conflicts.push(`${spec.email} (${spec.source}) is a platform admin and cannot be the ${business?.business.name ?? "venue"} demo user. Use another email.`);
    }
    let membership: UserPlan["membership"] = "create";
    if (memberships.length > 0) {
      if (business?.id && memberships.some((row) => row.business_id === business.id)) {
        membership = "exists";
      } else {
        conflicts.push(
          `${spec.email} (${spec.source}) already belongs to another venue (a user can belong to one venue only). ` +
            `Use another email for the ${business?.business.name ?? "venue"} demo user.`,
        );
      }
    }
    return { ...base, promote: false, membership };
  });
}

function planGenreAccess(existing: ExistingState, genres: GenrePlan[], businesses: BusinessPlan[]): GenreAccessPlan[] {
  const plans: GenreAccessPlan[] = [];
  for (const business of businesses) {
    for (const slug of business.business.exclusiveGenreSlugs) {
      const genre = genres.find((plan) => plan.genre.slug === slug);
      const exists = Boolean(
        genre?.id && business.id && existing.genreAccess.some((row) => row.business_id === business.id && row.genre_id === genre.id),
      );
      plans.push({ businessKey: business.business.key, genreSlug: slug, action: exists ? "exists" : "create" });
    }
  }
  return plans;
}

function planTracks(input: SeedPlanInput, conflicts: string[], notes: string[]): TrackPlan[] {
  const entries = input.manifest.entries.filter((entry): entry is TrackManifestEntry => entry.kind === "track");
  return entries.map((entry) => {
    if (!findDemoGenre(entry.genre)) conflicts.push(`Manifest track "${entry.title}" has unknown genre "${entry.genre}"; re-run npm run demo:audio.`);
    const matches = input.existing.tracks.filter((row) => row.title === entry.title);
    if (matches.length > 1) notes.push(`${matches.length} tracks are titled "${entry.title}"; the first one is reused.`);
    const match = matches[0];
    if (match && (!match.is_active || match.removed_at)) {
      notes.push(`Demo track "${entry.title}" exists but is disabled or removed; the seed leaves it that way.`);
    }
    return { entry, action: match ? "reuse" : "create", id: match?.id ?? null };
  });
}

function planAnnouncements(input: SeedPlanInput, businesses: BusinessPlan[], conflicts: string[], notes: string[]): AnnouncementPlan[] {
  const entries = input.manifest.entries.filter((entry): entry is AnnouncementManifestEntry => entry.kind === "announcement");
  return entries.map((entry): AnnouncementPlan => {
    const business = businesses.find((plan) => plan.business.key === entry.business);
    if (!business) {
      conflicts.push(`Manifest announcement "${entry.id}" belongs to unknown business "${entry.business}"; re-run npm run demo:audio.`);
      return { entry, action: "create", id: null };
    }
    const row = business.id
      ? input.existing.announcements.find((a) => a.business_id === business.id && a.template_key === entry.templateKey)
      : undefined;
    if (!row) return { entry, action: "create", id: null };
    if (!row.audio_path) return { entry, action: "attach-audio", id: row.id };
    const reasons: string[] = [];
    if (row.status !== "active") reasons.push(`status is ${row.status}`);
    if (row.needs_review) reasons.push("it needs review");
    if (business.brandingVersion !== null && row.branding_version !== business.brandingVersion) reasons.push("it was approved for older branding");
    if (reasons.length > 0) {
      notes.push(
        `${business.business.name} announcement "${entry.text}" exists but will not play (${reasons.join(", ")}); ` +
          "the seed leaves it unchanged. Approve it in the admin UI.",
      );
    }
    return { entry, action: "reuse", id: row.id };
  });
}

/** Decides, for every demo row, whether it is created or an existing one reused; collects conflicts. */
export function buildSeedPlan(input: SeedPlanInput): SeedPlan {
  const conflicts: string[] = [];
  const notes: string[] = [];
  const announcementFrequency = planAnnouncementFrequency(input.existing);
  const genres = planGenres(input.existing, input.manifest, notes);
  const businesses = planBusinesses(input.existing, announcementFrequency, conflicts, notes);
  const users = planUsers(input, businesses, conflicts, notes);
  const genreAccess = planGenreAccess(input.existing, genres, businesses);
  const tracks = planTracks(input, conflicts, notes);
  const announcements = planAnnouncements(input, businesses, conflicts, notes);

  for (const genre of genres) {
    if (genre.genre.demoTracks > 0 && genre.trackCount === 0) {
      notes.push(`The manifest has no demo tracks for "${genre.genre.name}"; re-run npm run demo:audio to add them.`);
    }
  }
  for (const business of DEMO_BUSINESSES) {
    if (!announcements.some((plan) => plan.entry.business === business.key && plan.entry.placement !== "rotation")) {
      notes.push(`The manifest has no welcome announcement for ${business.name}; re-run npm run demo:audio.`);
    }
  }
  return { users, genres, businesses, announcementFrequency, genreAccess, tracks, announcements, conflicts, notes };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function businessName(key: string): string {
  return findDemoBusiness(key)?.name ?? key;
}

/** "1 completed song", "4 completed songs". */
function songs(n: number): string {
  return `${n} completed song${n === 1 ? "" : "s"}`;
}

/** Human-readable plan; `checkedExisting` = false for a dry run (every row shows as "create"). */
export function formatSeedPlan(plan: SeedPlan, options: { checkedExisting: boolean }): string {
  const out: string[] = [];
  const count = (items: { action: string }[]) => {
    const created = items.filter((item) => item.action !== "reuse" && item.action !== "exists").length;
    return `${created} to create, ${items.length - created} existing`;
  };
  if (!options.checkedExisting) {
    out.push("\n(Dry run: existing rows were not checked. A real run reuses matching demo rows instead of duplicating them.)");
  }

  out.push(`\nUsers (${count(plan.users)}; passwords are generated only for new users and printed once)`);
  out.push(
    formatTable(
      ["Action", "Email", "Role", "Venue", "Email from"],
      plan.users.map((user) => [
        user.action === "reuse" && user.promote ? "promote" : user.action,
        user.email,
        user.role,
        user.businessKey ? `${businessName(user.businessKey)} (membership: ${user.membership})` : "-",
        user.source,
      ]),
    ),
  );

  out.push(`\nGenres (${count(plan.genres)})`);
  out.push(
    formatTable(
      ["Action", "Name", "Slug", "Order", "Availability", "Demo tracks"],
      plan.genres.map((genre) => [
        genre.action,
        genre.genre.name,
        genre.genre.slug,
        String(genre.genre.sortOrder),
        genre.genre.availableToAll ? "all venues" : `only ${genre.exclusiveTo.join(", ") || "assigned venues"}`,
        String(genre.trackCount),
      ]),
    ),
  );

  const frequency = plan.announcementFrequency;
  const frequencySource =
    frequency.source === "platform settings"
      ? "the platform default from Settings"
      : options.checkedExisting
        ? "built-in default: the platform_settings row is missing"
        : "built-in default; a real run uses the platform default from Settings";
  out.push(`\nBusinesses (${count(plan.businesses)}; active example venues, marked by their example.com contact email)`);
  out.push(
    formatTable(
      ["Action", "Name", "Type", "Station", "Pronunciation", "Every", "Contact (seed marker)"],
      plan.businesses.map((business) => [
        business.setType ? "reuse, set type" : business.action,
        business.business.name,
        businessTypeLabel(business.currentType !== null && !business.setType ? business.currentType : business.business.businessType),
        business.business.stationName,
        business.business.namePronunciation ?? "-",
        songs(business.everyNTracks),
        business.business.contactEmail,
      ]),
    ),
  );
  out.push(`  New venues: an announcement after every ${songs(frequency.everyNTracks)} (${frequencySource}).`);
  out.push("  Platform settings (contact details, privacy policy, terms) are never written by the seed.");

  out.push(`\nExclusive genre access (${count(plan.genreAccess)})`);
  out.push(
    formatTable(
      ["Action", "Venue", "Genre"],
      plan.genreAccess.map((access) => [access.action, businessName(access.businessKey), findDemoGenre(access.genreSlug)?.name ?? access.genreSlug]),
    ),
  );

  out.push(`\nTracks (${count(plan.tracks)}) -> bucket "music", tracks/{track_id}/{random}.mp3`);
  out.push(
    formatTable(
      ["Action", "Title", "Genre", "Length"],
      plan.tracks.map((track) => [track.action, track.entry.title, findDemoGenre(track.entry.genre)?.name ?? track.entry.genre, `${track.entry.durationSeconds.toFixed(2)} s`]),
    ),
  );

  out.push(`\nAnnouncements (${count(plan.announcements)}; active, approved) -> bucket "announcements", {business_id}/{announcement_id}/{random}.mp3`);
  out.push(
    formatTable(
      ["Action", "Venue", "Placement", "Template", "Audio", "Text"],
      plan.announcements.map((announcement) => [
        announcement.action,
        businessName(announcement.entry.business),
        announcement.entry.placement,
        announcement.entry.templateKey,
        announcement.entry.generator === "windows-sapi" ? `SAPI voice, ${announcement.entry.durationSeconds.toFixed(1)} s` : "chime placeholder",
        announcement.entry.text,
      ]),
    ),
  );

  if (plan.notes.length > 0) out.push(`\nNotes:\n${plan.notes.map((note) => `  - ${note}`).join("\n")}`);
  if (plan.conflicts.length > 0) out.push(`\nCONFLICTS (nothing will be written):\n${plan.conflicts.map((c) => `  - ${c}`).join("\n")}`);
  return out.join("\n");
}
