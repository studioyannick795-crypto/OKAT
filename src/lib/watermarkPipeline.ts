import sharp from "sharp";
import {
  detectWatermarks,
  type WatermarkBox,
  type AspectRatio,
  type PresetZone,
  type CustomBox,
} from "./watermarkAI";

/**
 * Server-side watermark removal pipeline.
 *
 * Pure TypeScript port of the client-side CV code (maskGenerator.ts +
 * teleaInpainter.ts native FMM fallback) so it can run in a Node runtime
 * without a browser / OpenCV.js. Image decode/encode uses `sharp`.
 */

export type MaskThresholdMode = "otsu" | "adaptive" | "luminance" | "fill";

export interface MaskConfig {
  thresholdMode: MaskThresholdMode;
  /** 0-100. Higher = more pixels masked (lower delta required). */
  sensitivity: number;
  /** 0-15 px. Morphological dilation to cover anti-aliased edges. */
  dilationRadius: number;
  /** Mask the background instead of the foreground. */
  invertMask: boolean;
}

export interface InpaintConfig {
  algorithm: "telea" | "ns"; // both map to the FMM Telea port
  radius: number; // 1-20
}

export interface PipelineMetrics {
  detectionSource: string;
  maskGenTimeMs: number;
  inpaintTimeMs: number;
  totalTimeMs: number;
  pixelsInpainted: number;
  engineUsed: "telea-fast-marching";
  originalSize: { width: number; height: number };
}

export const DEFAULT_MASK_CONFIG: MaskConfig = {
  thresholdMode: "otsu",
  sensitivity: 75,
  dilationRadius: 2,
  invertMask: false,
};

export const DEFAULT_INPAINT_CONFIG: InpaintConfig = {
  algorithm: "telea",
  radius: 5,
};

/* ------------------------------------------------------------------ */
/*  Image decode / encode                                              */
/* ------------------------------------------------------------------ */

export interface DecodedImage {
  data: Uint8Array; // RGBA
  width: number;
  height: number;
}

export async function decodeImage(
  buffer: Buffer | Uint8Array
): Promise<DecodedImage> {
  const { data, info } = await sharp(buffer as Buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

export async function encodeImage(
  data: Uint8Array,
  width: number,
  height: number,
  format: "png" | "jpeg",
  quality: number = 92
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Copy into a fresh Buffer so sharp can safely read the RGBA planes.
  const raw = Buffer.from(data);
  let s = sharp(raw, { raw: { width, height, channels: 4 } });
  if (format === "jpeg") {
    s = s.flatten({ background: "#000000" }).jpeg({
      quality,
      chromaSubsampling: "4:2:0",
    });
  } else {
    s = s.png();
  }
  const buffer = await s.toBuffer();
  return { buffer, mimeType: format === "jpeg" ? "image/jpeg" : "image/png" };
}

/* ------------------------------------------------------------------ */
/*  Mask generation (pure JS)                                          */
/* ------------------------------------------------------------------ */

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Compute Otsu's threshold over the grayscale histogram of a region.
 * Returns the threshold T (0-255) that maximizes between-class variance.
 */
function otsuThreshold(
  src: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 4;
      const lum = Math.round(luminance(src[idx], src[idx + 1], src[idx + 2]));
      hist[lum]++;
      total++;
    }
  }
  if (total === 0) return 128;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * Generate a grayscale mask (1 byte/pixel) where 255 = inpaint, 0 = keep.
 */
export function generateMask(
  src: Uint8Array,
  width: number,
  height: number,
  boxes: WatermarkBox[],
  config: MaskConfig
): { mask: Uint8Array; durationMs: number } {
  const startTime = Date.now();
  const mask = new Uint8Array(width * height);

  for (const box of boxes) {
    const startX = Math.max(0, Math.floor(box.xmin * width));
    const startY = Math.max(0, Math.floor(box.ymin * height));
    const endX = Math.min(width, Math.ceil(box.xmax * width));
    const endY = Math.min(height, Math.ceil(box.ymax * height));

    if (config.thresholdMode === "fill") {
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          mask[y * width + x] = 255;
        }
      }
      continue;
    }

    if (config.thresholdMode === "otsu") {
      // Otsu threshold over the ROI, mask the minority side (usually the text)
      const T = otsuThreshold(src, width, height, startX, startY, endX, endY);
      let countBelow = 0;
      let countAbove = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const lum = luminance(src[idx], src[idx + 1], src[idx + 2]);
          if (lum < T) countBelow++;
          else countAbove++;
        }
      }
      // Minority side is most likely the watermark strokes
      const maskBelow = countBelow <= countAbove;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const lum = luminance(src[idx], src[idx + 1], src[idx + 2]);
          let isWm = lum < T ? maskBelow : !maskBelow;
          if (config.invertMask) isWm = !isWm;
          if (isWm) mask[y * width + x] = 255;
        }
      }
    } else {
      // adaptive / luminance: deviation from local (box) mean
      let sumLum = 0;
      let count = 0;
      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const idx = (y * width + x) * 4;
          sumLum += luminance(src[idx], src[idx + 1], src[idx + 2]);
          count++;
        }
      }
      const meanLum = count > 0 ? sumLum / count : 128;
      const thresholdDelta = 25 + (100 - config.sensitivity) * 0.4;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const lum = luminance(src[idx], src[idx + 1], src[idx + 2]);
          let isWm = Math.abs(lum - meanLum) > thresholdDelta;
          if (config.invertMask) isWm = !isWm;
          if (isWm) mask[y * width + x] = 255;
        }
      }
    }
  }

  // Morphological dilation (circle structuring element)
  if (config.dilationRadius > 0) {
    const d = config.dilationRadius;
    const dilated = new Uint8Array(mask);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pIdx = y * width + x;
        if (mask[pIdx] === 255) {
          for (let dy = -d; dy <= d; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -d; dx <= d; dx++) {
              if (dx * dx + dy * dy <= d * d) {
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                dilated[ny * width + nx] = 255;
              }
            }
          }
        }
      }
    }
    mask.set(dilated);
  }

  return { mask, durationMs: Date.now() - startTime };
}

