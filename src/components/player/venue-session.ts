/**
 * Keeps a venue player tab honest about who is signed in (review finding PLAY-01).
 *
 * Every tab of a browser profile shares one Supabase session (cookies). When another tab signs
 * out, or signs the browser in as another venue, a player left running here would keep going on
 * that other session: its announcements, its settings and its saved preferences, under this
 * venue's name. Tabs therefore tell each other over a BroadcastChannel:
 * - a venue player announces its user + venue when it mounts (after a sign-in, the new venue's
 *   /radio, /account or /help page does this);
 * - the venue logout announces "signed-out" once the sign-out request is done.
 * A player that hears another identity, or a sign-out, must stop at once and reload, so it never
 * mixes two venues' bootstraps (PlayerProvider does that).
 *
 * Pure message handling plus a thin BroadcastChannel wrapper; the channel is injectable for tests.
 * Browsers without BroadcastChannel simply skip this (the next API request then fails with 401).
 */

export const VENUE_SESSION_CHANNEL = "frekvencija:venue-session";

export interface VenueIdentity {
  readonly userId: string;
  readonly businessId: string;
}

export type VenueSessionMessage =
  | { type: "venue-active"; page: string; userId: string; businessId: string }
  | { type: "signed-out"; page: string };

/** How another tab's message affects this player: its session was signed out, or replaced by another identity. */
export type VenueSessionChange = "signed-out" | "switched";

/** The BroadcastChannel surface used here. */
export interface SessionChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export type SessionChannelFactory = (name: string) => SessionChannelLike | null;

export interface VenueSessionOptions {
  /** Opens the channel (default: a BroadcastChannel, or null where there is none). */
  openChannel?: SessionChannelFactory;
  /** Id of this page, to ignore its own messages (default: one random id per page load). */
  pageId?: string;
}

function createPageId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through (insecure context in old browsers).
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Messages a page posted itself (another channel object in the same page receives them) are ignored. */
const PAGE_ID = createPageId();

export function openBroadcastChannel(name: string): SessionChannelLike | null {
  if (typeof BroadcastChannel !== "function") return null;
  try {
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validates a channel message (same-origin, but still untrusted input). */
export function parseVenueSessionMessage(data: unknown): VenueSessionMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, page, userId, businessId } = data as Record<string, unknown>;
  if (!isNonEmptyString(page)) return null;
  if (type === "signed-out") return { type, page };
  if (type === "venue-active" && isNonEmptyString(userId) && isNonEmptyString(businessId)) {
    return { type, page, userId, businessId };
  }
  return null;
}

/** What a message from another page means for the player of `identity` (null: nothing to do). */
export function venueSessionChange(identity: VenueIdentity, message: VenueSessionMessage, ownPageId: string): VenueSessionChange | null {
  if (message.page === ownPageId) return null;
  if (message.type === "signed-out") return "signed-out";
  return message.userId === identity.userId && message.businessId === identity.businessId ? null : "switched";
}

function post(channel: SessionChannelLike, message: VenueSessionMessage): void {
  try {
    channel.postMessage(message);
  } catch {
    // A closed or broken channel: nothing else to tell.
  }
}

/**
 * Announces this page's venue player to the other tabs and calls `onChange` (once) when another
 * tab signs out or signs the browser in as someone else. Returns the cleanup.
 */
export function followVenueSession(
  identity: VenueIdentity,
  onChange: (change: VenueSessionChange) => void,
  options: VenueSessionOptions = {},
): () => void {
  const channel = (options.openChannel ?? openBroadcastChannel)(VENUE_SESSION_CHANNEL);
  if (!channel) return () => {};
  const page = options.pageId ?? PAGE_ID;
  let changed = false;
  const listener = (event: { data: unknown }) => {
    if (changed) return;
    const message = parseVenueSessionMessage(event.data);
    const change = message ? venueSessionChange(identity, message, page) : null;
    if (!change) return;
    changed = true;
    onChange(change);
  };
  channel.addEventListener("message", listener);
  post(channel, { type: "venue-active", page, userId: identity.userId, businessId: identity.businessId });
  return () => {
    channel.removeEventListener("message", listener);
    try {
      channel.close();
    } catch {
      // Already closed.
    }
  };
}

/** Tells the other tabs that this browser just signed out (call once the sign-out request is done). */
export function announceVenueSignedOut(options: VenueSessionOptions = {}): void {
  const channel = (options.openChannel ?? openBroadcastChannel)(VENUE_SESSION_CHANNEL);
  if (!channel) return;
  post(channel, { type: "signed-out", page: options.pageId ?? PAGE_ID });
  try {
    channel.close();
  } catch {
    // Already closed.
  }
}
