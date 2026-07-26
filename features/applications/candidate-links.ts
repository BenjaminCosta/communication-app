/**
 * Local invite registry for mock / preview mode.
 *
 * There is deliberately no sample candidate data here. The store starts
 * empty and only contains applications that a reviewer actually invited. It
 * mirrors Firestore closely enough that the candidate flow and dashboard can
 * be exercised together before the backend flag is enabled.
 */

import {
  blankApplication,
  createApplicationLink,
  type ApplicationLink,
  type ApplicationSectionId,
  type CandidateApplication,
  type InviteDetails,
  type LinkPurpose,
} from "@/lib/applications-core"

/** Passed as `applicationId` while creating a new invite. */
export const NEW_APPLICATION_MARKER = "new-application"

const STORAGE_KEY = "svc-applications-local-v1"
const CHANGE_EVENT = "svc-applications-local-change"

interface LocalApplicationsSnapshot {
  applications: CandidateApplication[]
  links: ApplicationLink[]
}

const applications = new Map<string, CandidateApplication>()
const links = new Map<string, ApplicationLink>()
let hydrated = false

function isBrowser() {
  return typeof window !== "undefined"
}

function readSnapshot(): LocalApplicationsSnapshot | null {
  if (!isBrowser()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalApplicationsSnapshot>
    if (!Array.isArray(parsed.applications) || !Array.isArray(parsed.links)) return null
    return { applications: parsed.applications, links: parsed.links }
  } catch {
    return null
  }
}

function hydrate(force = false) {
  if (hydrated && !force) return
  hydrated = true
  applications.clear()
  links.clear()
  const snapshot = readSnapshot()
  snapshot?.applications.forEach((application) => {
    if (application && typeof application.id === "string") applications.set(application.id, application)
  })
  snapshot?.links.forEach((link) => {
    if (link && typeof link.token === "string") links.set(link.token, link)
  })
}

function persist() {
  if (!isBrowser()) return
  const snapshot: LocalApplicationsSnapshot = {
    applications: Array.from(applications.values()),
    links: Array.from(links.values()),
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Preview mode remains usable for this tab even when storage is disabled.
  }
}

function sortedApplications(): CandidateApplication[] {
  hydrate()
  return Array.from(applications.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** Subscribe the mock dashboard to actual local invites, never fixtures. */
export function subscribeMockApplications(onChange: (next: CandidateApplication[]) => void): () => void {
  onChange(sortedApplications())
  if (!isBrowser()) return () => {}

  const refresh = () => {
    hydrate(true)
    onChange(sortedApplications())
  }
  window.addEventListener(CHANGE_EVENT, refresh)
  window.addEventListener("storage", refresh)
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh)
    window.removeEventListener("storage", refresh)
  }
}

/** A candidate draft that was created by a real invite, if it exists locally. */
export function applicationById(applicationId: string | null | undefined): CandidateApplication | null {
  if (!applicationId) return null
  hydrate()
  return applications.get(applicationId) ?? null
}

/** Resolve an invite token to the application it created. */
export function applicationByToken(token: string): CandidateApplication {
  const link = linkForToken(token)
  return applicationById(link.applicationId) ?? blankApplication(link.applicationId, token)
}

/** Candidate autosave / submit writes back to the same local application. */
export function saveMockApplication(application: CandidateApplication): CandidateApplication {
  hydrate()
  applications.set(application.id, application)
  persist()
  return application
}

/** Reviewer actions are persisted too, so a reopened candidate link sees them. */
export function updateMockApplication(
  applicationId: string,
  patch: (application: CandidateApplication) => CandidateApplication,
): CandidateApplication | null {
  const current = applicationById(applicationId)
  if (!current) return null
  return saveMockApplication(patch(current))
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * Opaque, URL-safe bearer token. The alphabet has 32 characters, so masking
 * five random bits per character is uniform and gives 160 bits of entropy.
 */
export function generateLinkToken(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789"
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  return Array.from(random, (value) => alphabet[value & 31]).join("")
}

export function issueApplicationLink(input: {
  applicationId: string
  purpose: LinkPurpose
  step?: ApplicationSectionId | null
  invite?: InviteDetails
}): ApplicationLink {
  hydrate()
  const token = generateLinkToken()
  const applicationId = input.applicationId === NEW_APPLICATION_MARKER ? `app-${token}` : input.applicationId

  if (input.applicationId === NEW_APPLICATION_MARKER) {
    applications.set(applicationId, blankApplication(applicationId, token, input.invite))
  }

  const link = createApplicationLink({
    applicationId,
    purpose: input.purpose,
    step: input.step ?? null,
    token,
  })
  links.set(link.token, link)

  // A full application link is the canonical resume link shown in the detail.
  if (input.purpose === "application") {
    const application = applications.get(applicationId)
    if (application) applications.set(applicationId, { ...application, linkToken: token })
  }
  persist()
  return link
}

export function revokeApplicationLink(token: string): ApplicationLink | null {
  hydrate()
  const link = links.get(token)
  if (!link) return null
  const revoked = { ...link, revokedAt: new Date().toISOString() }
  links.set(token, revoked)
  persist()
  return revoked
}

/**
 * What a token opens. Unknown tokens are only used by the internal preview,
 * so they receive a blank one-off draft rather than pretending to be a real
 * invite.
 */
export function linkForToken(token: string): ApplicationLink {
  hydrate()
  const known = links.get(token)
  if (known) return known
  if (token.startsWith("agreement")) {
    return createApplicationLink({ applicationId: `app-${token}`, purpose: "agreement", token })
  }
  if (token.startsWith("documents") || token.startsWith("video") || token.startsWith("general")) {
    const step = token.split("-")[0] as ApplicationSectionId
    return createApplicationLink({ applicationId: `app-${token}`, purpose: "step", step, token })
  }
  return createApplicationLink({ applicationId: `app-${token}`, purpose: "application", token })
}
