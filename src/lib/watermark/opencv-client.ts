/**
 * Client-side Meta AI watermark removal using OpenCV.js inpainting.
 *
 * Uses cv.inpaint() with the Telea algorithm to reconstruct the
 * bottom-right corner where the Meta AI sparkle watermark sits.
 * This produces much better results than the server-side mirror+blur
 * approach — OpenCV's inpainting fills the masked region using
 * surrounding pixel information via a fast marching method (Telea)
 * or Navier-Stokes fluid dynamics.
 *
 * OpenCV.js (13MB WASM) is loaded lazily from /public/opencv.js
 * via a <script> tag, only when the first image needs cleaning.
 * The browser caches it for all subsequent visits.
 */

declare global {
  interface Window {
    cv?: any;
  }
}

import { detectSparkle } from './detect-sparkle';

const OPENCV_URL = '/opencv.js';
const INPAINT_RADIUS = 5;            // inpainting radius (px)

let cvPromise: Promise<any> | null = null;

/**
 * Load OpenCV.js lazily via a <script> tag.
 * The WASM binary is embedded in the 13MB JS file.
 * Cached after first load by the browser.
 */
function loadOpenCV(): Promise<any> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    // Already loaded?
    if (window.cv && window.cv.Mat) {
      resolve(window.cv);
      return;
    }

    // Check if script tag already exists
    const existing = document.getElementById('opencv-script');
    if (existing) {
      // Script is loading — wait for it
      const checkReady = () => {
        if (window.cv && window.cv.Mat) {
          resolve(window.cv);
        } else if (window.cv) {
          // cv exists but not fully initialized
          window.cv.onRuntimeInitialized = () => resolve(window.cv);
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
      return;
    }

    // Create script tag
    const script = document.createElement('script');
    script.id = 'opencv-script';
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => {
      // OpenCV.js sets window.cv but it needs time to initialize WASM
      const checkReady = () => {
        if (window.cv && window.cv.Mat) {
          resolve(window.cv);
        } else if (window.cv) {
          window.cv.onRuntimeInitialized = () => resolve(window.cv);
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    };
    script.onerror = () => {
      cvPromise = null; // allow retry
      reject(new Error('Failed to load OpenCV.js'));
    };
    document.head.appendChild(script);
  });

  return cvPromise;
}

/**
 * Fetch an image as a blob URL, proxied through our server if it's a CDN URL
 * (to avoid CORS tainted canvas issues).
 */
async function fetchImageAsBlobUrl(imageUrl: string): Promise<string> {
  // For our own API URLs (same-origin), load directly
  if (imageUrl.startsWith('/api/') || imageUrl.startsWith(window.location.origin)) {
    return imageUrl;
  }

  // For CDN URLs (fbcdn.net, etc.), fetch through our lightweight proxy
  // which returns the raw image with CORS headers (no watermark cleaning)
  try {
    const proxyUrl = `/api/vibes/image-proxy?url=${encodeURIComponent(imageUrl)}`;
    const response = await fetch(proxyUrl);

    if (response.ok) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fallback: try loading directly with crossOrigin
  }

  // Fallback: try loading directly (may fail for tainted canvas)
  return imageUrl;
}

/**
 * Remove the Meta AI watermark from an image using OpenCV.js inpainting.
 *
 * Uses auto-detection to find the exact sparkle location (not a fixed
 * rectangle), so only the watermark pixels are inpainted — the surrounding
 * image content is preserved without cutting.
 *
 * @param imageUrl - The source image URL (CDN or relative)
 * @returns A blob URL of the cleaned image, or the original URL on failure
 */
export async function removeWatermarkWithOpenCV(
  imageUrl: string,
): Promise<string> {
  try {
    // 1. Load OpenCV.js
    const cv = await loadOpenCV();

    // 2. Fetch the image (proxied if CDN to avoid CORS)
    const proxiedUrl = await fetchImageAsBlobUrl(imageUrl);

    // 3. Load it into an HTMLImageElement
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = proxiedUrl;
    });

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < 64 || h < 64) return imageUrl;

    // 4. Draw the image to a canvas
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    // 5. Auto-detect the sparkle watermark (only the sparkle pixels, not a rectangle)
    const detected = detectSparkle(canvas);

    let maskCanvas: HTMLCanvasElement;

    if (detected) {
      // Use the precise mask from auto-detection — only covers the sparkle
      maskCanvas = detected.mask;
    } else {
      // Fallback: precise rectangle matching the "Meta AI" text watermark
      // The watermark is TEXT (wider than tall), not just a sparkle
      const wmW = Math.round(w * 0.085); // 8.5% width (text + icon)
      const wmH = Math.round(h * 0.055); // 5.5% height (text height)
      const insetX = Math.round(w * 0.005);
      const insetY = Math.round(h * 0.008);
      const wmX = Math.max(0, w - wmW - insetX);
      const wmY = Math.max(0, h - wmH - insetY);

      maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.fillStyle = '#000000';
      maskCtx.fillRect(0, 0, w, h);
      maskCtx.fillStyle = '#ffffff';
      maskCtx.fillRect(wmX, wmY, wmW, wmH);
    }

    // 5. Convert canvas images to OpenCV Mats
    const srcMat = cv.imread(canvas);
    const maskMat = cv.imread(maskCanvas);

    // Convert mask to single channel (grayscale)
    const maskGray = new cv.Mat();
    cv.cvtColor(maskMat, maskGray, cv.COLOR_RGBA2GRAY);

    // 6. Run inpainting (Telea algorithm)
    const dstMat = new cv.Mat();
    cv.inpaint(srcMat, maskGray, dstMat, INPAINT_RADIUS, cv.INPAINT_TELEA);

    // 7. Convert result back to canvas
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = w;
    resultCanvas.height = h;
    cv.imshow(resultCanvas, dstMat);

    // 8. Convert canvas to blob URL
    const blob = await new Promise<Blob>((resolve, reject) => {
      resultCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
        'image/png',
      );
    });

    // 9. Clean up OpenCV Mats (prevent memory leaks)
    srcMat.delete();
    maskMat.delete();
    maskGray.delete();
    dstMat.delete();

    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('[opencv] watermark removal failed:', err);
    return imageUrl; // fallback to original
  }
}

/**
 * Check if OpenCV.js is already loaded.
 */
export function isOpenCVReady(): boolean {
  return !!(window.cv && window.cv.Mat);
}

/**
 * Preload OpenCV.js (call at app startup to warm the cache).
 */
export function preloadOpenCV(): Promise<any> {
  return loadOpenCV();
}
