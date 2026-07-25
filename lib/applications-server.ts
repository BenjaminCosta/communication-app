import "server-only"

/**
 * SVC Applications — server side (Admin SDK).
 *
 * The candidate session is the app's one pre-auth surface: a link token is
 * exchanged for a Firebase custom token carrying an `applicationId` claim,
 * which is what the security rules use to scope the candidate to their own
 * application. Everything sensitive happens here, never in the browser.
 *
 * Reuses the same lazily-initialized Admin app as the AI routes.
 */

import { createHash } from "node:crypto"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import {
  OPERATING_AGREEMENT_TEMPLATE,
  candidateUid,
  resolveLink,
  type AgreementTemplate,
  type ApplicationLink,
  type ApplicationSectionId,
  type LinkPurpose,
} from "@/lib/applications-core"
import {
  APPLICATIONS_COLLECTION,
  APPLICATION_LINKS_COLLECTION,
  mapLinkDoc,
} from "@/lib/applications-store"
import { sealAgreementPdf } from "@/features/applications/agreement-pdf"

const STORAGE_BUCKET = "svc-comms.firebasestorage.app"

export class ApplicationSessionError extends Error {
  readonly code: string
  readonly httpStatus: number
  constructor(code: string, message: string, httpStatus = 400) {
    super(message)
    this.name = "ApplicationSessionError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface CandidateSession {
  customToken: string
  applicationId: string
  purpose: LinkPurpose
  step: ApplicationSectionId | null
}

async function adminFirestore() {
  const { getFirestore } = await import("firebase-admin/firestore")
  return getFirestore(await getFirebaseAdminApp())
}

async function adminAuth() {
  const { getAuth } = await import("firebase-admin/auth")
  return getAuth(await getFirebaseAdminApp())
}

/** Reads the link record for a raw token. */
async function loadLink(token: string): Promise<ApplicationLink | null> {
  const db = await adminFirestore()
  // Production hashes the token at rest; the lookup key changes here only.
  const snapshot = await db.collection(APPLICATION_LINKS_COLLECTION).doc(token).get()
  return snapshot.exists ? mapLinkDoc(snapshot.id, snapshot.data() ?? {}) : null
}

/**
 * Exchange a link token for a candidate session.
 *
 * Fails closed on every invalid state and never reveals whether a token simply
 * doesn't exist versus was revoked in a way an attacker could enumerate — the
 * caller maps all reasons to the same "ask for a new link" message.
 */
export async function createCandidateSession(rawToken: string): Promise<CandidateSession> {
  const token = rawToken.trim()
  if (!token || token.length > 128) {
    throw new ApplicationSessionError("invalid-token", "This link is not valid.", 400)
  }

  const resolution = resolveLink(await loadLink(token))
  if (!resolution.ok) {
    throw new ApplicationSessionError(resolution.reason, "This link cannot be opened.", 403)
  }
  const link = resolution.link

  // The application must still exist — a dangling link is dead.
  const db = await adminFirestore()
  const applicationSnapshot = await db.collection(APPLICATIONS_COLLECTION).doc(link.applicationId).get()
  if (!applicationSnapshot.exists) {
    throw new ApplicationSessionError("not_found", "This link cannot be opened.", 403)
  }

  const uid = candidateUid(link.applicationId)
  const auth = await adminAuth()
  // The claim is the entire authorization story for the candidate: the rules
  // read request.auth.token.applicationId and nothing else.
  const customToken = await auth.createCustomToken(uid, { applicationId: link.applicationId })

  // Best-effort usage counter; never blocks issuing the session.
  db.collection(APPLICATION_LINKS_COLLECTION)
    .doc(token)
    .update({ usedCount: (link.usedCount ?? 0) + 1, lastUsedAt: new Date() })
    .catch(() => {})

  return { customToken, applicationId: link.applicationId, purpose: link.purpose, step: link.step }
}

// ── Signing ─────────────────────────────────────────────────────────────

export interface CandidatePrincipal {
  uid: string
  applicationId: string
}

/**
 * Verifies the candidate's Firebase ID token and returns the application they
 * are scoped to. The `applicationId` custom claim is the whole authorization
 * story — no claim means "not a candidate session".
 */
export async function verifyCandidateRequest(request: Request): Promise<CandidatePrincipal> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApplicationSessionError("unauthenticated", "Your session ended. Please reopen the link.", 401)

  const auth = await adminAuth()
  let decoded
  try {
    decoded = await auth.verifyIdToken(match[1].trim())
  } catch {
    throw new ApplicationSessionError("unauthenticated", "Your session ended. Please reopen the link.", 401)
  }
  const applicationId = typeof decoded.applicationId === "string" ? decoded.applicationId : ""
  if (!applicationId) {
    throw new ApplicationSessionError("forbidden", "This action isn't available for your session.", 403)
  }
  return { uid: decoded.uid, applicationId }
}

