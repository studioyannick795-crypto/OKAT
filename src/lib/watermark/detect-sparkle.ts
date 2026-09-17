/**
 * Auto-detection of the Meta AI sparkle watermark.
 *
 * Ported from watermark-remover/src/lib/detect.ts — uses brightness-based
 * detection to find the exact sparkle location in the bottom-right corner,
 * then creates a precise mask that covers ONLY the watermark pixels
 * (not a full rectangle that cuts part of the image).
 *
 * The Meta AI watermark is a small white 4-point star (~5% of image),
 * always brighter than its surroundings, placed in the bottom-right corner.
 */

/** Detected watermark bounds in natural image coordinates. */
export interface DetectedWatermark {
  /** Bounding box of the detected sparkle. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Detection confidence (0-1). */
  score: number;
}

/** Search region: bottom-right corner of the image. */
const SEARCH_FRAC = 0.15; // search in last 15% of width + height
/** Watermark size as fraction of image dimensions. */
const WM_WIDTH_FRAC = 0.085;  // 8.5% of image width (text "Meta AI" + icon)
const WM_HEIGHT_FRAC = 0.055; // 5.5% of image height
/** Brightness threshold above local average (watermark is semi-transparent white). */
const BRIGHTNESS_DELTA = 8;  // lowered from 15 — watermark is subtle
/** Luminance threshold (watermark is light, but not always pure white). */
const MIN_LUMINANCE = 100;  // lowered from 180 — watermark is semi-transparent

/**
 * Detect the Meta AI sparkle watermark in the bottom-right corner.
 *
 * Algorithm:
 *   1. Extract the bottom-right search region (last 20% of width + height)
 *   2. Compute luminance for each pixel
 *   3. Compute local average brightness (box blur)
 *   4. Find bright pixels (luminance > MIN_LUMINANCE AND > local_avg + BRIGHTNESS_DELTA)
 *   5. Find the largest connected cluster (the sparkle)
 *   6. Return the bounding box + a precise mask
 *
 * @param canvas - Source canvas with the image
 * @returns The detected watermark bounds + mask canvas, or null if not found
 */
