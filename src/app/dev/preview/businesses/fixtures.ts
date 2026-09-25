/**
 * Fixture data for the development previews of screen 06 (/dev/preview/businesses): the example
 * venues of the design (EmeraldBar, Hotel Aurora, Café Central, Restaurant Olive). Client-safe
 * (plain objects only): nothing here touches Supabase.
 */
import { deriveBusinessStatus } from "@/components/admin/businesses/business-status";
import type { AccessRequestCounts, AccessRequestItem } from "@/lib/data/admin/access-requests";
import type {
  AdminBusinessDetail,
  AdminBusinessListItem,
  AdminBusinessRecord,
  BusinessAnnouncementSummary,
  BusinessMember,
  GenreAccessOption,
  MemberStatus,
} from "@/lib/data/admin/businesses";

export const PREVIEW_BASE_PATH = "/dev/preview/businesses";

export const EMERALDBAR_ID = "0f6b1c8e-2a41-4f6d-9c1e-6b0f8a3d2e11";
export const HOTEL_AURORA_ID = "1a7c2d9f-3b52-4a7e-8d2f-7c1a9b4e3f22";
export const CAFE_CENTRAL_ID = "2b8d3e0a-4c63-4b8f-9e3a-8d2b0c5f4a33";
export const RESTAURANT_OLIVE_ID = "3c9e4f1b-5d74-4c90-8f4b-9e3c1d6a5b44";

const REQUEST_IDS = {
  lipa: "4d0f5a2c-6e85-4da1-9a5c-0f4d2e7b6c55",
  morava: "5e1a6b3d-7f96-4eb2-8b6d-1a5e3f8c7d66",
  kej: "6f2b7c4e-8a07-4fc3-9c7e-2b6f4a9d8e77",
} as const;

const CREATED_AT = "2026-09-01T09:30:00Z";

function record(overrides: Partial<AdminBusinessRecord> & Pick<AdminBusinessRecord, "id" | "name" | "businessType">): AdminBusinessRecord {
  return {
    stationName: `${overrides.name} Radio`,
    namePronunciation: null,
    stationNamePronunciation: null,
    contactEmail: null,
    announcementLanguage: "en",
    isActive: true,
    logoPath: null,
    announcementEveryNTracks: 4,
    announcementVolume: 1,
    brandingVersion: 1,
    createdAt: CREATED_AT,
    updatedAt: "2026-09-24T16:05:00Z",
    ...overrides,
  };
}

export const FIXTURE_RECORDS: Record<string, AdminBusinessRecord> = {
  [EMERALDBAR_ID]: record({
    id: EMERALDBAR_ID,
    name: "EmeraldBar",
    businessType: "bar",
    namePronunciation: "Emerald Bar",
    contactEmail: "manager@emeraldbar.example",
    // A demo image so the logo slot shows a picture (a real venue uploads its own logo).
    logoPath: `${EMERALDBAR_ID}/logo.jpg`,
  }),
  [HOTEL_AURORA_ID]: record({
    id: HOTEL_AURORA_ID,
    name: "Hotel Aurora",
    businessType: "hotel",
    contactEmail: "reception@hotelaurora.example",
    announcementEveryNTracks: 6,
    announcementVolume: 0.8,
  }),
  [CAFE_CENTRAL_ID]: record({
    id: CAFE_CENTRAL_ID,
    name: "Café Central",
    businessType: "cafe",
    contactEmail: "hello@cafecentral.example",
    announcementLanguage: "sr",
  }),
  [RESTAURANT_OLIVE_ID]: record({
    id: RESTAURANT_OLIVE_ID,
    name: "Restaurant Olive",
    businessType: "restaurant",
    contactEmail: "office@restaurantolive.example",
    isActive: false,
  }),
};

const LOGO_URLS: Record<string, string | null> = {
  [EMERALDBAR_ID]: "/brand/genres/default-01.jpg",
  [HOTEL_AURORA_ID]: null,
  [CAFE_CENTRAL_ID]: null,
  [RESTAURANT_OLIVE_ID]: null,
};

const ACTIVE_MEMBER: MemberStatus = {
  kind: "active",
  label: "Active",
  tone: "success",
  detail: "Last signed in 24 Sep 2026, 18:42 UTC",
  access: "recovery",
};

const INVITED_MEMBER: MemberStatus = {
  kind: "invited",
  label: "Invitation pending",
  tone: "warning",
  detail: "Invited 22 Sep 2026, 10:15 UTC · not accepted yet",
  access: "invite",
};

