/**
 * Generates the production brand assets from the approved design pack in design/assets.
 *
 *   npm run brand:assets
 *
 * Outputs (committed, deterministic):
 *   public/brand/frekvencija-logo-ivory.png    transparent logo, green emblem + ivory wordmark (dark app UI)
 *   public/brand/frekvencija-logo-dark.png     transparent logo, green emblem + dark wordmark (email)
 *   public/brand/frekvencija-logo-cobalt.png   transparent logo, cobalt emblem + charcoal wordmark (public website)
 *   public/brand/frekvencija-emblem.png        the green f/equaliser emblem only, transparent
 *   public/brand/frekvencija-emblem-cobalt.png the same emblem in the website's cobalt
 *   public/brand/venue-hero.jpg                the supplied venue photograph, web-optimised
 *   public/brand/genres/default-01..08.jpg     neutral genre artwork: cropped, tinted variations of the
 *                                             venue photograph (placeholder until the owner uploads covers)
 *   src/app/icon.png, src/app/apple-icon.png   app icons (cobalt emblem on the website's ivory)
 *   src/app/opengraph-image.png                social preview (ivory, cobalt logo, photo on the right)
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

type Rgb = { r: number; g: number; b: number };

const IVORY_TEXT: Rgb = { r: 244, g: 245, b: 238 }; // #F4F5EE — wordmark on the dark app UI
const DARK_TEXT: Rgb = { r: 23, g: 29, b: 35 }; // wordmark for light backgrounds (email)
/** Public website palette (src/app/globals.css, .theme-public). */
const COBALT: Rgb = { r: 45, g: 75, b: 255 }; // #2D4BFF
const CHARCOAL: Rgb = { r: 25, g: 27, b: 34 }; // #191B22
const IVORY_PAGE: Rgb = { r: 245, g: 242, b: 236 }; // #F5F2EC

function isEmblemGreen(r: number, g: number, b: number): boolean {
  return g > r + 40 && g > b + 10;
}

async function loadApprovedLogo() {
  return sharp(join(SRC, "frekvencija-logo-approved.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/**
 * Recolour the wordmark to `wordmark` and, when given, the green emblem to `emblem`, keeping the alpha
 * channel (which carries the anti-aliasing).
 */
async function recolouredLogo(wordmark: Rgb, outFile: string, width: number, emblem: Rgb | null = null) {
  const { data, info } = await loadApprovedLogo();
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0) continue;
    const color = isEmblemGreen(out[i], out[i + 1], out[i + 2]) ? emblem : wordmark;
    if (!color) continue;
    out[i] = color.r;
    out[i + 1] = color.g;
    out[i + 2] = color.b;
  }
  const trimmed = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
  await sharp(trimmed).resize({ width }).png({ compressionLevel: 9 }).toFile(outFile);
}

/** The emblem alone, cropped from the approved logo; `color` recolours its green. Returns the cropped PNG. */
async function emblem(outFile: string, size: number, color: Rgb | null = null) {
  const { data, info } = await loadApprovedLogo();
  const pixels = Buffer.from(data);
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (pixels[i + 3] > 24 && isEmblemGreen(pixels[i], pixels[i + 1], pixels[i + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (color) {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && isEmblemGreen(pixels[i], pixels[i + 1], pixels[i + 2])) {
        pixels[i] = color.r;
        pixels[i + 1] = color.g;
        pixels[i + 2] = color.b;
      }
    }
  }
  const pad = 4;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const width = Math.min(info.width - left, maxX - minX + 1 + pad * 2);
  const height = Math.min(info.height - top, maxY - minY + 1 + pad * 2);
  const cropped = await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  await sharp(cropped)
    .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outFile);
  return cropped;
}

async function appIcon(emblemPng: Buffer, outFile: string, size: number, background: Rgb) {
  const inner = Math.round(size * 0.66);
  const glyph = await sharp(emblemPng)
    .resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { ...background, alpha: 1 } } })
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

/** Social preview in the website's look: ivory field, cobalt logo, the venue photograph fading in on the right. */
async function openGraph(heroPath: string, logoCobalt: string) {
  const W = 1200;
  const H = 630;
  const photoWidth = 560;
  const logo = await sharp(logoCobalt).resize({ width: 470 }).png().toBuffer();
  const photo = await sharp(heroPath)
    .resize({ width: photoWidth, height: H, fit: "cover", position: "attention" })
    .png()
    .toBuffer();
  const ivory = `rgb(${IVORY_PAGE.r},${IVORY_PAGE.g},${IVORY_PAGE.b})`;
  const fade = Buffer.from(
    `<svg width="${photoWidth}" height="${H}"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${ivory}" stop-opacity="1"/><stop offset="0.28" stop-color="${ivory}" stop-opacity="0"/></linearGradient></defs><rect width="${photoWidth}" height="${H}" fill="url(#g)"/></svg>`,
  );
  const line = Buffer.from(
    `<svg width="${W}" height="${H}"><path d="M72 452 C 140 452, 170 400, 230 400 S 320 470, 380 470 S 470 392, 530 392 S 600 440, 640 440" fill="none" stroke="rgb(${COBALT.r},${COBALT.g},${COBALT.b})" stroke-width="3" stroke-linecap="round" opacity="0.9"/></svg>`,
  );
  await sharp({ create: { width: W, height: H, channels: 4, background: { ...IVORY_PAGE, alpha: 1 } } })
    .composite([
      { input: photo, left: W - photoWidth, top: 0 },
      { input: fade, left: W - photoWidth, top: 0 },
      { input: line, left: 0, top: 0 },
      { input: logo, left: 72, top: 236 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(APP, "opengraph-image.png"));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const logoIvory = join(OUT, "frekvencija-logo-ivory.png");
  const logoCobalt = join(OUT, "frekvencija-logo-cobalt.png");
  await recolouredLogo(IVORY_TEXT, logoIvory, 1200);
  await recolouredLogo(DARK_TEXT, join(OUT, "frekvencija-logo-dark.png"), 1200);
  await recolouredLogo(CHARCOAL, logoCobalt, 1200, COBALT);
  await emblem(join(OUT, "frekvencija-emblem.png"), 512);
  const cobaltEmblem = await emblem(join(OUT, "frekvencija-emblem-cobalt.png"), 512, COBALT);
  await appIcon(cobaltEmblem, join(APP, "icon.png"), 512, IVORY_PAGE);
  await appIcon(cobaltEmblem, join(APP, "apple-icon.png"), 180, IVORY_PAGE);

  const heroPath = join(SRC, "venue-hero.png");
  await sharp(heroPath).jpeg({ quality: 82, mozjpeg: true }).toFile(join(OUT, "venue-hero.jpg"));
  const variants = await genreArtwork(heroPath);
  await openGraph(heroPath, logoCobalt);

  console.log(`Brand assets written to public/brand (${variants} genre artworks) and src/app icons.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
