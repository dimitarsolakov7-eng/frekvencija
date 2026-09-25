import { z } from "zod";
import { formBoolean, formInteger, idArray, nullableText, requiredText } from "./fields";

/** Same rule as the DB check on genres.slug. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 60;

/**
 * URL-safe slug: strips accents, lower-cases, "&" ⇒ "and", other runs of non [a-z0-9] ⇒ "-".
 * Returns "" when nothing usable remains (e.g. a name written only in Cyrillic).
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

const SLUG_MESSAGE = "Use lowercase letters a–z, digits and single hyphens (e.g. \"chill-out\").";

/** Blank ⇒ undefined (derive from the name on create, keep on update). */
const optionalSlug = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim() || undefined : value),
    z
      .string({ error: "Slug must be text." })
      .max(MAX_SLUG_LENGTH, { error: `Slug must be at most ${MAX_SLUG_LENGTH} characters.` })
      .regex(SLUG_PATTERN, { error: SLUG_MESSAGE })
      .optional(),
  )
  .optional();

const genreFields = {
  name: requiredText("Genre name", 60),
  description: nullableText("Description", 280),
  isEnabled: formBoolean,
  availableToAll: formBoolean,
  sortOrder: formInteger("Sort order", 0, 1_000_000),
};

export const genreCreateSchema = z
  .object({
    name: genreFields.name,
    slug: optionalSlug,
    description: genreFields.description.default(null),
    isEnabled: genreFields.isEnabled.default(true),
    availableToAll: genreFields.availableToAll.default(true),
    /** Omitted ⇒ the action decides (e.g. append after the last genre). */
    sortOrder: genreFields.sortOrder.optional(),
  })
  .transform((value, ctx) => {
    const slug = value.slug ?? slugify(value.name);
    if (!slug) {
      ctx.addIssue({
        code: "custom",
        path: ["slug"],
        message: `Could not derive a slug from the name. ${SLUG_MESSAGE}`,
      });
      return z.NEVER;
    }
    return { ...value, slug };
  });
export type GenreCreateInput = z.output<typeof genreCreateSchema>;

/** Update: omitted fields are unchanged; a blank slug keeps the current one. */
export const genreUpdateSchema = z.object({
  name: genreFields.name.optional(),
  slug: optionalSlug,
  description: genreFields.description.optional(),
  isEnabled: genreFields.isEnabled.optional(),
  availableToAll: genreFields.availableToAll.optional(),
  sortOrder: genreFields.sortOrder.optional(),
});
export type GenreUpdateInput = z.output<typeof genreUpdateSchema>;

/** Reorder: the complete list of genre ids in their new display order. */
export const genreReorderSchema = z.object({
  genreIds: idArray("Genres", 500).refine((ids) => ids.length > 0, { error: "Provide at least one genre." }),
});
export type GenreReorderInput = z.output<typeof genreReorderSchema>;