export function detectSparkle(canvas: HTMLCanvasElement): {
  bounds: DetectedWatermark;
  mask: HTMLCanvasElement;
} | null {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  if (W < 64 || H < 64) return null;

  // 1. Extract search region (bottom-right corner)
  const searchW = Math.round(W * SEARCH_FRAC);
  const searchH = Math.round(H * SEARCH_FRAC);
  const searchX = W - searchW;
  const searchY = H - searchH;

  const imageData = ctx.getImageData(searchX, searchY, searchW, searchH);
  const data = imageData.data;

  // 2. Compute luminance
  const luma = new Float32Array(searchW * searchH);
  for (let i = 0; i < searchW * searchH; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 3. Compute local average (box blur, radius ~ sparkle size / 4)
  const sparkleMaxPx = Math.round(Math.max(W, H) * WM_WIDTH_FRAC);
  const blurR = Math.max(5, Math.round(sparkleMaxPx / 4));
  const localAvg = boxBlur(luma, searchW, searchH, blurR);

  // 4. Find bright pixels
  const brightMask = new Uint8Array(searchW * searchH);
  let brightCount = 0;
  for (let i = 0; i < searchW * searchH; i++) {
    if (luma[i] > MIN_LUMINANCE && luma[i] > localAvg[i] + BRIGHTNESS_DELTA) {
      brightMask[i] = 255;
      brightCount++;
    }
  }

  if (brightCount < 4) return null; // no sparkle found

  // 5. Find the largest connected cluster (flood fill)
  const visited = new Uint8Array(searchW * searchH);
  let bestCluster: { x: number; y: number; w: number; h: number; size: number } | null = null;

  for (let y = 0; y < searchH; y++) {
    for (let x = 0; x < searchW; x++) {
      const idx = y * searchW + x;
      if (!brightMask[idx] || visited[idx]) continue;

      // Flood fill from this pixel
      const stack = [idx];
      let minX = x, maxX = x, minY = y, maxY = y;
      let size = 0;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (visited[cur] || !brightMask[cur]) continue;
        visited[cur] = 1;

        const cx = cur % searchW;
        const cy = Math.floor(cur / searchW);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        size++;

        // Check neighbors (4-connectivity)
        if (cx > 0) stack.push(cur - 1);
        if (cx < searchW - 1) stack.push(cur + 1);
        if (cy > 0) stack.push(cur - searchW);
        if (cy < searchH - 1) stack.push(cur + searchW);
      }

      // Filter by expected size
      const clusterW = maxX - minX + 1;
      const clusterH = maxY - minY + 1;
      const minWmPx = Math.round(W * WM_WIDTH_FRAC * 0.2);
      const maxWmPx = Math.round(W * WM_WIDTH_FRAC * 1.5);
      const minHmPx = Math.round(H * WM_HEIGHT_FRAC * 0.2);
      const maxHmPx = Math.round(H * WM_HEIGHT_FRAC * 1.5);

      if (
        size >= 4 &&
        clusterW >= minWmPx &&
        clusterW <= maxWmPx &&
        clusterH >= minHmPx &&
        clusterH <= maxHmPx &&
        (!bestCluster || size > bestCluster.size)
      ) {
        bestCluster = {
          x: minX,
          y: minY,
          w: clusterW,
          h: clusterH,
          size,
        };
      }
    }
  }

  if (!bestCluster) return null;

  // 6. Create the precise mask (only the sparkle pixels, dilated slightly)
  const pad = Math.max(3, Math.round(Math.min(W, H) * 0.005));
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = W;
  maskCanvas.height = H;
  const maskCtx = maskCanvas.getContext("2d")!;
  maskCtx.fillStyle = "#000000";
  maskCtx.fillRect(0, 0, W, H);

  // Draw the detected cluster pixels (white) at their natural coordinates
  const maskData = maskCtx.createImageData(W, H);
  // Reset: set all to black (0 alpha in the mask = transparent = don't inpaint)
  for (let i = 0; i < W * H; i++) {
    maskData.data[i * 4 + 3] = 0; // alpha 0
  }

  // Draw white (opaque) for the sparkle pixels, dilated by `pad` pixels
  // We do this by drawing filled circles at each bright pixel
  maskCtx.fillStyle = "#ffffff";
  for (let y = 0; y < searchH; y++) {
    for (let x = 0; x < searchW; x++) {
      const idx = y * searchW + x;
      if (visited[idx]) {
        // This pixel is part of the detected sparkle cluster
        const px = searchX + x;
        const py = searchY + y;
        // Draw a small filled circle for dilation
        maskCtx.beginPath();
        maskCtx.arc(px, py, pad, 0, Math.PI * 2);
        maskCtx.fill();
      }
    }
  }

  // Compute bounding box in natural coords
  const bounds: DetectedWatermark = {
    x: searchX + bestCluster.x - pad,
    y: searchY + bestCluster.y - pad,
    w: bestCluster.w + pad * 2,
    h: bestCluster.h + pad * 2,
    score: Math.min(1, bestCluster.size / (bestCluster.w * bestCluster.h)),
  };

  return { bounds, mask: maskCanvas };
}

/** Separable box blur. */
function boxBlur(
  data: Float32Array,
  w: number,
  h: number,
  r: number,
): Float32Array {
  if (r < 1) return data.slice();
  const tmp = new Float32Array(data.length);
  const out = new Float32Array(data.length);
  const norm = 1 / (2 * r + 1);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let i = -r; i <= r; i++)
      sum += data[y * w + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum * norm;
      sum +=
        data[y * w + Math.min(w - 1, x + r + 1)] -
        data[y * w + Math.max(0, x - r)];
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++)
      sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * norm;
      sum +=
        tmp[Math.min(h - 1, y + r + 1) * w + x] -
        tmp[Math.max(0, y - r) * w + x];
    }
  }

  return out;
}
