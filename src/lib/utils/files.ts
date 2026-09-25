/**
 * Mirrors the browser's `accept` attribute matching. Files dropped onto a dropzone bypass the file
 * input's `accept` filter, so callers must re-check them. Tokens are comma-separated extensions
 * (".mp3"), exact MIME types ("audio/mpeg") or wildcards ("image/*"); an empty accept allows all.
 *
 * Note: some Windows browsers report MP3 files as "audio/mp3" or with an empty type, so pair MIME
 * tokens with an extension token (".mp3,audio/mpeg"). The server validates the bytes regardless.
 */
export function fileMatchesAccept(file: { name: string; type: string }, accept: string | null | undefined): boolean {
  const tokens = (accept ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith(".")) return name.endsWith(token);
    if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}
