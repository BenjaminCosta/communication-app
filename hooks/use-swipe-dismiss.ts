"use client"

import { useRef, useState } from "react"

/**
 * Attach `handlers` to the drag handle element and `dragStyle` to the sheet
 * root element. When the user drags down more than `threshold` px — or flicks
 * fast enough (velocity > 0.4 px/ms with at least 20px travel) — the sheet
 * snaps away via `onDismiss`; otherwise it springs back.
 */
export function useSwipeDismiss(onDismiss: () => void, threshold = 60) {
  const startY = useRef(0)
  const startTime = useRef(0)
  const [dragY, setDragY] = useState(0)
  const [released, setReleased] = useState(false)

  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      startY.current = e.touches[0].clientY
      startTime.current = Date.now()
      setReleased(false)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const delta = e.touches[0].clientY - startY.current
      if (delta > 0) setDragY(delta)
    },
    onTouchEnd: () => {
      const elapsed = Date.now() - startTime.current
      const velocity = elapsed > 0 ? dragY / elapsed : 0 // px/ms
      const isFlick = dragY > 20 && velocity > 0.4
      if (dragY >= threshold || isFlick) {
        onDismiss()
      } else {
        setReleased(true)
        requestAnimationFrame(() => setDragY(0))
      }
    },
    onTouchCancel: () => {
      setReleased(true)
      requestAnimationFrame(() => setDragY(0))
    },
  }

  const dragStyle: React.CSSProperties = {
    transform: `translateY(${dragY}px)`,
    transition: released ? "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)" : "none",
    willChange: dragY > 0 ? "transform" : "auto",
  }

  return { handlers, dragStyle, isDragging: dragY > 0 }
}
