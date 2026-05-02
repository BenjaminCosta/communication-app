"use client"

import { useRef, useState } from "react"

/**
 * Attach `handlers` to the drag handle element and `dragStyle` to the sheet
 * root element. When the user drags down more than `threshold` px the sheet
 * snaps away via `onDismiss`; otherwise it springs back.
 */
export function useSwipeDismiss(onDismiss: () => void, threshold = 80) {
  const startY = useRef(0)
  const [dragY, setDragY] = useState(0)
  const [released, setReleased] = useState(false)

  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      startY.current = e.touches[0].clientY
      setReleased(false)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const delta = e.touches[0].clientY - startY.current
      if (delta > 0) setDragY(delta)
    },
    onTouchEnd: () => {
      if (dragY >= threshold) {
        onDismiss()
      } else {
        // Enable the spring-back transition, then animate to 0 on the next frame
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
