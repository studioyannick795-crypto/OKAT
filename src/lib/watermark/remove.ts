/**
 * Meta AI watermark remover — server-side, using MI-GAN neural network.
 *
 * Uses the MI-GAN model (via onnxruntime-node) to inpaint the Meta AI
 * watermark. This is the SAME model used by the working
 * https://watermark-remover-eosin-tau.vercel.app/ app.
 *
 * MI-GAN is a generative inpainting network that reconstructs the masked
 * region using surrounding pixel information — far more effective than
 * sharp's mirror+blur for semi-transparent watermarks.
 *
 * Flow:
 *   1. Load the image with sharp
 *   2. Detect the watermark region (bottom-right corner)
 *   3. Extract a crop around the watermark
 *   4. Build a mask (0 = erase, 255 = keep)
 *   5. Run MI-GAN inference on the crop
 *   6. Paste the inpainted result back onto the original
 */

import sharp from "sharp";
import * as ort from "onnxruntime-node";
import path from "path";
import fs from "fs";

const MODEL_PATH = path.join(
  process.cwd(),
  "data",
  "models",
  "migan_pipeline_v2.onnx",
);

// Watermark region: bottom-right corner
const WM_WIDTH_FRAC = 0.12;   // 12% of image width
const WM_HEIGHT_FRAC = 0.07;  // 7% of image height
const WM_INSET_X = 0.003;
const WM_INSET_Y = 0.005;

// MI-GAN crop parameters (from watermark-remover/src/lib/inpaint.ts)
const CROP_TARGET = 512;
const CROP_PAD = 96;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(`MI-GAN model not found at ${MODEL_PATH}`);
      }
      console.log("[watermark-migan] Loading MI-GAN model...");
      const session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ["cpu"],
      });
      console.log("[watermark-migan] Model loaded:", session.inputNames);
      return session;
    })();
    sessionPromise.catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

function computeCrop(
  bboxX: number, bboxY: number, bboxW: number, bboxH: number,
  w: number, h: number,
): { x: number; y: number; w: number; h: number } {
  let cw = Math.min(w, Math.max(CROP_TARGET, bboxW + CROP_PAD * 2));
  let ch = Math.min(h, Math.max(CROP_TARGET, bboxH + CROP_PAD * 2));
  cw = Math.min(w, Math.ceil(cw / 256) * 256);
  ch = Math.min(h, Math.ceil(ch / 256) * 256);
  const x = clamp(Math.round(bboxX + bboxW / 2 - cw / 2), 0, w - cw);
  const y = clamp(Math.round(bboxY + bboxH / 2 - ch / 2), 0, h - ch);
  return { x, y, w: cw, h: ch };
}

/** Chebyshev dilation of a binary mask. */
function dilateMask(
  mask: Uint8Array, w: number, h: number, r: number,
): Uint8Array {
  const pass = (src: Uint8Array, stride: number, lineLen: number, lines: number) => {
    const out = new Uint8Array(src.length);
    for (let l = 0; l < lines; l++) {
      const base = l * (stride === 1 ? lineLen : 1);
      let dist = lineLen;
      for (let i = 0; i < lineLen; i++) {
        const idx = base + i * stride;
        dist = src[idx] ? 0 : dist + 1;
        if (dist <= r) out[idx] = 255;
      }
      dist = lineLen;
      for (let i = lineLen - 1; i >= 0; i--) {
        const idx = base + i * stride;
        dist = src[idx] ? 0 : dist + 1;
        if (dist <= r) out[idx] = 255;
      }
    }
    return out;
  };
  const rows = pass(mask, 1, w, h);
  return pass(rows, w, h, w);
}