const FIXTURE_MEMBERS: Record<string, BusinessMember[]> = {
  [EMERALDBAR_ID]: [
    { userId: "7a3c8d5f-9b18-4ad4-8d8f-3c7a5b0e9f88", email: "manager@emeraldbar.example", fullName: "Marko Petrov", addedAt: "2026-09-02T08:00:00Z", status: ACTIVE_MEMBER },
  ],
  [HOTEL_AURORA_ID]: [
    { userId: "8b4d9e6a-0c29-4be5-9e9a-4d8b6c1f0a99", email: "reception@hotelaurora.example", fullName: null, addedAt: "2026-09-03T08:00:00Z", status: ACTIVE_MEMBER },
    { userId: "9c5e0f7b-1d30-4cf6-8f0b-5e9c7d2a1b00", email: "nights@hotelaurora.example", fullName: "Ivana Kostić", addedAt: "2026-09-20T08:00:00Z", status: INVITED_MEMBER },
  ],
  [CAFE_CENTRAL_ID]: [
    { userId: "0d6f1a8c-2e41-4d07-9a1c-6f0d8e3b2c11", email: "hello@cafecentral.example", fullName: null, addedAt: "2026-09-22T10:15:00Z", status: INVITED_MEMBER },
  ],
  [RESTAURANT_OLIVE_ID]: [
    { userId: "1e7a2b9d-3f52-4e18-8b2d-7a1e9f4c3d22", email: "office@restaurantolive.example", fullName: null, addedAt: "2026-09-05T10:15:00Z", status: ACTIVE_MEMBER },
  ],
};

const GENRE_IDS = {
  house: "a1000000-0000-4000-8000-000000000001",
  deepHouse: "a1000000-0000-4000-8000-000000000002",
  lounge: "a1000000-0000-4000-8000-000000000003",
  jazz: "a1000000-0000-4000-8000-000000000004",
  balkanHits: "a1000000-0000-4000-8000-000000000005",
  chillout: "a1000000-0000-4000-8000-000000000006",
  rooftop: "a1000000-0000-4000-8000-000000000007",
} as const;

function genre(id: string, name: string, availableToAll: boolean, assigned: boolean, isEnabled = true): GenreAccessOption {
  return {
    id,
    name,
    isEnabled,
    availableToAll,
    assigned,
    accessible: isEnabled && (availableToAll || assigned),
    editable: isEnabled && !availableToAll,
    playableTrackCount: 12,
  };
}

/** The genre tiles: House, Lounge and Jazz for every venue; the others exclusive. */
export function fixtureGenres(assignedIds: readonly string[] = []): GenreAccessOption[] {
  const assigned = new Set(assignedIds);
  return [
    genre(GENRE_IDS.house, "House", true, false),
    genre(GENRE_IDS.deepHouse, "Deep House", false, assigned.has(GENRE_IDS.deepHouse)),
    genre(GENRE_IDS.lounge, "Lounge", true, false),
    genre(GENRE_IDS.jazz, "Jazz", true, false),
    genre(GENRE_IDS.balkanHits, "Balkan Hits", false, assigned.has(GENRE_IDS.balkanHits)),
    genre(GENRE_IDS.chillout, "Chillout", false, assigned.has(GENRE_IDS.chillout)),
    genre(GENRE_IDS.rooftop, "Rooftop Sessions", false, false, false),
  ];
}

const ASSIGNED_GENRES: Record<string, string[]> = {
  [EMERALDBAR_ID]: [GENRE_IDS.deepHouse, GENRE_IDS.balkanHits, GENRE_IDS.chillout],
  [HOTEL_AURORA_ID]: [GENRE_IDS.chillout],
  [CAFE_CENTRAL_ID]: [],
  [RESTAURANT_OLIVE_ID]: [GENRE_IDS.deepHouse],
};

/** A summary whose clips each fall in one group (flagged clips are approved ones that were on air). */
function summary(partial: Partial<BusinessAnnouncementSummary>): BusinessAnnouncementSummary {
  const base = {
    onAir: 0,
    onAirWelcome: 0,
    onAirRotation: 0,
    needsReview: 0,
    awaitingApproval: 0,
    switchedOff: 0,
    failed: 0,
    inProgress: 0,
    ...partial,
  };
  const total = base.onAir + base.needsReview + base.awaitingApproval + base.switchedOff + base.failed + base.inProgress;
  return {
    total,
    ...base,
    byStatus: {
      draft: base.inProgress,
      generating: 0,
      ready: base.awaitingApproval + base.switchedOff,
      failed: base.failed,
      active: base.onAir + base.needsReview,
    },
  };
}

