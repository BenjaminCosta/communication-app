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

import { createHash, randomBytes } from "node:crypto"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import {
  OPERATING_AGREEMENT_TEMPLATE,
  candidateUid,
  nameMatches,
  resolveLink,
  type AgreementTemplate,
  type ApplicationLink,
  type ApplicationSectionId,
  type LinkPurpose,
} from "@/lib/applications-core"
import {
  APPLICATION_ACTIVITY_SUBCOLLECTION,
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
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const snapshot = await db.collection(APPLICATION_LINKS_COLLECTION).doc(tokenHash).get()
  return snapshot.exists ? { ...mapLinkDoc(snapshot.id, snapshot.data() ?? {}), token } : null
}

/** Resolve a stored digest for an already-authenticated candidate request. */
async function loadLinkByHash(tokenHash: string): Promise<ApplicationLink | null> {
  const db = await adminFirestore()
  const snapshot = await db.collection(APPLICATION_LINKS_COLLECTION).doc(tokenHash).get()
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
  const tokenHash = createHash("sha256").update(token).digest("hex")
  // Rules verify this digest against /applicationLinks on every candidate
  // read/write. A link that expires or is revoked therefore also invalidates
  // an already-opened candidate session.
  const customToken = await auth.createCustomToken(uid, {
    applicationId: link.applicationId,
    applicationLinkHash: tokenHash,
  })

  // Best-effort usage counter; never blocks issuing the session.
  db.collection(APPLICATION_LINKS_COLLECTION)
    .doc(tokenHash)
    .update({ usedCount: (link.usedCount ?? 0) + 1, lastUsedAt: new Date() })
    .catch(() => {})

  // The link is the credential, so recording its successful opening gives
  // reviewers useful visibility without exposing tokens anywhere in Firestore.
  db.collection(APPLICATIONS_COLLECTION)
    .doc(link.applicationId)
    .collection(APPLICATION_ACTIVITY_SUBCOLLECTION)
    .add({
      kind: "link_opened",
      actor: "Candidate",
      actorUid: uid,
      message:
        link.purpose === "agreement"
          ? "Opened the operating agreement link"
          : link.purpose === "step"
            ? "Opened a direct application link"
            : "Opened the application link",
      at: new Date(),
    })
    .catch(() => {})

  return { customToken, applicationId: link.applicationId, purpose: link.purpose, step: link.step }
}

// ── Signing ─────────────────────────────────────────────────────────────

export interface CandidatePrincipal {
  uid: string
  applicationId: string
  linkHash: string
}

export interface StaffPrincipal {
  uid: string
  name: string
}

/**
 * Verifies the candidate's Firebase ID token and returns the application they
 * are scoped to. The link digest is checked again by the protected operation,
 * so revoking or expiring a link also terminates sessions minted from it.
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
  const linkHash = typeof decoded.applicationLinkHash === "string" ? decoded.applicationLinkHash : ""
  if (!applicationId || !/^[a-f0-9]{64}$/.test(linkHash)) {
    throw new ApplicationSessionError("forbidden", "This action isn't available for your session.", 403)
  }
  return { uid: decoded.uid, applicationId, linkHash }
}

/** Verify a normal staff token. Candidate custom tokens never pass this gate. */
export async function verifyStaffRequest(request: Request, requestedName = ""): Promise<StaffPrincipal> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new ApplicationSessionError("unauthenticated", "Please sign in again.", 401)

  const auth = await adminAuth()
  let decoded
  try {
    decoded = await auth.verifyIdToken(match[1].trim())
  } catch {
    throw new ApplicationSessionError("unauthenticated", "Please sign in again.", 401)
  }
  if (typeof decoded.applicationId === "string" && decoded.applicationId) {
    throw new ApplicationSessionError("forbidden", "This action isn't available for this session.", 403)
  }

  const supplied = requestedName.trim().slice(0, 120)
  const tokenName = typeof decoded.name === "string" ? decoded.name.trim() : ""
  const tokenEmail = typeof decoded.email === "string" ? decoded.email.trim() : ""
  return { uid: decoded.uid, name: tokenName || supplied || tokenEmail || "SVC reviewer" }
}

