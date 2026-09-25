import { pickByKey } from "@/lib/utils/hash";

/** Restrained letter-avatar backgrounds (screen 06: E green, H brown, C tan, R maroon…). */
export const AVATAR_AUTO_TONES = [
  "bg-emerald-900/70 text-emerald-100",
  "bg-teal-900/70 text-teal-100",
  "bg-amber-900/70 text-amber-100",
  "bg-orange-900/60 text-orange-100",
  "bg-rose-900/60 text-rose-100",
  "bg-sky-900/70 text-sky-100",
  "bg-indigo-900/60 text-indigo-100",
  "bg-stone-700/70 text-stone-100",
] as const;

/** The deterministic background/text classes <Avatar tone="auto"> uses for a name. */
export function avatarAutoToneClasses(name: string): string {
  return pickByKey(name, AVATAR_AUTO_TONES);
}