/** Separable box blur of a 0/255 mask. */
function blurMask(
  mask: Uint8Array, w: number, h: number, r: number,
): Uint8Array {
  const win = 2 * r + 1;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += mask[row + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = Math.round(sum / win);
      sum += mask[row + clamp(x + r + 1, 0, w - 1)] - mask[row + clamp(x - r, 0, w - 1)];
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[clamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / win);
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/**
 * Remove the Meta AI watermark from an image buffer using MI-GAN.
 */
export async function removeMetaWatermark(
  imageBuffer: Buffer | ArrayBuffer,
): Promise<Buffer> {
  const inputBuf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  const src = sharp(inputBuf);
  const meta = await src.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w < 64 || h < 64) return src.png().toBuffer();

  // 1. Watermark region (bottom-right corner)
  const wmW = Math.round(w * WM_WIDTH_FRAC);
  const wmH = Math.round(h * WM_HEIGHT_FRAC);
  const insetX = Math.round(w * WM_INSET_X);
  const insetY = Math.round(h * WM_INSET_Y);
  const wmX = Math.max(0, w - wmW - insetX);
  const wmY = Math.max(0, h - wmH - insetY);

  // 2. Compute crop around the watermark
  const crop = computeCrop(wmX, wmY, wmW, wmH, w, h);

  // 3. Get raw RGBA pixels for the crop
  const { data: rgba, info } = await src
    .clone()
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cropW = info.width;
  const cropH = info.height;
  const cropSize = cropW * cropH;

  // 4. Build the mask (255 = erase, 0 = keep — our convention)
  const cropMask = new Uint8Array(cropSize);
  const maskLocalX = wmX - crop.x;
  const maskLocalY = wmY - crop.y;
  for (let y = maskLocalY; y < Math.min(cropH, maskLocalY + wmH); y++) {
    for (let x = maskLocalX; x < Math.min(cropW, maskLocalX + wmW); x++) {
      cropMask[y * cropW + x] = 255;
    }
  }

  // 5. Dilate the mask
  const r = Math.max(3, Math.round((3 * Math.max(cropW, cropH)) / 512));
  const dilated = dilateMask(cropMask, cropW, cropH, r);

  // 6. Convert RGBA → CHW RGB for MI-GAN
  const chw = new Uint8Array(3 * cropSize);
  for (let i = 0; i < cropSize; i++) {
    chw[i] = rgba[i * 4];
    chw[cropSize + i] = rgba[i * 4 + 1];
    chw[2 * cropSize + i] = rgba[i * 4 + 2];
  }

  // 7. Build model mask (0 = erase, 255 = keep — MI-GAN convention, INVERTED)
  const modelMask = new Uint8Array(cropSize);
  for (let i = 0; i < cropSize; i++) modelMask[i] = dilated[i] === 0 ? 255 : 0;

  // 8. Run MI-GAN inference
  const session = await getSession();
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = new ort.Tensor("uint8", chw, [1, 3, cropH, cropW]);
  feeds[session.inputNames[1]] = new ort.Tensor("uint8", modelMask, [1, 1, cropH, cropW]);
  const results = await session.run(feeds);
  const result = results[session.outputNames[0]].data as Uint8Array;

  // 9. Feathered paste-back
  const alpha = blurMask(dilated, cropW, cropH, r);
  for (let i = 0; i < cropSize; i++) {
    const a = dilated[i] ? 255 : alpha[i];
    if (a === 0) continue;
    if (a === 255) {
      rgba[i * 4] = result[i];
      rgba[i * 4 + 1] = result[cropSize + i];
      rgba[i * 4 + 2] = result[2 * cropSize + i];
    } else {
      const inv = 255 - a;
      rgba[i * 4] = (result[i] * a + rgba[i * 4] * inv + 127) / 255;
      rgba[i * 4 + 1] = (result[cropSize + i] * a + rgba[i * 4 + 1] * inv + 127) / 255;
      rgba[i * 4 + 2] = (result[2 * cropSize + i] * a + rgba[i * 4 + 2] * inv + 127) / 255;
    }
  }

  // 10. Composite the inpainted crop back onto the original
  const cropImage = sharp(rgba, {
    raw: { width: cropW, height: cropH, channels: 4 },
  }).png();

  return sharp(inputBuf)
    .composite([
      {
        input: await cropImage.toBuffer(),
        top: crop.y,
        left: crop.x,
        blend: "over",
      },
    ])
    .png()
    .toBuffer();
}

export function hasWatermarkModel(): boolean {
  return fs.existsSync(MODEL_PATH);
}

export async function preloadWatermarkModel(): Promise<void> {
  await getSession();
}
