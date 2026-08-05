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

    navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // The worker imports Firebase scripts. Bypass the HTTP cache for both
      // the worker and its imports so an app update cannot retain old logic.
      updateViaCache: 'none',
    }).then((registration) => {
      registration.update().catch(() => {
        // SW update check failed silently
      })
    }).catch(() => {
      // SW registration failed silently
    })
  }, [])

  return null
}
