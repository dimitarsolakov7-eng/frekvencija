// Minimal ID3v2.3 tag writer (title, artist, album, comment) so the "synthetic" labels travel with
// the files, including through an admin upload (validateMp3 reads title/artist back).
// Text is ISO-8859-1 when possible, otherwise UTF-16 with a BOM (e.g. for "—").

export interface Id3Fields {
  title: string;
  artist: string;
  album?: string;
  comment?: string;
}

const isLatin1 = (text: string): boolean => [...text].every((char) => char.charCodeAt(0) <= 0xff && char.length === 1);

/** Encoding byte + encoded text (+ terminator when `terminated`). */
function encodeText(text: string, terminated: boolean, encoding: 0 | 1): number[] {
  const bytes: number[] = [];
  if (encoding === 0) {
    for (const char of text) bytes.push(char.charCodeAt(0));
    if (terminated) bytes.push(0);
    return bytes;
  }
  bytes.push(0xff, 0xfe); // UTF-16LE BOM
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    bytes.push(unit & 0xff, unit >> 8);
  }
  if (terminated) bytes.push(0, 0);
  return bytes;
}

function frame(id: string, body: number[]): Uint8Array {
  const out = new Uint8Array(10 + body.length);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length); // v2.3 frame size: plain big-endian
  out.set(body, 10); // bytes 8–9: flags = 0
  return out;
}

function textFrame(id: string, text: string): Uint8Array {
  const encoding = isLatin1(text) ? 0 : 1;
  return frame(id, [encoding, ...encodeText(text, false, encoding)]);
}

function commentFrame(text: string): Uint8Array {
  const encoding = isLatin1(text) ? 0 : 1;
  const language = [0x65, 0x6e, 0x67]; // "eng"
  return frame("COMM", [encoding, ...language, ...encodeText("", true, encoding), ...encodeText(text, false, encoding)]);
}

/** Builds an ID3v2.3 tag (no padding, no unsynchronisation). */
export function buildId3v23Tag(fields: Id3Fields): Uint8Array {
  const frames = [textFrame("TIT2", fields.title), textFrame("TPE1", fields.artist)];
  if (fields.album) frames.push(textFrame("TALB", fields.album));
  if (fields.comment) frames.push(commentFrame(fields.comment));
  const size = frames.reduce((n, f) => n + f.length, 0);
  if (size >= 1 << 28) throw new RangeError("buildId3v23Tag: tag too large");
  const tag = new Uint8Array(10 + size);
  // "ID3", version 2.3.0, flags 0, synchsafe size.
  tag.set([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  let offset = 10;
  for (const f of frames) {
    tag.set(f, offset);
    offset += f.length;
  }
  return tag;
}

/** Prepends an ID3v2.3 tag to MP3 frame data. */
export function withId3Tag(mp3: Uint8Array, fields: Id3Fields): Uint8Array {
  const tag = buildId3v23Tag(fields);
  const out = new Uint8Array(tag.length + mp3.length);
  out.set(tag);
  out.set(mp3, tag.length);
  return out;
}
