import sharp from "sharp";

export const LOGO_CONFIG = {
  enabled: true,
  opacity: 0.40,
  sizeScale: 1.40,
  viewBox: "0 0 497 502",
  aspectRatio: "497/502 (~1:1)",
  color: "#ffffff",
};

const LOGO_PATH_D = "M380 85.5c-.8.7-6.9 5.3-13.5 10-33.7 24.3-107.8 79.8-108.2 81.1-.4 1.1 14.6 9.6 47.7 27.1l18.5 9.8.3 40.5c.1 22.2-.1 40.7-.6 41.2-.4.4-6.6-2.8-13.7-7.1-39.9-24-52.5-31.2-53.5-30.6-.6.4-1 11.8-1 33.4 0 32.7 0 32.8 2.3 34.8 2.5 2.4 6.9 5.1 21.7 13.8 5.8 3.4 17.6 10.5 26.3 15.8 19.9 12.2 23.9 14.3 31.5 15.8 14.7 3.1 33-5.4 40.9-18.8 5.5-9.4 5.3-4.5 5.3-141.6 0-132.7.1-129.4-4-125.2m-225.9 45c-12.4 3.5-20.9 10.6-26.4 22.3l-3.2 6.7-.1 128.8c-.2 113.3 0 128.8 1.3 128.3 1.8-.7 16.9-11.6 33.6-24.1 6.5-5 21.7-16.1 33.6-24.8 40.9-29.8 57.1-41.9 57.1-42.8 0-1.4-5.4-4.5-34.5-19.9-14.8-7.9-28-14.9-29.1-15.6-2-1.2-2.2-2.3-2.9-27.3-.8-29.7.1-56.1 1.9-56.1.7 0 4.5 2.1 8.6 4.7 19.8 12.5 56.6 34.1 57.2 33.7.5-.3.8-15.5.8-33.9v-33.3l-3-2.6c-4.7-3.9-66.6-40.6-72-42.7-6.9-2.6-16.4-3.2-22.9-1.4";

/** Logo zones per ratio (where the logo is stamped, 0-1000 normalized). */
const LOGO_ZONES: Record<string, { xmin: number; ymin: number; xmax: number; ymax: number }> = {
  "1:1": { xmin: 870, ymin: 940, xmax: 970, ymax: 980 },
  "16:9": { xmin: 870, ymin: 900, xmax: 970, ymax: 960 },
  "9:16": { xmin: 860, ymin: 970, xmax: 980, ymax: 990 },
};

/** Detect ratio from image dimensions. */
function detectRatio(w: number, h: number): string {
  const r = w / h;
  if (r > 1.4) return "16:9";
  if (r < 0.75) return "9:16";
  return "1:1";
}

/**
 * Stamp the Nelth-IA SVG logo on the cleaned image.
 *
 * @param imageBuffer The cleaned image (after watermark removal)
 * @returns The image with the logo stamped on top
 */
export async function stampLogo(imageBuffer: Buffer): Promise<Buffer> {
  if (!LOGO_CONFIG.enabled) return imageBuffer;

  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  if (imgW < 64 || imgH < 64) return imageBuffer;

  const ratio = detectRatio(imgW, imgH);
  const zone = LOGO_ZONES[ratio] || LOGO_ZONES["1:1"];

  // Zone in pixels (box coords are 0-1000)
  const boxX = (zone.xmin / 1000) * imgW;
  const boxY = (zone.ymin / 1000) * imgH;
  const boxW = ((zone.xmax - zone.xmin) / 1000) * imgW;
  const boxH = ((zone.ymax - zone.ymin) / 1000) * imgH;

  // Logo dimensions (140% of zone, ratio 497/502)
  const maxDim = Math.max(boxW, boxH);
  const targetW = Math.round(maxDim * LOGO_CONFIG.sizeScale);
  const targetH = Math.round(targetW * (502 / 497));

  // Center the logo in the zone
  const centerX = boxX + boxW / 2;
  const centerY = boxY + boxH / 2;
  const drawX = Math.round(centerX - targetW / 2);
  const drawY = Math.round(centerY - targetH / 2);

  // SVG with opacity baked in
  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}" viewBox="${LOGO_CONFIG.viewBox}">
  <path
    fill="${LOGO_CONFIG.color}"
    fill-opacity="${LOGO_CONFIG.opacity}"
    stroke="${LOGO_CONFIG.color}"
    stroke-opacity="${LOGO_CONFIG.opacity}"
    stroke-width="7"
    stroke-linecap="round"
    stroke-linejoin="round"
    d="${LOGO_PATH_D}"
  />
</svg>`;

  const logoBuf = await sharp(Buffer.from(logoSvg)).ensureAlpha().png().toBuffer();

  return sharp(imageBuffer)
    .composite([{
      input: logoBuf,
      top: Math.max(0, drawY),
      left: Math.max(0, drawX),
      blend: "over",
    }])
    .toFormat(meta.format ?? "png", { quality: 95 })
    .toBuffer();
}
