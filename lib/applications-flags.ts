/**
 * Client-safe feature flag for the Applications backend.
 *
 * Off by default: the module runs on local mock data, which is what makes the
 * whole flow demoable without Firestore. Turning it on switches the internal
 * dashboard to `/applications` — the candidate flow stays on mock until its
 * own phase lands, so a half-connected state can't strand a real candidate.
 */

function readBooleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1"
}

export const APPLICATIONS_BACKEND_ENABLED = readBooleanFlag(process.env.NEXT_PUBLIC_APPLICATIONS_BACKEND)
