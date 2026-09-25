/**
 * HTTP Range parsing for single byte ranges (RFC 9110 §14). Media elements send `bytes=N-` and
 * `bytes=N-M`; a multi-range or malformed header is ignored (the full body is served), which the
 * RFC allows.
 */

export type ByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/i;

export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (header === null || header === undefined) return { kind: "full" };
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };
  if (size <= 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "partial", start, end: size - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "full" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