/** Deterministic hash of the exact text the candidate agreed to. */
function agreementBodyHash(template: AgreementTemplate): string {
  const canonical = JSON.stringify({
    id: template.id,
    version: template.version,
    title: template.title,
    intro: template.intro,
    sections: template.sections,
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export interface SignAgreementInput {
  applicationId: string
  signatureDataUrl: string
  typedName: string
  consent: boolean
}

/** Which statuses may still be signed. */
const SIGNABLE_STATUSES = new Set(["approved", "agreement_pending"])

/**
 * Seal the agreement server-side: render the accepted text + drawn signature
 * into a PDF, store it and the evidence, and flip `agreement.status` with the
 * Admin SDK (the candidate can never write that field themselves).
 */
export async function signAgreement(input: SignAgreementInput): Promise<{ signedAt: string }> {
  if (!input.consent) throw new ApplicationSessionError("consent-required", "Consent is required to sign.", 400)
  const typedName = input.typedName.trim()
  if (!typedName) throw new ApplicationSessionError("name-required", "A signed name is required.", 400)

  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signatureDataUrl)
  if (!match) throw new ApplicationSessionError("invalid-signature", "The signature image is invalid.", 400)
  const signaturePng = new Uint8Array(Buffer.from(match[1], "base64"))
  if (signaturePng.byteLength === 0 || signaturePng.byteLength > 2 * 1024 * 1024) {
    throw new ApplicationSessionError("invalid-signature", "The signature image is invalid.", 400)
  }

  const db = await adminFirestore()
  const applicationRef = db.collection(APPLICATIONS_COLLECTION).doc(input.applicationId)
  const snapshot = await applicationRef.get()
  if (!snapshot.exists) throw new ApplicationSessionError("not_found", "This application no longer exists.", 404)

  const data = snapshot.data() ?? {}
  const agreement = (data.agreement ?? {}) as { status?: unknown }
  if (agreement.status === "signed") {
    throw new ApplicationSessionError("already-signed", "This agreement is already signed.", 409)
  }
  if (!SIGNABLE_STATUSES.has(String(data.status))) {
    throw new ApplicationSessionError("not-signable", "This agreement can't be signed yet.", 409)
  }

  const template = OPERATING_AGREEMENT_TEMPLATE
  const candidateName = typeof data.candidateName === "string" && data.candidateName ? data.candidateName : typedName
  const jobName = typeof data.jobName === "string" ? data.jobName : ""

  const { Timestamp, FieldValue } = await import("firebase-admin/firestore")
  const signedAtDate = new Date()
  const signedAtIso = signedAtDate.toISOString()

  const pdfBytes = await sealAgreementPdf({
    template,
    candidateName,
    jobName,
    typedName,
    signedAtIso,
    signaturePng,
  })

  // Store the sealed PDF (server-only path).
  const { getStorage } = await import("firebase-admin/storage")
  const bucket = getStorage(await getFirebaseAdminApp()).bucket(STORAGE_BUCKET)
  const pdfPath = `application-agreements/${input.applicationId}/${template.id}-v${template.version}-${Date.now()}.pdf`
  await bucket.file(pdfPath).save(Buffer.from(pdfBytes), {
    contentType: "application/pdf",
    metadata: { cacheControl: "private, max-age=0" },
  })

  const bodyHash = agreementBodyHash(template)
  const signedPdfHash = sha256(pdfBytes)

  const agreementRef = db.collection("applicationAgreements").doc()
  await db.runTransaction(async (tx) => {
    tx.set(agreementRef, {
      applicationId: input.applicationId,
      templateId: template.id,
      version: template.version,
      bodyHash,
      typedName,
      consentAt: Timestamp.fromDate(signedAtDate),
      signedAt: Timestamp.fromDate(signedAtDate),
      signedPdfPath: pdfPath,
      signedPdfHash,
    })
    tx.update(applicationRef, {
      status: "payroll_in_progress",
      "agreement.status": "signed",
      "agreement.signedAt": Timestamp.fromDate(signedAtDate),
      "agreement.signedVersion": template.version,
      "agreement.signedName": typedName,
      agreementId: agreementRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    })
    const activityRef = applicationRef.collection("activity").doc()
    tx.set(activityRef, {
      kind: "note",
      actor: "Candidate",
      actorUid: candidateUid(input.applicationId),
      message: `Signed the operating agreement (v${template.version})`,
      at: Timestamp.fromDate(signedAtDate),
    })
  })

  return { signedAt: signedAtIso }
}
