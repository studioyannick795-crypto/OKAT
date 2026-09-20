/**
 * Client-side hook for removing the Meta AI watermark from images.
 *
 * Uses the LOCAL backend (watermarkPipeline.ts) — no external API call.
 *
 * Strategy: show a static placeholder while cleaning, then display
 * the cleaned image when ready.
 */

'use client'

import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

const MAX_CONCURRENT = 5
let activeCount = 0
const waitQueue: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++
    return
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount++
      resolve()
    })
  })
}

function releaseSlot(): void {
  activeCount--
  const next = waitQueue.shift()
  if (next) next()
}

function needsCleaning(url: string): boolean {
  return (
    url.includes('fbcdn.net') ||
    url.includes('vibes.ai') ||
    url.startsWith('https://video-sin') ||
    url.startsWith('https://scontent-') ||
    url.startsWith('/api/vibes/media/') ||
    url.startsWith('/api/vibes/image-proxy')
  )
}

/** Detect ratio from image natural dimensions. */
function detectRatioFromUrl(url: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const r = img.naturalWidth / img.naturalHeight
      if (Math.abs(r - 1) < 0.15) resolve('1:1')
      else if (r > 1.4) resolve('16:9')
      else if (r < 0.75) resolve('9:16')
      else resolve('1:1')
    }
    img.onerror = () => resolve('1:1')
    img.src = url
  })
}

async function cleanImageUrl(rawUrl: string, ratio?: string): Promise<string> {
  const cacheKey = ratio ? `${rawUrl}#${ratio}` : rawUrl
  const cached = cache.get(cacheKey)
  if (cached) return cached

  if (!needsCleaning(rawUrl)) {
    cache.set(cacheKey, rawUrl)
    return rawUrl
  }

  await acquireSlot()

  try {
    let effectiveRatio = ratio
    if (!effectiveRatio) {
      effectiveRatio = await detectRatioFromUrl(rawUrl)
    }

    const response = await fetch('/api/vibes/watermark/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: rawUrl, ratio: effectiveRatio }),
    })

    if (response.ok) {
      const removed = response.headers.get('X-Watermark-Removed')
      if (removed !== 'false') {
        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        cache.set(cacheKey, blobUrl)
        return blobUrl
      }
    }
  } catch (err) {
    console.error('[clean-image] failed:', err)
  } finally {
    releaseSlot()
  }

  cache.set(cacheKey, rawUrl)
  return rawUrl
}

export function useCleanImage(rawUrl: string | undefined | null, ratio?: string): string {
  const cacheKey = ratio ? `${rawUrl}#${ratio}` : rawUrl
  const [cleanUrl, setCleanUrl] = useState<string>(() => {
    if (!rawUrl) return ''
    if (cache.get(cacheKey)) return cache.get(cacheKey)!
    return needsCleaning(rawUrl) ? '' : rawUrl
  })

  useEffect(() => {
    if (!rawUrl) return

    const cached = cache.get(cacheKey)
    if (cached) return

    if (!needsCleaning(rawUrl)) return

    let active = true
    cleanImageUrl(rawUrl, ratio).then((cleaned) => {
      if (active) {
        setCleanUrl(cleaned)
      }
    })

    return () => {
      active = false
    }
  }, [rawUrl, ratio])

  return cleanUrl
}

export function useCleanImages(rawUrls: (string | undefined | null)[], ratio?: string): string[] {
  const [cleanUrls, setCleanUrls] = useState<string[]>(
    rawUrls.map((u) => u ?? '')
  )

  useEffect(() => {
    let active = true
    Promise.all(
      rawUrls.map((url) => (url ? cleanImageUrl(url, ratio) : '')),
    ).then((cleaned) => {
      if (active) {
        setCleanUrls(cleaned)
      }
    })
    return () => {
      active = false
    }
  }, [rawUrls.join('|'), ratio])

  return cleanUrls
}

export function CleanImage({
  src,
  alt,
  className,
  ratio,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { ratio?: string }): JSX.Element {
  const cleanSrc = useCleanImage(src, ratio)
  if (!cleanSrc) {
    return (
      <div
        className={`bg-muted ${className ?? ''}`}
        style={{ minHeight: 80 }}
        aria-label={alt}
        role="img"
      />
    )
  }
  return <img src={cleanSrc} alt={alt} className={className} {...props} />
}
