const WORD_SEPARATORS = /[\s\-_./&+·|,:;]+/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** A single capitalised word with a second capital later on, e.g. "EmeraldBar". */
const CAMEL_CASE_WORD = /^(\p{Lu})\p{Ll}+(\p{Lu})/u;

function firstLetterOrDigit(word: string): string {
  return word.match(LETTER_OR_DIGIT)?.[0] ?? "";
}

/**
 * Up to two upper-case initials for monogram avatars:
 * "Hotel Aurora" → "HA", "EmeraldBar Radio" → "ER", "EmeraldBar" → "EB", "BBC" → "B".
 * Returns "?" when the name has no letters or digits.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(WORD_SEPARATORS)
    .filter((word) => LETTER_OR_DIGIT.test(word));

  if (words.length === 0) return "?";

  if (words.length === 1) {
    const camel = words[0].match(CAMEL_CASE_WORD);
    if (camel) return `${camel[1]}${camel[2]}`;
    return firstLetterOrDigit(words[0]).toUpperCase();
  }

  return `${firstLetterOrDigit(words[0])}${firstLetterOrDigit(words[1])}`.toUpperCase();
}