/* ------------------------------------------------------------------ */
/*  Telea Fast Marching Method inpainting (pure JS port)              */
/* ------------------------------------------------------------------ */

/**
 * Native Fast Marching Method (FMM) Telea inpainting.
 * Based on Alexandru Telea, "An Image Inpainting Technique Based on the
 * Fast Marching Method", 2004. Ported from src/nelth/services/teleaInpainter.ts.
 *
 * Mutates `pixels` (RGBA) in place. `mask` is grayscale (1 byte/pixel),
 * pixels > 64 are inpainted.
 */
export function runTeleaInpaint(
  pixels: Uint8Array,
  width: number,
  height: number,
  mask: Uint8Array,
  radius: number = 5
): { durationMs: number; pixelsInpainted: number } {
  const startTime = Date.now();
  const totalPixels = width * height;

  const FLAG_KNOWN = 0;
  const FLAG_BAND = 1;
  const FLAG_INSIDE = 2;

  const flags = new Uint8Array(totalPixels);
  const T = new Float32Array(totalPixels);

  let maskedCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    if (mask[i] > 64) {
      flags[i] = FLAG_INSIDE;
      T[i] = 1.0e6;
      maskedCount++;
    } else {
      flags[i] = FLAG_KNOWN;
      T[i] = 0;
    }
  }

  if (maskedCount === 0) {
    return { durationMs: Date.now() - startTime, pixelsInpainted: 0 };
  }

  class MinHeap {
    private nodes: number[] = [];
    push(index: number) {
      this.nodes.push(index);
      this.up(this.nodes.length - 1);
    }
    pop(): number | undefined {
      if (this.nodes.length === 0) return undefined;
      const top = this.nodes[0];
      const bottom = this.nodes.pop()!;
      if (this.nodes.length > 0) {
        this.nodes[0] = bottom;
        this.down(0);
      }
      return top;
    }
    get size(): number {
      return this.nodes.length;
    }
    private up(i: number) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (T[this.nodes[i]] < T[this.nodes[p]]) {
          const tmp = this.nodes[i];
          this.nodes[i] = this.nodes[p];
          this.nodes[p] = tmp;
          i = p;
        } else break;
      }
    }
    private down(i: number) {
      const len = this.nodes.length;
      while ((i << 1) + 1 < len) {
        let left = (i << 1) + 1;
        let right = left + 1;
        let best = i;
        if (T[this.nodes[left]] < T[this.nodes[best]]) best = left;
        if (right < len && T[this.nodes[right]] < T[this.nodes[best]])
          best = right;
        if (best !== i) {
          const tmp = this.nodes[i];
          this.nodes[i] = this.nodes[best];
          this.nodes[best] = tmp;
          i = best;
        } else break;
      }
    }
  }

  const bandHeap = new MinHeap();
  const neighbors = [-1, 1, -width, width];

  // Initial narrow band: INSIDE pixels neighboring KNOWN pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (flags[idx] === FLAG_INSIDE) {
        let isBoundary = false;
        if (x > 0 && flags[idx - 1] === FLAG_KNOWN) isBoundary = true;
        else if (x < width - 1 && flags[idx + 1] === FLAG_KNOWN)
          isBoundary = true;
        else if (y > 0 && flags[idx - width] === FLAG_KNOWN)
          isBoundary = true;
        else if (y < height - 1 && flags[idx + width] === FLAG_KNOWN)
          isBoundary = true;

        if (isBoundary) {
          flags[idx] = FLAG_BAND;
          T[idx] = 1.0;
          bandHeap.push(idx);
        }
      }
    }
  }

  const inpaintRadius = Math.max(2, Math.min(15, Math.round(radius)));
  const inpaintRadiusSq = inpaintRadius * inpaintRadius;

  while (bandHeap.size > 0) {
    const pIdx = bandHeap.pop()!;
    flags[pIdx] = FLAG_KNOWN;

    const px = pIdx % width;
    const py = Math.floor(pIdx / width);

    // Gradient of T at p
    let gradTx = 0;
    let gradTy = 0;
    if (px > 0 && px < width - 1) {
      if (flags[pIdx + 1] === FLAG_KNOWN && flags[pIdx - 1] === FLAG_KNOWN) {
        gradTx = (T[pIdx + 1] - T[pIdx - 1]) * 0.5;
      } else if (flags[pIdx + 1] === FLAG_KNOWN) {
        gradTx = T[pIdx + 1] - T[pIdx];
      } else if (flags[pIdx - 1] === FLAG_KNOWN) {
        gradTx = T[pIdx] - T[pIdx - 1];
      }
    }
    if (py > 0 && py < height - 1) {
      if (
        flags[pIdx + width] === FLAG_KNOWN &&
        flags[pIdx - width] === FLAG_KNOWN
      ) {
        gradTy = (T[pIdx + width] - T[pIdx - width]) * 0.5;
      } else if (flags[pIdx + width] === FLAG_KNOWN) {
        gradTy = T[pIdx + width] - T[pIdx];
      } else if (flags[pIdx - width] === FLAG_KNOWN) {
        gradTy = T[pIdx] - T[pIdx - width];
      }
    }

    const gradLen = Math.sqrt(gradTx * gradTx + gradTy * gradTy);
    let nx = 0;
    let ny = 0;
    if (gradLen > 1e-4) {
      nx = gradTx / gradLen;
      ny = gradTy / gradLen;
    }

    // Telea neighborhood weighting
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumWeight = 0;

    const yMin = Math.max(0, py - inpaintRadius);
    const yMax = Math.min(height - 1, py + inpaintRadius);
    const xMin = Math.max(0, px - inpaintRadius);
    const xMax = Math.min(width - 1, px + inpaintRadius);

    for (let qy = yMin; qy <= yMax; qy++) {
      for (let qx = xMin; qx <= xMax; qx++) {
        const qIdx = qy * width + qx;
        if (flags[qIdx] === FLAG_KNOWN) {
          const dx = px - qx;
          const dy = py - qy;
          const distSq = dx * dx + dy * dy;

          if (distSq <= inpaintRadiusSq && distSq > 0) {
            const dist = Math.sqrt(distSq);

            let dir = Math.abs(dx * nx + dy * ny) / dist;
            if (dir < 0.001) dir = 0.001;

            const dst = 1.0 / (dist * dist);
            const lev = 1.0 / (1.0 + Math.abs(T[pIdx] - T[qIdx]));
            const w = dir * dst * lev;

            const qOffset = qIdx * 4;
            sumR += pixels[qOffset] * w;
            sumG += pixels[qOffset + 1] * w;
            sumB += pixels[qOffset + 2] * w;
            sumWeight += w;
          }
        }
      }
    }

    if (sumWeight > 0) {
      const pOffset = pIdx * 4;
      pixels[pOffset] = Math.round(sumR / sumWeight);
      pixels[pOffset + 1] = Math.round(sumG / sumWeight);
      pixels[pOffset + 2] = Math.round(sumB / sumWeight);
      pixels[pOffset + 3] = 255;
    }

    // Propagate into INSIDE neighbors
    for (const offset of neighbors) {
      const nIdx = pIdx + offset;
      if (nIdx >= 0 && nIdx < totalPixels) {
        if (flags[nIdx] === FLAG_INSIDE) {
          flags[nIdx] = FLAG_BAND;
          T[nIdx] = T[pIdx] + 1.0;
          bandHeap.push(nIdx);
        }
      }
    }
  }

  return {
    durationMs: Date.now() - startTime,
    pixelsInpainted: maskedCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Full pipeline                                                     */
/* ------------------------------------------------------------------ */

export interface RemoveResult {
  imageBuffer: Buffer;
  mimeType: string;
  watermarks: WatermarkBox[];
  metrics: PipelineMetrics;
}

export async function removeWatermarks(
  imageBuffer: Buffer,
  options: {
    maskConfig?: Partial<MaskConfig>;
    inpaintConfig?: Partial<InpaintConfig>;
    exportFormat?: "png" | "jpeg";
    jpegQuality?: number;
    /** Fast mode: use one of the 3 ratio presets (skips the VLM, instant). */
    ratio?: AspectRatio;
    /** Fast mode: use a named zone preset (skips the VLM, instant). */
    preset?: PresetZone;
    /** Fast mode: use caller-provided normalized boxes (skips the VLM, instant). */
    boxes?: CustomBox[];
  } = {}
): Promise<RemoveResult> {
  const pipelineStart = Date.now();
  const maskConfig: MaskConfig = {
    ...DEFAULT_MASK_CONFIG,
    ...options.maskConfig,
  };
  const inpaintConfig: InpaintConfig = {
    ...DEFAULT_INPAINT_CONFIG,
    ...options.inpaintConfig,
  };
  const exportFormat = options.exportFormat === "jpeg" ? "jpeg" : "png";
  const jpegQuality = options.jpegQuality ?? 92;

  // 1. Decode image to raw RGBA
  const { data: pixels, width, height } = await decodeImage(imageBuffer);

  // 2. Detect watermark boxes (coordinate-based, instant — NO VLM, NO network)
  const detection = await detectWatermarks("", "image/jpeg", {
    ratio: options.ratio,
    preset: options.preset,
    boxes: options.boxes,
  });

  // 3. Generate mask
  const { mask, durationMs: maskGenMs } = generateMask(
    pixels,
    width,
    height,
    detection.watermarks,
    maskConfig
  );

  // 4. Telea FMM inpainting (in place)
  const {
    durationMs: inpaintMs,
    pixelsInpainted,
  } = runTeleaInpaint(pixels, width, height, mask, inpaintConfig.radius);

  // 5. Encode result
  const { buffer: outBuffer, mimeType } = await encodeImage(
    pixels,
    width,
    height,
    exportFormat,
    jpegQuality
  );

  return {
    imageBuffer: outBuffer,
    mimeType,
    watermarks: detection.watermarks,
    metrics: {
      detectionSource: detection.source,
      maskGenTimeMs: maskGenMs,
      inpaintTimeMs: inpaintMs,
      totalTimeMs: Date.now() - pipelineStart,
      pixelsInpainted,
      engineUsed: "telea-fast-marching",
      originalSize: { width, height },
    },
  };
}

