'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => {
          // SW cleanup failed silently
        })
      return
    }

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.update().catch(() => {
        // SW update check failed silently
      })
    }).catch(() => {
      // SW registration failed silently
    })
  }, [])

  return null
}
