/**
 * Owner-supplied policy text (platform_settings.privacy_policy / terms_of_service) is plain text. It is
 * split into paragraphs on blank lines and rendered as React text nodes — never as HTML — so nothing
 * in it can inject markup or scripts. Single line breaks inside a paragraph are kept (CSS pre-line).
 */
export function policyParagraphs(text: string | null | undefined): string[] {
  if (typeof text !== "string") return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}
