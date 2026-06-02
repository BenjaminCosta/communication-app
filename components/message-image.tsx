"use client"

import { useState, useEffect } from "react"
import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export const loadedImageUrls = new Set<string>()

function decodeBlurHashToDataURL(hash: string, w: number, h: number): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { decode } = require("blurhash") as typeof import("blurhash")
    const pixels = decode(hash, w, h)
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!
    const imageData = ctx.createImageData(w, h)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL()
  } catch {
    return null
  }
}

const blurHashDataUrlCache = new Map<string, string>()

function getBlurHashDataURL(hash: string, w: number, h: number): string | null {
  const key = `${hash}-${w}-${h}`
  if (blurHashDataUrlCache.has(key)) return blurHashDataUrlCache.get(key)!
  const thumbW = 32
  const thumbH = Math.max(1, Math.round((h / w) * thumbW))
  const url = decodeBlurHashToDataURL(hash, thumbW, thumbH)
  if (url) blurHashDataUrlCache.set(key, url)
  return url
}

export function MessageImage({
  src,
  alt,
  width,
  height,
  blurHash,
  onClick,
}: {
  src: string
  alt: string
  width?: number
  height?: number
  blurHash?: string
  onClick: () => void
}) {
  const alreadyLoaded = loadedImageUrls.has(src)

  // "loaded" tracks whether the <img> onLoad has fired (internal crossfade).
  const [loaded, setLoaded] = useState(alreadyLoaded)
  // "visible" controls the outer opacity mask.
  // For already-loaded images: show immediately.
  // For new images: start invisible, reveal after 2 animation frames so any
  // layout computation that happens on the first render is never seen.
  const [visible, setVisible] = useState(alreadyLoaded)

  const [localW, setLocalW] = useState(width)
  const [localH, setLocalH] = useState(height)

  // B: on mount, wait 2 frames before revealing — hides any first-frame layout shift.
  // C: the <img loading="eager"> already starts the download immediately on mount.
  useEffect(() => {
    if (alreadyLoaded) return
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(r2)
    })
    return () => cancelAnimationFrame(r1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const w = localW
  const h = localH
  const hasDims = !!(w && h)

  const blurDataUrl = blurHash && w && h && !loaded
    ? getBlurHashDataURL(blurHash, w, h)
    : null

  // padding-bottom % trick: height = (h/w × 100%) of own width — single-pass,
  // iOS Safari safe. min() caps portrait images at 288 px.
  const paddingBottom = hasDims
    ? `min(${((h / w) * 100).toFixed(4)}%, 288px)`
    : "56.25%"

  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        "mb-2 block w-full overflow-hidden rounded-xl border border-white/10 active:scale-[0.99]",
        // Outer opacity mask: hides first-frame layout computation.
        // Transition only applies when going visible (easeOut feels snappy).
        "transition-opacity duration-350 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      {/* padding-bottom box — height is CSS-only, never affected by image loading */}
      <div className="relative w-full" style={{ paddingBottom }}>

        {/* BlurHash / shimmer skeleton */}
        <div
          className={cn(
            "absolute inset-0 z-10 transition-opacity duration-500",
            loaded ? "opacity-0 pointer-events-none" : "opacity-100",
          )}
          style={
            blurDataUrl
              ? {
                  backgroundImage: `url(${blurDataUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: "blur(12px)",
                  transform: "scale(1.08)",
                }
              : { background: "rgba(255,255,255,0.05)" }
          }
        >
          {!blurDataUrl && (
            <>
              <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/8 to-transparent animate-pulse" />
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="w-7 h-7 text-white/20" />
              </div>
            </>
          )}
        </div>

        {/* Real image — absolutely positioned, zero layout contribution */}
        <img
          src={src}
          alt={alt}
          loading="eager"
          onLoad={(e) => {
            if (!localW || !localH) {
              const el = e.currentTarget
              setLocalW(el.naturalWidth)
              setLocalH(el.naturalHeight)
            }
            loadedImageUrls.add(src)
            setLoaded(true)
          }}
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </button>
  )
}
