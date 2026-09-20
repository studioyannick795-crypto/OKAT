/**
 * Server-side watermark removal from Optix repo.
 *
 * Ported from src/utils/imageForensics.ts — uses sharp for decode/encode
 * and the same "stroke" inpainting algorithm (Fast Marching Radial).
 *
 * Detects watermark strokes adaptively (dark + light backgrounds) and
 * reconstructs them using 16-directional ray marching.
 */

import sharp from "sharp";

interface WatermarkBox {
  ymin: number; // 0-1000
  xmin: number;
  ymax: number;
  xmax: number;
}

interface DecodedImage {
  data: Uint8Array; // RGBA
  width: number;
  height: number;
}

async function decodeImage(buffer: Buffer): Promise<DecodedImage> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function encodeImage(
  data: Uint8Array,
  width: number,
  height: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const raw = Buffer.from(data);
  const buffer = await sharp(raw, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  return { buffer, mimeType: "image/png" };
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Inpaint watermark using Fast Marching Radial algorithm.
 *
 * @param imageBuffer Source image buffer
 * @param box Watermark bounding box (0-1000 normalized). If not provided,
 *            auto-detected from image dimensions.
 * @returns Cleaned image buffer (PNG)
 */
export async function inpaintWatermarkOptix(
  imageBuffer: Buffer,
  box?: WatermarkBox,
): Promise<Buffer> {
  const { data: fullData, width: w, height: h } = await decodeImage(imageBuffer);

  // Auto-detect watermark zone from image dimensions if not provided
  let curBox: WatermarkBox;
  if (box) {
    curBox = box;
  } else {
    const ratio = w / h;
    if (ratio > 1.4) {
      // 16:9 landscape — watermark zone: xmin=870, ymin=900, xmax=970, ymax=960
      curBox = { xmin: 870, ymin: 900, xmax: 970, ymax: 960 };
    } else if (ratio < 0.75) {
      // 9:16 portrait — watermark zone: xmin=860, ymin=970, xmax=980, ymax=990
      curBox = { xmin: 860, ymin: 970, xmax: 980, ymax: 990 };
    } else {
      // 1:1 square (default) — watermark zone: xmin=870, ymin=940, xmax=970, ymax=980
      curBox = { xmin: 870, ymin: 940, xmax: 970, ymax: 980 };
    }
  }

  // Generous bounding box with margin
  const margin = 5;
  const x0 = Math.max(0, Math.floor((curBox.xmin / 1000) * w) - margin);
  const y0 = Math.max(0, Math.floor((curBox.ymin / 1000) * h) - margin);
  const x1 = Math.min(w, Math.ceil((curBox.xmax / 1000) * w) + margin);
  const y1 = Math.min(h, Math.ceil((curBox.ymax / 1000) * h) + margin);

  const roiW = x1 - x0;
  const roiH = y1 - y0;
  if (roiW <= 2 || roiH <= 2) {
    // No region to inpaint — return original
    return imageBuffer;
  }

  // 1. Identify watermark stroke pixels
  const isWatermark = new Uint8Array(roiW * roiH);
  const strokeWeight = new Float32Array(roiW * roiH);

  for (let ry = 0; ry < roiH; ry++) {
    const py = y0 + ry;
    for (let rx = 0; rx < roiW; rx++) {
      const px = x0 + rx;
      const imgIdx = (py * w + px) * 4;

      const r = fullData[imgIdx];
      const g = fullData[imgIdx + 1];
      const b = fullData[imgIdx + 2];
      const curLum = luminance(r, g, b);

      // Sample 12 outer ring neighbors at radius 6px
      let bgRSum = 0, bgGSum = 0, bgBSum = 0;
      let count = 0;
      const ringRad = 6;
      const ringOffsets = [
        [-ringRad, 0], [ringRad, 0], [0, -ringRad], [0, ringRad],
        [-ringRad, -ringRad], [ringRad, -ringRad], [-ringRad, ringRad], [ringRad, ringRad],
        [-Math.round(ringRad * 0.7), -ringRad], [Math.round(ringRad * 0.7), -ringRad],
        [-Math.round(ringRad * 0.7), ringRad], [Math.round(ringRad * 0.7), ringRad],
      ];

      for (const [dx, dy] of ringOffsets) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nIdx = (ny * w + nx) * 4;
          bgRSum += fullData[nIdx];
          bgGSum += fullData[nIdx + 1];
          bgBSum += fullData[nIdx + 2];
          count++;
        }
      }

      const localBgR = count > 0 ? bgRSum / count : r;
      const localBgG = count > 0 ? bgGSum / count : g;
      const localBgB = count > 0 ? bgBSum / count : b;
      const localBgLum = luminance(localBgR, localBgG, localBgB);

      const lumDiff = curLum - localBgLum;
      const colorDiff = Math.max(
        Math.abs(r - localBgR),
        Math.abs(g - localBgG),
        Math.abs(b - localBgB),
      );

      // Adaptive detection: handles dark AND bright backgrounds
      const isStroke =
        lumDiff > 2.8 ||
        (colorDiff > 4.5 && curLum > localBgLum) ||
        (curLum > 180 && localBgLum < 160);

      if (isStroke) {
        const idx = ry * roiW + rx;
        isWatermark[idx] = 1;
        const excess = Math.max(lumDiff, colorDiff);
        strokeWeight[idx] = Math.min(1.0, Math.max(0.3, excess / 18));
      }
    }
  }

  // 2. Dilate stroke by 2px with smooth falloff
  const dilatedMask = new Float32Array(roiW * roiH);
  for (let ry = 0; ry < roiH; ry++) {
    for (let rx = 0; rx < roiW; rx++) {
      const idx = ry * roiW + rx;
      if (isWatermark[idx]) {
        dilatedMask[idx] = Math.max(dilatedMask[idx], strokeWeight[idx]);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= 2.2) {
              const nry = ry + dy;
              const nrx = rx + dx;
              if (nry >= 0 && nry < roiH && nrx >= 0 && nrx < roiW) {
                const nidx = nry * roiW + nrx;
                const falloff = dist <= 1.0 ? 0.9 : 0.65;
                dilatedMask[nidx] = Math.max(dilatedMask[nidx], strokeWeight[idx] * falloff);
              }
            }
          }
        }
      }
    }
  }

  // 3. Fast Marching Radial Inpainting (16 directional rays)
  const rayAngles = 16;
  const rayDirs: [number, number][] = [];
  for (let a = 0; a < rayAngles; a++) {
    const theta = (a * 2 * Math.PI) / rayAngles;
    rayDirs.push([Math.cos(theta), Math.sin(theta)]);
  }

  const reconstructedR = new Float32Array(roiW * roiH);
  const reconstructedG = new Float32Array(roiW * roiH);
  const reconstructedB = new Float32Array(roiW * roiH);

  for (let ry = 0; ry < roiH; ry++) {
    const py = y0 + ry;
    for (let rx = 0; rx < roiW; rx++) {
      const idx = ry * roiW + rx;
      const maskVal = dilatedMask[idx];

      if (maskVal <= 0.01) {
        const imgIdx = (py * w + (x0 + rx)) * 4;
        reconstructedR[idx] = fullData[imgIdx];
        reconstructedG[idx] = fullData[imgIdx + 1];
        reconstructedB[idx] = fullData[imgIdx + 2];
        continue;
      }

      const px = x0 + rx;
      let sumR = 0, sumG = 0, sumB = 0, totalWeight = 0;

      for (let r = 0; r < rayAngles; r++) {
        const [dx, dy] = rayDirs[r];
        let step = 1;

        while (step <= 24) {
          const sampleX = Math.round(px + dx * step);
          const sampleY = Math.round(py + dy * step);

          if (sampleX < 0 || sampleX >= w || sampleY < 0 || sampleY >= h) break;

          const sampleRoiX = sampleX - x0;
          const sampleRoiY = sampleY - y0;

          const isClean =
            sampleRoiX < 0 || sampleRoiX >= roiW ||
            sampleRoiY < 0 || sampleRoiY >= roiH ||
            dilatedMask[sampleRoiY * roiW + sampleRoiX] <= 0.04;

          if (isClean) {
            const sIdx = (sampleY * w + sampleX) * 4;
            const weight = 1.0 / Math.pow(step, 1.25);
            sumR += fullData[sIdx] * weight;
            sumG += fullData[sIdx + 1] * weight;
            sumB += fullData[sIdx + 2] * weight;
            totalWeight += weight;
            break;
          }
          step++;
        }
      }

      if (totalWeight > 0) {
        reconstructedR[idx] = sumR / totalWeight;
        reconstructedG[idx] = sumG / totalWeight;
        reconstructedB[idx] = sumB / totalWeight;
      } else {
        const imgIdx = (py * w + px) * 4;
        reconstructedR[idx] = fullData[imgIdx];
        reconstructedG[idx] = fullData[imgIdx + 1];
        reconstructedB[idx] = fullData[imgIdx + 2];
      }
    }
  }

  // 4. Smooth alpha blending — write back
  for (let ry = 0; ry < roiH; ry++) {
    const py = y0 + ry;
    for (let rx = 0; rx < roiW; rx++) {
      const idx = ry * roiW + rx;
      const maskVal = dilatedMask[idx];
      if (maskVal <= 0.01) continue;

      const imgIdx = (py * w + (x0 + rx)) * 4;
      const origR = fullData[imgIdx];
      const origG = fullData[imgIdx + 1];
      const origB = fullData[imgIdx + 2];

      const targetR = reconstructedR[idx];
      const targetG = reconstructedG[idx];
      const targetB = reconstructedB[idx];

      const blend = Math.min(1.0, (1 - Math.cos(maskVal * Math.PI)) * 0.5 * 1.1);
      fullData[imgIdx] = Math.round(origR * (1 - blend) + targetR * blend);
      fullData[imgIdx + 1] = Math.round(origG * (1 - blend) + targetG * blend);
      fullData[imgIdx + 2] = Math.round(origB * (1 - blend) + targetB * blend);
    }
  }

  const { buffer: outBuffer } = await encodeImage(fullData, w, h);
  return outBuffer;
}
