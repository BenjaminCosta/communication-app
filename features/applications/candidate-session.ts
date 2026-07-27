"use client"

/**
 * Browser side of the candidate session.
 *
 * Trades the link token for a Firebase custom token via the server, then signs
 * in with it. After this resolves, `auth.currentUser` is the candidate and the
 * security rules let them read/write their own application — nothing else.
 */

import { inMemoryPersistence, setPersistence, signInWithCustomToken } from "firebase/auth"
import { candidateAuth } from "@/lib/firebase"
import type { ApplicationSectionId, LinkPurpose } from "@/lib/applications-core"

/** The candidate's Firebase ID token — proves the applicationId claim server-side. */
async function candidateAuthHeader(): Promise<string> {
  const user = candidateAuth.currentUser
  if (!user) throw new CandidateSessionError("unauthenticated", "Your session ended. Please reopen the link.")
  return `Bearer ${await user.getIdToken()}`
}

export interface CandidateSession {
  applicationId: string
  purpose: LinkPurpose
  step: ApplicationSectionId | null
}

export class CandidateSessionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "CandidateSessionError"
    this.code = code
  }
}

export async function openCandidateSession(token: string): Promise<CandidateSession> {
  let response: Response
  try {
    response = await fetch("/api/applications/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
  } catch {
    throw new CandidateSessionError("network", "We couldn't reach SVC. Check your connection and try again.")
  }

  if (!response.ok) {
    let message = "This link cannot be opened."
    let code = "session-failed"
    try {
      const body = (await response.json()) as { error?: unknown; code?: unknown }
      if (typeof body.error === "string" && body.error) message = body.error
      if (typeof body.code === "string" && body.code) code = body.code
    } catch {
      // keep defaults
    }
    throw new CandidateSessionError(code, message)
  }

  const body = (await response.json()) as {
    customToken?: unknown
    applicationId?: unknown
    purpose?: unknown
    step?: unknown
  }
  if (typeof body.customToken !== "string" || typeof body.applicationId !== "string") {
    throw new CandidateSessionError("session-failed", "This link cannot be opened.")
  }

  try {
    // Candidate credentials are only needed while this link is open. Keeping
    // them in memory also prevents an old candidate session from being reused
    // if this device later opens the internal dashboard.
    await setPersistence(candidateAuth, inMemoryPersistence)
    await signInWithCustomToken(candidateAuth, body.customToken)
  } catch {
    throw new CandidateSessionError("sign-in-failed", "We couldn't start your session. Please try the link again.")
  }

  return {
    applicationId: body.applicationId,
    purpose: (body.purpose as LinkPurpose) ?? "application",
    step: (body.step as ApplicationSectionId | null) ?? null,
  }
}

/**
 * Send the drawn signature to the server, which seals the PDF, stores the
 * evidence and flips `agreement.status` to signed. The candidate can never
 * write that status directly — the rules forbid it.
 */
export async function signCandidateAgreement(input: {
  signatureDataUrl: string
  typedName: string
  consent: boolean
}): Promise<void> {
  const authorization = await candidateAuthHeader()
  let response: Response
  try {
    response = await fetch("/api/applications/agreement/sign", {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(input),
    })
  } catch {
    throw new CandidateSessionError("network", "We couldn't reach SVC. Check your connection and try again.")
  }

  if (!response.ok) {
    let message = "We couldn't record your signature."
    let code = "sign-failed"
    try {
      const body = (await response.json()) as { error?: unknown; code?: unknown }
      if (typeof body.error === "string" && body.error) message = body.error
      if (typeof body.code === "string" && body.code) code = body.code
    } catch {
      // keep defaults
    }
    throw new CandidateSessionError(code, message)
  }
}