const APPROVABLE_STATUSES = new Set(["submitted", "ready_for_review", "needs_information"])
const REQUESTABLE_STATUSES = new Set(["draft", "submitted", "needs_information", "ready_for_review", "approved", "agreement_pending"])

export type ReviewerApplicationAction = "request_info" | "archive" | "mark_hired" | "start_review"

/**
 * The raw link token only exists in this process and in the response that the
 * reviewer immediately shares. Firestore receives its SHA-256 digest as the
 * document id, never a replayable bearer credential.
 */
function createAgreementSigningLink(applicationId: string, now: Date): ApplicationLink {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + 3 * 86_400_000)
  return {
    token,
    applicationId,
    purpose: "agreement",
    step: null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    usedCount: 0,
  }
}

function agreementLinkData(link: ApplicationLink, Timestamp: { fromDate(value: Date): unknown }) {
  return {
    applicationId: link.applicationId,
    purpose: "agreement",
    step: null,
    createdAt: Timestamp.fromDate(new Date(link.createdAt)),
    expiresAt: Timestamp.fromDate(new Date(link.expiresAt)),
    revokedAt: null,
    usedCount: 0,
  }
}

async function issueAgreementSigningLink(
  applicationId: string,
  reviewer: StaffPrincipal,
  approve = false,
): Promise<{ approvedAt: string | null; link: ApplicationLink }> {
  const id = applicationId.trim()
  if (!id || id.length > 160) throw new ApplicationSessionError("invalid-request", "Invalid application.", 400)

  const db = await adminFirestore()
  const applicationRef = db.collection(APPLICATIONS_COLLECTION).doc(id)
  const { FieldValue, Timestamp } = await import("firebase-admin/firestore")
  const now = new Date()
  const link = createAgreementSigningLink(id, now)
  const linkHash = createHash("sha256").update(link.token).digest("hex")
  const linkRef = db.collection(APPLICATION_LINKS_COLLECTION).doc(linkHash)

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(applicationRef)
    if (!snapshot.exists) throw new ApplicationSessionError("not_found", "This application no longer exists.", 404)
    const currentStatus = String((snapshot.data() ?? {}).status ?? "")
    const currentAgreement = ((snapshot.data() ?? {}).agreement ?? {}) as { status?: unknown }

    if (approve) {
      if (!APPROVABLE_STATUSES.has(currentStatus)) {
        throw new ApplicationSessionError("not-approvable", "This application can no longer be approved.", 409)
      }
    } else {
      if (!SIGNABLE_STATUSES.has(currentStatus) || currentAgreement.status === "signed") {
        throw new ApplicationSessionError("not-linkable", "A new agreement link can't be sent at this stage.", 409)
      }
    }

    tx.update(applicationRef, {
      ...(approve ? { status: "approved", pendingRequest: null } : {}),
      "agreement.status": "awaiting_signature",
      "agreement.sentAt": Timestamp.fromDate(now),
      "agreement.expiresAt": Timestamp.fromDate(new Date(link.expiresAt)),
      updatedAt: FieldValue.serverTimestamp(),
    })
    tx.create(linkRef, agreementLinkData(link, Timestamp))
    if (approve) {
      tx.set(applicationRef.collection(APPLICATION_ACTIVITY_SUBCOLLECTION).doc(), {
        kind: "approved",
        actor: reviewer.name,
        actorUid: reviewer.uid,
        message: "Approved the application and unlocked the operating agreement",
        at: Timestamp.fromDate(now),
      })
    }
    tx.set(applicationRef.collection(APPLICATION_ACTIVITY_SUBCOLLECTION).doc(), {
      kind: "link_generated",
      actor: reviewer.name,
      actorUid: reviewer.uid,
      message: "Generated a secure operating agreement link",
      at: Timestamp.fromDate(now),
    })
  })

  return { approvedAt: approve ? now.toISOString() : null, link }
}

