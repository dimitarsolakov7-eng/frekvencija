/**
 * Generates the production brand assets from the approved design pack in design/assets.
 *
 *   npm run brand:assets
 *
 * Outputs (committed, deterministic):
 *   public/brand/frekvencija-logo-ivory.png    transparent logo, green emblem + ivory wordmark (dark UI)
 *   public/brand/frekvencija-logo-dark.png     transparent logo, green emblem + dark wordmark (light UI / email)
 *   public/brand/frekvencija-emblem.png        the green f/equaliser emblem only, transparent
 *   public/brand/venue-hero.jpg                the supplied venue photograph, web-optimised
 *   public/brand/genres/default-01..08.jpg     neutral genre artwork: cropped, tinted variations of the
 *                                             venue photograph (placeholder until the owner uploads covers)
 *   src/app/icon.png, src/app/apple-icon.png   app icons (emblem on the page colour)
 *   src/app/opengraph-image.png                social preview (photo + logo)
 *
 * sharp ships with Next.js as an optional dependency, so no extra install is needed.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "design", "assets");
const OUT = join(ROOT, "public", "brand");
const APP = join(ROOT, "src", "app");

const PAGE = { r: 11, g: 17, b: 16 }; // #0B1110
const IVORY = { r: 244, g: 245, b: 238 }; // #F4F5EE

function isEmblemGreen(r: number, g: number, b: number): boolean {
  return g > r + 40 && g > b + 10;
}

async function loadApprovedLogo() {
  return sharp(join(SRC, "frekvencija-logo-approved.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** Recolour the dark wordmark to `color`, keeping the green emblem and the alpha channel. */
async function recolouredLogo(color: { r: number; g: number; b: number }, outFile: string, width: number) {
  const { data, info } = await loadApprovedLogo();
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) continue;
    if (!isEmblemGreen(out[i], out[i + 1], out[i + 2])) {
      out[i] = color.r;
      out[i + 1] = color.g;
      out[i + 2] = color.b;
    }
  }
  const trimmed = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
  await sharp(trimmed).resize({ width }).png({ compressionLevel: 9 }).toFile(outFile);
}

async function emblem(outFile: string, size: number) {
  const { data, info } = await loadApprovedLogo();
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 24 && isEmblemGreen(data[i], data[i + 1], data[i + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 4;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const width = Math.min(info.width - left, maxX - minX + 1 + pad * 2);
  const height = Math.min(info.height - top, maxY - minY + 1 + pad * 2);
  const cropped = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  await sharp(cropped)
    .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outFile);
  return cropped;
}

async function appIcon(emblemPng: Buffer, outFile: string, size: number) {
  const inner = Math.round(size * 0.66);
  const glyph = await sharp(emblemPng)
    .resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { ...PAGE, alpha: 1 } } })
    .composite([{ input: glyph, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(outFile);
}

/** Crop regions (fractions of the 1536×1024 photo) and colour grades for the default genre artwork. */
const GENRE_VARIANTS: { crop: [number, number, number, number]; modulate: { hue?: number; saturation?: number; brightness?: number }; tint?: { r: number; g: number; b: number } }[] = [
  { crop: [0.38, 0.3, 0.62, 0.52], modulate: { saturation: 1.05, brightness: 1.05 } }, // bar counter, amber
  { crop: [0.55, 0.0, 0.45, 0.5], modulate: { hue: 25, saturation: 0.9 } }, // lamps, warm gold
  { crop: [0.0, 0.25, 0.5, 0.5], modulate: { hue: 95, saturation: 0.55, brightness: 0.95 } }, // lounge, evergreen
  { crop: [0.35, 0.0, 0.4, 0.45], modulate: { hue: 180, saturation: 0.45, brightness: 0.95 } }, // window, night teal
  { crop: [0.6, 0.4, 0.4, 0.45], modulate: { hue: -30, saturation: 0.95 } }, // bottles, wine
  { crop: [0.1, 0.45, 0.55, 0.5], modulate: { hue: 235, saturation: 0.4, brightness: 0.95 } }, // seating, indigo
  { crop: [0.45, 0.45, 0.5, 0.5], modulate: { saturation: 1.15, brightness: 1.1 } }, // cocktail, sunset
  { crop: [0.2, 0.05, 0.5, 0.45], modulate: { hue: 60, saturation: 0.6 } }, // plants, olive
];

async function genreArtwork(heroPath: string) {
  const meta = await sharp(heroPath).metadata();
  const W = meta.width ?? 1536;
  const H = meta.height ?? 1024;
  const dir = join(OUT, "genres");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  let n = 0;
  for (const v of GENRE_VARIANTS) {
    n += 1;
    const [fx, fy, fw, fh] = v.crop;
    const left = Math.round(fx * W);
    const top = Math.round(fy * H);
    const width = Math.min(W - left, Math.round(fw * W));
    const height = Math.min(H - top, Math.round(fh * H));
    await sharp(heroPath)
      .extract({ left, top, width, height })
      .resize({ width: 960, height: 540, fit: "cover", position: "attention" })
      .modulate(v.modulate)
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(join(dir, `default-${String(n).padStart(2, "0")}.jpg`));
  }
  return n;
}

async function openGraph(heroPath: string, logoIvory: string) {
  const logo = await sharp(logoIvory).resize({ width: 520 }).png().toBuffer();
  const shade = Buffer.from(
    `<svg width="1200" height="630"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0B1110" stop-opacity="0.92"/><stop offset="0.65" stop-color="#0B1110" stop-opacity="0.45"/><stop offset="1" stop-color="#0B1110" stop-opacity="0.1"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>`,
  );
  await sharp(heroPath)
    .resize({ width: 1200, height: 630, fit: "cover" })
    .composite([
      { input: shade, left: 0, top: 0 },
      { input: logo, left: 72, top: 250 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(APP, "opengraph-image.png"));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const logoIvory = join(OUT, "frekvencija-logo-ivory.png");
  await recolouredLogo(IVORY, logoIvory, 1200);
  await recolouredLogo({ r: 23, g: 29, b: 35 }, join(OUT, "frekvencija-logo-dark.png"), 1200);
  const emblemPng = await emblem(join(OUT, "frekvencija-emblem.png"), 512);
  await appIcon(emblemPng, join(APP, "icon.png"), 512);
  await appIcon(emblemPng, join(APP, "apple-icon.png"), 180);

  const heroPath = join(SRC, "venue-hero.png");
  await sharp(heroPath).jpeg({ quality: 82, mozjpeg: true }).toFile(join(OUT, "venue-hero.jpg"));
  const variants = await genreArtwork(heroPath);
  await openGraph(heroPath, logoIvory);

  console.log(`Brand assets written to public/brand (${variants} genre artworks) and src/app icons.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
