// One-time passwords for the demo users the development seed creates.
import { randomInt } from "node:crypto";

const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
// Symbols that are safe to copy from a terminal and paste into a shell or a form (no quotes, $, `, \).
const SYMBOLS = "!@#%*-_=+";
const GROUPS = [LOWER, UPPER, DIGITS, SYMBOLS];

export const MIN_PASSWORD_LENGTH = 20;

/**
 * A cryptographically random password with at least one lowercase letter, uppercase letter, digit and
 * symbol, so it satisfies any Supabase "required characters" policy. Unambiguous characters only.
 */
export function generatePassword(length = 24): string {
  if (!Number.isInteger(length) || length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`generatePassword: length must be an integer >= ${MIN_PASSWORD_LENGTH}`);
  }
  const all = GROUPS.join("");
  const chars = GROUPS.map((group) => group[randomInt(group.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher–Yates, so the guaranteed characters are not always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