const SUMMARIES: Record<string, BusinessAnnouncementSummary> = {
  [EMERALDBAR_ID]: summary({ onAir: 2, onAirWelcome: 1, onAirRotation: 1, awaitingApproval: 1, switchedOff: 1 }),
  [HOTEL_AURORA_ID]: summary({ onAir: 1, onAirRotation: 1, needsReview: 1 }),
  [CAFE_CENTRAL_ID]: summary({}),
  [RESTAURANT_OLIVE_ID]: summary({ onAir: 1, onAirWelcome: 1, onAirRotation: 1, failed: 1 }),
};

function acceptedCount(members: readonly BusinessMember[]): number {
  return members.filter((member) => member.status.kind === "active").length;
}

/** The list rows. `statusesKnown: false` mimics a server without the secret key (Active unverified). */
export function fixtureListItems({ statusesKnown = true }: { statusesKnown?: boolean } = {}): AdminBusinessListItem[] {
  return Object.values(FIXTURE_RECORDS).map((business) => {
    const members = FIXTURE_MEMBERS[business.id] ?? [];
    const accepted = statusesKnown ? acceptedCount(members) : null;
    const status = deriveBusinessStatus({ isActive: business.isActive, memberCount: members.length, acceptedMemberCount: accepted });
    return {
      id: business.id,
      name: business.name,
      stationName: business.stationName,
      businessType: business.businessType,
      isActive: business.isActive,
      contactEmail: business.contactEmail,
      logoUrl: LOGO_URLS[business.id] ?? null,
      memberCount: members.length,
      acceptedMemberCount: accepted,
      memberEmails: members.map((member) => member.email),
      status: status.status,
      statusDetail: status.detail,
      statusVerified: status.verified,
    };
  });
}

export function fixtureDetail(id: string): AdminBusinessDetail | null {
  const business = FIXTURE_RECORDS[id];
  if (!business) return null;
  const members = FIXTURE_MEMBERS[id] ?? [];
  const genres = fixtureGenres(ASSIGNED_GENRES[id] ?? []);
  return {
    business,
    logoUrl: LOGO_URLS[id] ?? null,
    genres,
    accessibleGenreCount: genres.filter((option) => option.accessible).length,
    announcements: SUMMARIES[id] ?? summary({}),
    members,
    memberStatusNote: null,
    status: deriveBusinessStatus({
      isActive: business.isActive,
      memberCount: members.length,
      acceptedMemberCount: acceptedCount(members),
    }),
  };
}

export const FIXTURE_REQUESTS: AccessRequestItem[] = [
  {
    id: REQUEST_IDS.lipa,
    businessName: "Bistro Lipa",
    businessType: "restaurant",
    contactName: "Ana Petrović",
    email: "ana@bistrolipa.example",
    phone: "+381 64 123 4567",
    message: "We open a second location in October and would like the same atmosphere in both.\n\nCould we start with Jazz and Lounge?",
    status: "new",
    adminNotes: null,
    handledByEmail: null,
    handledAt: null,
    createdAt: "2026-09-24T19:12:00Z",
    updatedAt: "2026-09-24T19:12:00Z",
  },
  {
    id: REQUEST_IDS.morava,
    businessName: "Hotel Morava",
    businessType: "hotel",
    contactName: "Stefan Jović",
    email: "stefan@hotelmorava.example",
    phone: null,
    message: "Lobby and breakfast room, about 40 rooms.",
    status: "contacted",
    adminNotes: "Called on Monday. Wants a demo of the station voice first.",
    handledByEmail: "admin@frekvencija.online",
    handledAt: "2026-09-23T11:40:00Z",
    createdAt: "2026-09-21T08:05:00Z",
    updatedAt: "2026-09-23T11:40:00Z",
  },
  {
    id: REQUEST_IDS.kej,
    businessName: "Bar Kej",
    businessType: "bar",
    contactName: "Luka Marić",
    email: "luka@barkej.example",
    phone: "+385 91 555 0101",
    message: null,
    status: "declined",
    adminNotes: "Only needs music for private events; not a fit right now.",
    handledByEmail: "admin@frekvencija.online",
    handledAt: "2026-09-18T15:20:00Z",
    createdAt: "2026-09-16T17:45:00Z",
    updatedAt: "2026-09-18T15:20:00Z",
  },
];

export function fixtureRequestCounts(): AccessRequestCounts {
  const counts: AccessRequestCounts = { new: 0, contacted: 0, approved: 0, declined: 0, all: FIXTURE_REQUESTS.length };
  for (const request of FIXTURE_REQUESTS) counts[request.status] += 1;
  return counts;
}

export const FIXTURE_REQUEST_ID = REQUEST_IDS.lipa;
