"use client"

import { useRef, useState } from "react"

/**
 * Right swipe gesture for message reply (finger moves left → right).
 * Attach `swipeHandlers` + `swipeTouchAction` to the message card element.
 * `swipeStyle` applies the translateX transform during the gesture and snap-back.
 * At rest swipeStyle is {} — no stacking context, so backdrop-filter glass works.
 * When the swipe exceeds `threshold` px (rightward), `onReply` is called.
 *
 * Uses CSS touch-action: pan-y instead of e.preventDefault() to avoid the
 * "passive event listener" console error while still allowing vertical scroll.
 */
export function useSwipeToReply(onReply: () => void, threshold = 56) {
  const startX = useRef(0)
  const startY = useRef(0)
  // dragOffset: pixel offset while swiping (positive = right); null = at rest
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(false)
  const isHorizontal = useRef<boolean | null>(null)
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      isHorizontal.current = null
      if (snapTimer.current) clearTimeout(snapTimer.current)
      setSnapping(false)
      setDragOffset(null)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const dx = e.touches[0].clientX - startX.current
      const dy = e.touches[0].clientY - startY.current

      if (isHorizontal.current === null && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy)
      }
      if (!isHorizontal.current) return

      // Only rightward swipe (positive dx), clamp to 80px
      if (dx > 0) {
        setDragOffset(Math.min(dx, 80))
      }
    },
    onTouchEnd: () => {
      if (dragOffset !== null && dragOffset >= threshold) {
        onReply()
      }
      if (dragOffset !== null && dragOffset > 0) {
        setSnapping(true)
        setDragOffset(0)
        snapTimer.current = setTimeout(() => {
          setSnapping(false)
          setDragOffset(null)
        }, 320)
      } else {
        setDragOffset(null)
      }
    },
    onTouchCancel: () => {
      setDragOffset(null)
      setSnapping(false)
    },
  }

  const swipeStyle: React.CSSProperties =
    dragOffset !== null
      ? {
          transform: `translateX(${dragOffset}px)`,
          transition: snapping ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          willChange: "transform",
        }
      : {}

  // touch-action: pan-y lets the browser handle vertical scroll natively
  // without needing e.preventDefault(), avoiding the passive listener error
  const swipeTouchAction: React.CSSProperties = { touchAction: "pan-y" }

  const swipeProgress = dragOffset !== null ? Math.min(dragOffset / threshold, 1) : 0

  return { swipeHandlers, swipeStyle, swipeTouchAction, swipeProgress }
}
