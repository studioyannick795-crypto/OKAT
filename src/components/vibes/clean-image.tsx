/**
 * Client-side hook for removing the Meta AI watermark from images.
 *
 * Uses OpenCV.js (cv.inpaint with Telea algorithm) running in the browser
 * for high-quality watermark removal. Falls back to the server-side
 * sharp-based endpoint if OpenCV.js fails to load.
 *
 * The watermark in the bottom-right corner is automatically removed BEFORE
 * the image is displayed — the user never sees the Meta AI sparkle.
 *
 * Usage:
 *   const cleanUrl = useCleanImage(rawUrl)
 *   return <img src={cleanUrl} />
 *
 * Or as a component:
 *   <CleanImage src={rawUrl} alt="..." />
 */

'use client'

import { useEffect, useState } from 'react'
import { removeWatermarkWithMigan } from '@/lib/watermark/migan-client'
import { removeWatermarkWithOpenCV } from '@/lib/watermark/opencv-client'

// In-memory cache: raw URL → cleaned blob URL (per browser session).
// This prevents re-cleaning the same image on every render.
const cache = new Map<string, string>()

/** True if the URL is a vibes.ai CDN image (needs cleaning). */
function needsCleaning(url: string): boolean {
  return (
    url.includes('fbcdn.net') ||
    url.includes('vibes.ai') ||
    url.startsWith('https://video-sin') ||
    url.startsWith('https://scontent-') ||
    url.startsWith('/api/vibes/')
  )
}

/**
 * Clean an image URL by removing the Meta AI watermark.
 *
 * Strategy:
 *   1. Try OpenCV.js client-side inpainting (best quality, runs in browser)
 *   2. Fall back to server-side /api/vibes/watermark/clean (sharp mirror+blur)
 *   3. Fall back to original URL if both fail
 *
 * Returns a blob URL of the cleaned image, or the original URL on failure.
 */
async function cleanImageUrl(rawUrl: string): Promise<string> {
  // Check cache first
  const cached = cache.get(rawUrl)
  if (cached) return cached

  // Don't clean non-CDN URLs
  if (!needsCleaning(rawUrl)) {
    cache.set(rawUrl, rawUrl)
    return rawUrl
  }

  try {
    // Strategy 1: MI-GAN neural network inpainting (BEST — same as watermark-remover app)
    const miganResult = await removeWatermarkWithMigan(rawUrl)
    if (miganResult !== rawUrl) {
      cache.set(rawUrl, miganResult)
      return miganResult
    }
  } catch {
    // MI-GAN failed — try OpenCV fallback
  }

  try {
    // Strategy 2: OpenCV.js client-side inpainting (Telea algorithm)
    const cvResult = await removeWatermarkWithOpenCV(rawUrl)
    if (cvResult !== rawUrl) {
      cache.set(rawUrl, cvResult)
      return cvResult
    }
  } catch {
    // OpenCV failed — try server fallback
  }

  // Strategy 2: Server-side fallback (sharp mirror+blur)
  try {
    let response: Response

    if (rawUrl.startsWith('/api/vibes/')) {
      // For our own API routes, append ?clean=true
      const url = new URL(rawUrl, window.location.origin)
      url.searchParams.set('clean', 'true')
      response = await fetch(url.toString())
    } else {
      // For CDN URLs, POST to the clean endpoint
      response = await fetch('/api/vibes/watermark/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: rawUrl }),
      })
    }

    if (response.ok) {
      const removed = response.headers.get('X-Watermark-Removed')
      if (removed !== 'false') {
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        cache.set(rawUrl, blobUrl)
        return blobUrl
      }
    }
  } catch {
    // Server fallback also failed
  }

  // Strategy 3: Return original (cache to avoid retrying)
  cache.set(rawUrl, rawUrl)
  return rawUrl
}

/**
 * Hook that returns a watermark-cleaned image URL.
 *
 * While the cleaned version is being prepared, the original URL is returned
 * (so the image displays immediately, then swaps to the cleaned version
 * once OpenCV.js has finished inpainting).
 *
 * @param rawUrl The original image URL (CDN URL or /api/vibes/... path)
 * @returns The cleaned URL (blob: or original on failure)
 */
export function useCleanImage(rawUrl: string | undefined | null): string {
  const [state, setState] = useState<{
    rawUrl: string | undefined | null
    cleanUrl: string
  }>(() => ({
    rawUrl,
    cleanUrl: rawUrl ?? '',
  }))

  // Adjust state during render when the rawUrl changes
  if (state.rawUrl !== rawUrl) {
    if (!rawUrl) {
      setState({ rawUrl, cleanUrl: '' })
    } else {
      const cached = cache.get(rawUrl)
      setState({ rawUrl, cleanUrl: cached ?? rawUrl })
    }
  }

  useEffect(() => {
    if (!rawUrl) return

    let active = true

    // If it was a cache hit, nothing to do
    if (cache.get(rawUrl)) return

    // Otherwise, clean the image asynchronously
    cleanImageUrl(rawUrl).then((cleaned) => {
      if (active && cleaned !== rawUrl) {
        setState((prev) =>
          prev.rawUrl === rawUrl ? { ...prev, cleanUrl: cleaned } : prev,
        )
      }
    })

    return () => {
      active = false
    }
  }, [rawUrl])

  return state.cleanUrl
}

/**
 * Hook that cleans multiple image URLs in parallel.
 * Returns an array of cleaned URLs (same order as input).
 */
export function useCleanImages(rawUrls: (string | undefined | null)[]): string[] {
  const [cleanUrls, setCleanUrls] = useState<string[]>(
    rawUrls.map((u) => u ?? ''),
  )

  useEffect(() => {
    let active = true

    // Clean all in parallel
    Promise.all(
      rawUrls.map((url) =>
        url ? cleanImageUrl(url) : '',
      ),
    ).then((cleaned) => {
      if (active) {
        setCleanUrls(cleaned)
      }
    })

    return () => {
      active = false
    }
  }, [rawUrls.join('|')])

  return cleanUrls
}

/**
 * A React component wrapper that renders an <img> with the watermark
 * automatically removed using OpenCV.js. Drop-in replacement for <img>.
 *
 * The image is first displayed with the original URL (so it appears
 * immediately), then swaps to the cleaned version once OpenCV.js
 * has finished inpainting the watermark region.
 */
export function CleanImage({
  src,
  alt,
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const cleanSrc = useCleanImage(src)
  return <img src={cleanSrc} alt={alt} className={className} {...props} />
}