/**
 * Atomically approve an application, unlock its operating agreement, and
 * create the three-day signing link. There is no approved-without-a-link
 * intermediate state for a reviewer to clean up.
 */
export async function approveApplicationAndUnlockAgreement(
  applicationId: string,
  reviewer: StaffPrincipal,
): Promise<{ approvedAt: string; link: ApplicationLink }> {
  const result = await issueAgreementSigningLink(applicationId, reviewer, true)
  if (!result.approvedAt) throw new ApplicationSessionError("approve-failed", "The approval response was incomplete.", 500)
  return { approvedAt: result.approvedAt, link: result.link }
}

/** Issue a fresh three-day agreement link without moving the candidate's status. */
export async function resendAgreementSigningLink(applicationId: string, reviewer: StaffPrincipal): Promise<ApplicationLink> {
  const result = await issueAgreementSigningLink(applicationId, reviewer)
  return result.link
}

/**
 * Reviewer status changes are server-side transactions. Keeping the state and
 * its activity event together means a browser cannot silently move a candidate
 * through the pipeline without leaving an auditable record.
 */
export async function applyReviewerApplicationAction(
  applicationId: string,
  action: ReviewerApplicationAction,
  reviewer: StaffPrincipal,
  message = "",
): Promise<void> {
  const id = applicationId.trim()
  if (!id || id.length > 160) throw new ApplicationSessionError("invalid-request", "Invalid application.", 400)

  const trimmedMessage = message.trim()
  if (action === "request_info" && !trimmedMessage) {
    throw new ApplicationSessionError("message-required", "A request needs a message.", 400)
  }

  const db = await adminFirestore()
  const applicationRef = db.collection(APPLICATIONS_COLLECTION).doc(id)
  const { FieldValue } = await import("firebase-admin/firestore")

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(applicationRef)
    if (!snapshot.exists) throw new ApplicationSessionError("not_found", "This application no longer exists.", 404)
    const currentStatus = String((snapshot.data() ?? {}).status ?? "")

    let patch: Record<string, unknown>
    let event: { kind: string; message: string }
    switch (action) {
      case "request_info":
        if (!REQUESTABLE_STATUSES.has(currentStatus)) {
          throw new ApplicationSessionError("not-requestable", "Information can't be requested at this stage.", 409)
        }
        patch = { status: "needs_information", pendingRequest: trimmedMessage }
        event = { kind: "info_requested", message: trimmedMessage }
        break
      case "archive":
        if (currentStatus === "archived") {
          throw new ApplicationSessionError("already-archived", "This application is already archived.", 409)
        }
        patch = { status: "archived" }
        event = { kind: "archived", message: "Archived the application" }
        break
      case "mark_hired":
        if (currentStatus !== "payroll_in_progress") {
          throw new ApplicationSessionError("not-hireable", "Complete the signed agreement and payroll step first.", 409)
        }
        patch = { status: "hired" }
        event = { kind: "hired", message: "Completed payroll setup and marked the candidate as hired" }
        break
      case "start_review":
        if (currentStatus !== "submitted") {
          throw new ApplicationSessionError("not-reviewable", "This application is not ready to start review.", 409)
        }
        patch = { status: "ready_for_review" }
        event = { kind: "note", message: "Moved to review" }
        break
      default:
        throw new ApplicationSessionError("invalid-request", "Invalid application action.", 400)
    }

    tx.update(applicationRef, { ...patch, updatedAt: FieldValue.serverTimestamp() })
    tx.set(applicationRef.collection(APPLICATION_ACTIVITY_SUBCOLLECTION).doc(), {
      kind: event.kind,
      actor: reviewer.name,
      actorUid: reviewer.uid,
      message: event.message,
      at: FieldValue.serverTimestamp(),
    })
  })
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

function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const parsed = value.toDate()
    return parsed instanceof Date ? parsed : null
  }
  return null
}

function agreementSigningExpired(agreement: { expiresAt?: unknown }, now = new Date()): boolean {
  const expiresAt = dateFromUnknown(agreement.expiresAt)
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime())
}

