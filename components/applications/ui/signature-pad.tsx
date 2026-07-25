"use client"

/**
 * Finger/stylus signature pad.
 *
 * Pointer events (not touch) so it works with finger, pen and mouse from one
 * code path. The canvas is sized in device pixels and scaled back down, which
 * is what keeps the stroke crisp on a phone.
 *
 * `onChange(hasInk)` is all the parent needs; the PNG is produced on demand
 * with `toDataURL()` — in this phase nothing is uploaded.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SignaturePadHandle {
  /** PNG data URL of the drawn signature, or null if empty. */
  toDataUrl: () => string | null
  clear: () => void
}

interface SignaturePadProps {
  onChange: (hasInk: boolean) => void
  className?: string
  /** Shown behind the stroke until the candidate signs. */
  placeholder?: string
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { onChange, className, placeholder = "Sign here" },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    // Resizing clears the bitmap, so this only runs on mount / orientation change.
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const context = canvas.getContext("2d")
    if (!context) return
    context.scale(ratio, ratio)
    context.lineWidth = 2.4
    context.lineCap = "round"
    context.lineJoin = "round"
    context.strokeStyle = "#0F172A"
  }, [])

  useEffect(() => {
    prepareCanvas()
    const onResize = () => {
      prepareCanvas()
      setHasInk(false)
      onChange(false)
    }
    window.addEventListener("orientationchange", onResize)
    return () => window.removeEventListener("orientationchange", onResize)
  }, [onChange, prepareCanvas])

  const pointFrom = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFrom(event)
  }

  const extendStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()
    const context = canvasRef.current?.getContext("2d")
    const last = lastPointRef.current
    if (!context || !last) return
    const point = pointFrom(event)
    context.beginPath()
    context.moveTo(last.x, last.y)
    // Quadratic through the midpoint smooths the jitter of a finger.
    const midX = (last.x + point.x) / 2
    const midY = (last.y + point.y) / 2
    context.quadraticCurveTo(last.x, last.y, midX, midY)
    context.stroke()
    lastPointRef.current = point
    if (!hasInk) {
      setHasInk(true)
      onChange(true)
    }
  }

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(false)
  }, [onChange])

  useImperativeHandle(
    ref,
    () => ({
      toDataUrl: () => (hasInk ? (canvasRef.current?.toDataURL("image/png") ?? null) : null),
      clear,
    }),
    [clear, hasInk],
  )

  return (
    <div className={cn("relative", className)}>
      <div className="relative overflow-hidden rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)]">
        <canvas
          ref={canvasRef}
          // touch-none stops the page from scrolling while signing.
          className="block h-40 w-full touch-none"
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          aria-label="Signature area"
          role="img"
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-sm font-medium text-[#94A3B8]">{placeholder}</span>
            <span className="h-px w-2/3 bg-[var(--apps-border)]" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-[var(--apps-text-muted)]">Use your finger or a stylus.</p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="applications-tap flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-[var(--apps-blue-strong)] disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Clear
        </button>
      </div>
    </div>
  )
})
