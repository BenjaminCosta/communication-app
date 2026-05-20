"use client"

import { useEffect } from "react"

/**
 * Landing page for the Google OAuth implicit-flow redirect.
 * Reads the access_token from the URL hash, posts it back to the opener,
 * then closes itself.
 */
export default function GoogleOAuthCallback() {
  useEffect(() => {
    const hash = window.location.hash.slice(1) // strip leading "#"
    const params = new URLSearchParams(hash)
    const accessToken = params.get("access_token")
    const error = params.get("error")
    const payload = { type: "google_oauth_callback", accessToken: accessToken ?? null, error: error ?? null }

    // Primary: BroadcastChannel — works even when COOP severs window.opener
    try {
      const bc = new BroadcastChannel("google_oauth_callback")
      bc.postMessage(payload)
      bc.close()
    } catch {}

    // Fallback: postMessage via opener (works when COOP allows it)
    if (window.opener) {
      try {
        window.opener.postMessage(payload, window.location.origin)
      } catch {}
    }

    window.close()
  }, [])

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      fontFamily: "system-ui, sans-serif",
      color: "#888",
      background: "#0a0a0a",
    }}>
      <p>Completing sign-in…</p>
    </div>
  )
}
