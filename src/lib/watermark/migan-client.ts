/**
 * MI-GAN client-side watermark removal.
 *
 * Uses the MI-GAN neural network (via onnxruntime-web) running entirely in
 * the browser to inpaint the Meta AI watermark. This is the SAME approach
 * used by https://watermark-remover-eosin-tau.vercel.app/ which works
 * reliably for the semi-transparent "Meta AI" text watermark.
 *
 * Flow:
 *   1. Load the image via our image-proxy (CORS-safe)
 *   2. Run detectMarks() to find the sparkle watermark using NCC template matching
 *   3. Create a mask over the detected region
 *   4. Run MI-GAN inpainting on the masked region
 *   5. Return the cleaned image as a blob URL
 *
 * The MI-GAN model (27MB) is loaded lazily from /models/migan_pipeline_v2.onnx
 * and cached by the browser after the first load.
 */

import { inpaint, preloadModel, type InpaintProgress } from './inpaint'
import { detectMarks } from './detect'

let modelPromise: Promise<unknown> | null = null

/** Preload the MI-GAN model (call at startup to warm the cache). */
export function preloadMiganModel(onProgress?: (p: InpaintProgress) => void): Promise<unknown> {
  if (!modelPromise) {
    modelPromise = preloadModel(onProgress).catch((err) => {
      modelPromise = null
      throw err
    })
  }
  return modelPromise
}

/**
 * Remove the Meta AI watermark using MI-GAN neural network inpainting.
 *
 * @param imageUrl - The source image URL (CDN or relative)
 * @returns A blob URL of the cleaned image, or the original URL on failure
 */
export async function removeWatermarkWithMigan(
  imageUrl: string,
  onProgress?: (p: InpaintProgress) => void,
): Promise<string> {
  try {
    // 1. Fetch the image (proxied if CDN to avoid CORS)
    let imgSrc = imageUrl
    if (!imageUrl.startsWith('/api/') && !imageUrl.startsWith(window.location.origin)) {
      const proxyUrl = `/api/vibes/image-proxy?url=${encodeURIComponent(imageUrl)}`
      const response = await fetch(proxyUrl)
      if (response.ok) {
        const blob = await response.blob()
        imgSrc = URL.createObjectURL(blob)
      }
    }

    // 2. Load it into an HTMLImageElement
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = imgSrc
    })

    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w < 64 || h < 64) return imageUrl

    // 3. Draw the image to a canvas
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0)

    // 4. Auto-detect the watermark(s) using NCC template matching
    const imageData = ctx.getImageData(0, 0, w, h)
    const marks = await detectMarks(imageData)

    // 5. Build the mask (255 = erase, 0 = keep)
    const mask = new Uint8Array(w * h)
    if (marks.length > 0) {
      // Detected marks — paint rounded rects over them
      for (const mark of marks) {
        const { x, y, w: rw, h: rh } = mark.rect
        // Fill the detected region with 255 (erase)
        for (let py = Math.max(0, y); py < Math.min(h, y + rh); py++) {
          for (let px = Math.max(0, x); px < Math.min(w, x + rw); px++) {
            mask[py * w + px] = 255
          }
        }
      }
    } else {
      // No detection — fall back to a fixed bottom-right corner mask
      // The "Meta AI" text watermark is in the bottom-right corner
      const wmW = Math.round(w * 0.12)
      const wmH = Math.round(h * 0.07)
      const wmX = Math.max(0, w - wmW - Math.round(w * 0.003))
      const wmY = Math.max(0, h - wmH - Math.round(h * 0.005))
      for (let py = wmY; py < Math.min(h, wmY + wmH); py++) {
        for (let px = wmX; px < Math.min(w, wmX + wmW); px++) {
          mask[py * w + px] = 255
        }
      }
    }

    // 6. Preload the MI-GAN model (downloads 27MB on first call, cached after)
    await preloadMiganModel(onProgress)

    // 7. Run MI-GAN inpainting on the masked region
    const patch = await inpaint(imageData, mask, onProgress)
    if (!patch) return imageUrl

    // 8. Paste the inpainted patch back onto the canvas
    const patchCtx = canvas.getContext('2d')!
    patchCtx.putImageData(patch.data, patch.x, patch.y)

    // 9. Convert to blob URL
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
        'image/png',
      )
    })

    return URL.createObjectURL(blob)
  } catch (err) {
    console.error('[migan] watermark removal failed:', err)
    return imageUrl
  }
}