export interface SignAgreementInput {
  applicationId: string
  linkHash: string
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
  const linkRef = db.collection(APPLICATION_LINKS_COLLECTION).doc(input.linkHash)
  const snapshot = await applicationRef.get()
  if (!snapshot.exists) throw new ApplicationSessionError("not_found", "This application no longer exists.", 404)

  const data = snapshot.data() ?? {}
  const agreement = (data.agreement ?? {}) as { status?: unknown; expiresAt?: unknown }
  if (agreement.status === "signed") {
    throw new ApplicationSessionError("already-signed", "This agreement is already signed.", 409)
  }
  if (agreementSigningExpired(agreement)) {
    throw new ApplicationSessionError("agreement-expired", "This signing window has expired. Ask SVC for a new link.", 403)
  }
  if (!SIGNABLE_STATUSES.has(String(data.status))) {
    throw new ApplicationSessionError("not-signable", "This agreement can't be signed yet.", 409)
  }

  const activeLink = resolveLink(await loadLinkByHash(input.linkHash))
  if (!activeLink.ok || activeLink.link.applicationId !== input.applicationId || activeLink.link.purpose !== "agreement") {
    throw new ApplicationSessionError("link-inactive", "This signing link is no longer active. Ask SVC for a new one.", 403)
  }

  const template = OPERATING_AGREEMENT_TEMPLATE
  const candidateName = typeof data.candidateName === "string" && data.candidateName ? data.candidateName : typedName
  const general = (data.general ?? {}) as { fullName?: unknown }
  const expectedName = typeof general.fullName === "string" && general.fullName.trim() ? general.fullName : candidateName
  if (!nameMatches(typedName, expectedName)) {
    throw new ApplicationSessionError("name-mismatch", "Type your full name exactly as it appears in your application.", 400)
  }
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
  try {
    await db.runTransaction(async (tx) => {
      // Re-read both records inside the transaction. This is the final gate
      // against a concurrent second signature or a link revoked mid-request.
      const [currentApplication, currentLink] = await Promise.all([tx.get(applicationRef), tx.get(linkRef)])
      if (!currentApplication.exists) {
        throw new ApplicationSessionError("not_found", "This application no longer exists.", 404)
      }
      const currentData = currentApplication.data() ?? {}
      const currentAgreement = (currentData.agreement ?? {}) as { status?: unknown; expiresAt?: unknown }
      if (currentAgreement.status === "signed") {
        throw new ApplicationSessionError("already-signed", "This agreement is already signed.", 409)
      }
      if (agreementSigningExpired(currentAgreement, signedAtDate)) {
        throw new ApplicationSessionError("agreement-expired", "This signing window has expired. Ask SVC for a new link.", 403)
      }
      if (!SIGNABLE_STATUSES.has(String(currentData.status))) {
        throw new ApplicationSessionError("not-signable", "This agreement can't be signed yet.", 409)
      }
      if (!currentLink.exists) {
        throw new ApplicationSessionError("link-inactive", "This signing link is no longer active. Ask SVC for a new one.", 403)
      }
      const currentLinkState = resolveLink(mapLinkDoc(currentLink.id, currentLink.data() ?? {}))
      if (
        !currentLinkState.ok ||
        currentLinkState.link.applicationId !== input.applicationId ||
        currentLinkState.link.purpose !== "agreement"
      ) {
        throw new ApplicationSessionError("link-inactive", "This signing link is no longer active. Ask SVC for a new one.", 403)
      }

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
        kind: "agreement_signed",
        actor: "Candidate",
        actorUid: candidateUid(input.applicationId),
        message: `Signed the operating agreement (v${template.version})`,
        at: Timestamp.fromDate(signedAtDate),
      })
    })
  } catch (error) {
    // The PDF is uploaded before the transaction so its SHA-256 can be stored
    // atomically with the evidence. If the final gate fails, remove that
    // unreferenced artifact instead of retaining sensitive data.
    await bucket.file(pdfPath).delete({ ignoreNotFound: true }).catch(() => {})
    throw error
  }

  return { signedAt: signedAtIso }
}
