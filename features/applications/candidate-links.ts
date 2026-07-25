/**
 * In-memory link registry + blank drafts for MOCK/PREVIEW mode only.
 *
 * With the backend flag OFF (local dev without the emulator) or when an
 * internal reviewer previews the candidate flow, there is no Firestore to talk
 * to — this stands in for `/applicationLinks` and the application doc. There is
 * NO fake candidate data here: drafts open empty, exactly like a real new
 * application. The shape mirrors the real records so live mode is a drop-in.
 */

import {
  blankApplication,
  createApplicationLink,
  type ApplicationLink,
  type ApplicationSectionId,
  type CandidateApplication,
  type LinkPurpose,
} from "@/lib/applications-core"

/** A blank draft for the given token — no prefilled data. */
export function applicationByToken(token: string): CandidateApplication {
  return blankApplication(`app-${token}`, token)
}

/** No in-memory application registry — previews always start from a blank draft. */
export function applicationById(): CandidateApplication | null {
  return null
}

// ── Links ───────────────────────────────────────────────────────────────

const LINKS = new Map<string, ApplicationLink>()

/** Tokens look like the real thing: short, opaque, URL-safe. */
export function generateLinkToken(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789"
  let token = ""
  for (let index = 0; index < 10; index += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return token
}

export function issueApplicationLink(input: {
  applicationId: string
  purpose: LinkPurpose
  step?: ApplicationSectionId | null
}): ApplicationLink {
  const link = createApplicationLink({ ...input, token: generateLinkToken() })
  LINKS.set(link.token, link)
  return link
}

export function revokeApplicationLink(token: string): ApplicationLink | null {
  const link = LINKS.get(token)
  if (!link) return null
  const revoked = { ...link, revokedAt: new Date().toISOString() }
  LINKS.set(token, revoked)
  return revoked
}

/**
 * What a token opens. Unknown tokens fall back to a plain application link so a
 * preview never dead-ends; the real resolver returns 404 instead. Reserved
 * prefixes let a reviewer preview each link purpose.
 */
export function linkForToken(token: string): ApplicationLink {
  const known = LINKS.get(token)
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
