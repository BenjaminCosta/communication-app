'use client'

import { useEffect } from 'react'

/**
 * Keeps the app shell glued to the VISUAL viewport.
 *
 * Problem it solves: the <body> is `position: fixed` and the html/body have
 * `overflow: hidden`, so there is no document-level scroll. When the user zooms
 * in (pinch-zoom / "force enable zoom" / browser page-zoom that produces a
 * visual-viewport offset), the fixed body stays anchored to the *layout*
 * viewport — which is larger than what is actually visible. The parts of the UI
 * below the visible band (tags in Compose, the Sign Out button in Profile, …)
 * become unreachable: inner scroll containers think everything fits, and the
 * page itself can't be panned because it's fixed + overflow:hidden.
 *
 * Fix: while zoomed, size and position the shell to the *visual* viewport via
 * CSS vars consumed by <body>. The app re-fits into the visible area, so every
 * `overflow-y-auto` container becomes scrollable again and stays functional no
 * matter how much zoom is applied. At scale 1 (normal / keyboard) the vars fall
 * back to full-size, so default behavior is untouched.
 */
export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    let raf = 0

    const apply = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // scale > 1 means the visual viewport is smaller than the layout
        // viewport (i.e. the user is zoomed in). Small epsilon avoids float jitter.
        const zoomed = vv.scale > 1.01
        if (zoomed) {
          root.style.setProperty('--app-w', `${vv.width}px`)
          root.style.setProperty('--app-h', `${vv.height}px`)
          root.style.setProperty('--app-x', `${vv.offsetLeft}px`)
          root.style.setProperty('--app-y', `${vv.offsetTop}px`)
          root.setAttribute('data-zoomed', 'true')
        } else {
          root.style.setProperty('--app-w', '100%')
          root.style.setProperty('--app-h', '100%')
          root.style.setProperty('--app-x', '0px')
          root.style.setProperty('--app-y', '0px')
          root.removeAttribute('data-zoomed')
        }
      })
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      cancelAnimationFrame(raf)
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [])

  return null
}
