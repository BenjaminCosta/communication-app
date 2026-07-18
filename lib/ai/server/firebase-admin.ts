import type { App } from "firebase-admin/app"

/**
 * One lazily initialized Firebase Admin app shared by auth and the distributed
 * AI request guard. Keeping initialization here avoids racing two serverless
 * modules during a cold start.
 */
let adminAppPromise: Promise<App> | null = null

export function getFirebaseAdminApp(): Promise<App> {
  if (adminAppPromise) return adminAppPromise

  adminAppPromise = (async () => {
    const { applicationDefault, cert, getApps, initializeApp } = await import("firebase-admin/app")
    const existing = getApps()[0]
    if (existing) return existing

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    return initializeApp({
      credential: raw ? cert(JSON.parse(raw) as Parameters<typeof cert>[0]) : applicationDefault(),
    })
  })()

  return adminAppPromise
}

