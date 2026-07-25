"use client"

/**
 * SVC Applications — reads and writes (client side).
 *
 * ARCHITECTURE RULES
 *  - Reviewer actions never touch `agreement.status`. Unlocking, signing and
 *    expiring the agreement are server-side concerns, because that state is
 *    what gates payroll.
 *  - Every reviewer action appends an activity event with `actorUid`. There
 *    are no roles in this module, so the activity log IS the audit trail.
 *  - `progressPercent` / `missingCount` are derived by a Cloud Function; this
 *    module never writes them.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { subscribeWithServerReconcile } from "@/lib/firestore-reconcile"
import {
  APPLICATIONS_COLLECTION,
  APPLICATION_ACTIVITY_SUBCOLLECTION,
  APPLICATION_LINKS_COLLECTION,
  applicationToFirestore,
  linkToFirestore,
  mapActivityDoc,
  mapApplicationDoc,
  mapLinkDoc,
  toTimestamp,
} from "@/lib/applications-store"
import { candidateUid } from "@/lib/applications-core"
import type {
  ActivityEvent,
  ActivityKind,
  ApplicationLink,
  CandidateApplication,
  GeneralApplication,
  IntroVideo,
  RequiredDocument,
} from "@/lib/applications-core"

export class ApplicationWriteError extends Error {}

const APPLICATIONS_PAGE_SIZE = 200
const ACTIVITY_PAGE_SIZE = 50

export interface ReviewerIdentity {
  uid: string
  name: string
}

// ── Reads ───────────────────────────────────────────────────────────────

/**
 * The dashboard list. Ordered by `updatedAt` so anything that just moved is
 * on top regardless of status; the client re-sorts for the other options.
 */
export function subscribeApplications(
  onChange: (applications: CandidateApplication[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const applicationsQuery = query(
    collection(db, APPLICATIONS_COLLECTION),
    orderBy("updatedAt", "desc"),
    limit(APPLICATIONS_PAGE_SIZE),
  )
  return subscribeWithServerReconcile(
    applicationsQuery,
    (snapshot) => onChange(snapshot.docs.map((entry) => mapApplicationDoc(entry.id, entry.data()))),
    (error) => onError?.(error),
  )
}

/** Activity is a subcollection, so the detail screen subscribes separately. */
export function subscribeApplicationActivity(
  applicationId: string,
  onChange: (events: ActivityEvent[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const activityQuery = query(
    collection(db, APPLICATIONS_COLLECTION, applicationId, APPLICATION_ACTIVITY_SUBCOLLECTION),
    orderBy("at", "desc"),
    limit(ACTIVITY_PAGE_SIZE),
  )
  return onSnapshot(
    activityQuery,
    (snapshot) => {
      // Stored newest-first for the query; the UI reads oldest-first.
      const events = snapshot.docs.map((entry) => mapActivityDoc(entry.id, entry.data()))
      onChange(events.reverse())
    },
    (error) => onError?.(error),
  )
}

export async function loadApplication(applicationId: string): Promise<CandidateApplication | null> {
  const snapshot = await getDoc(doc(db, APPLICATIONS_COLLECTION, applicationId))
  return snapshot.exists() ? mapApplicationDoc(snapshot.id, snapshot.data()) : null
}

/** One application, live — used by the candidate flow after it signs in. */
export function subscribeApplication(
  applicationId: string,
  onChange: (application: CandidateApplication | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, APPLICATIONS_COLLECTION, applicationId),
    (snapshot) => onChange(snapshot.exists() ? mapApplicationDoc(snapshot.id, snapshot.data()) : null),
    (error) => onError?.(error),
  )
}

// ── Candidate writes ────────────────────────────────────────────────────

/**
 * The candidate's autosave. Writes only the fields the rules let a candidate
 * touch; the mappers convert ISO/Date back to Timestamps. Video and document
 * FILE bytes are not uploaded yet (Storage is a later phase) — only the
 * metadata the candidate has entered is persisted.
 */
export async function saveCandidateDraft(
  applicationId: string,
  draft: { general: GeneralApplication; video: IntroVideo; documents: RequiredDocument[] },
): Promise<void> {
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    general: { ...draft.general },
    video: { ...draft.video, capturedAt: toTimestamp(draft.video.capturedAt) },
    documents: draft.documents.map((document) => ({
      ...document,
      uploadedAt: toTimestamp(document.uploadedAt),
    })),
    updatedAt: serverTimestamp(),
  })
}

export async function submitCandidateApplication(
  applicationId: string,
  candidateName: string,
): Promise<void> {
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    status: "submitted",
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  // A candidate may write their own activity (rules allow it for the session).
  await addDoc(collection(db, APPLICATIONS_COLLECTION, applicationId, APPLICATION_ACTIVITY_SUBCOLLECTION), {
    kind: "submitted",
    actor: candidateName || "Candidate",
    actorUid: candidateUid(applicationId),
    message: "Submitted the application",
    at: serverTimestamp(),
  })
}

// ── Activity ────────────────────────────────────────────────────────────

async function appendActivity(
  applicationId: string,
  input: { kind: ActivityKind; actor: string; actorUid: string; message: string },
): Promise<void> {
  await addDoc(collection(db, APPLICATIONS_COLLECTION, applicationId, APPLICATION_ACTIVITY_SUBCOLLECTION), {
    kind: input.kind,
    actor: input.actor,
    actorUid: input.actorUid,
    message: input.message,
    at: serverTimestamp(),
  })
}

// ── Reviewer actions ────────────────────────────────────────────────────

/**
 * Ask the candidate for something. Sets the status and the outstanding
 * question in one update so the list and the detail can never disagree.
 */
export async function requestApplicationInfo(
  applicationId: string,
  message: string,
  reviewer: ReviewerIdentity,
): Promise<void> {
  const trimmed = message.trim()
  if (!trimmed) throw new ApplicationWriteError("A request needs a message.")
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    status: "needs_information",
    pendingRequest: trimmed,
    updatedAt: serverTimestamp(),
  })
  await appendActivity(applicationId, {
    kind: "info_requested",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: trimmed,
  })
}

/**
 * Approve. Note what is NOT here: the agreement stays untouched. A Cloud
 * Function reacts to `approved` and unlocks it, so a client can never put a
 * candidate straight into a signable state.
 */
export async function approveApplication(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    status: "approved",
    pendingRequest: null,
    updatedAt: serverTimestamp(),
  })
  await appendActivity(applicationId, {
    kind: "approved",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: "Approved the application",
  })
}

export async function archiveApplication(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    status: "archived",
    updatedAt: serverTimestamp(),
  })
  await appendActivity(applicationId, {
    kind: "archived",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: "Archived the application",
  })
}

export async function startApplicationReview(applicationId: string, reviewer: ReviewerIdentity): Promise<void> {
  await updateDoc(doc(db, APPLICATIONS_COLLECTION, applicationId), {
    status: "ready_for_review",
    updatedAt: serverTimestamp(),
  })
  await appendActivity(applicationId, {
    kind: "note",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: "Moved to review",
  })
}

// ── Creation ────────────────────────────────────────────────────────────

export async function createApplication(
  application: CandidateApplication,
  reviewer: ReviewerIdentity,
): Promise<void> {
  await setDoc(doc(db, APPLICATIONS_COLLECTION, application.id), {
    ...applicationToFirestore(application),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await appendActivity(application.id, {
    kind: "created",
    actor: reviewer.name,
    actorUid: reviewer.uid,
    message: "Created the application link",
  })
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * Links are stored under their token today. The production version hashes it
 * (`/applicationLinks/{tokenHash}`) so a database reader can't replay one —
 * `linkToFirestore` is the only place that changes when we do.
 */
export async function saveApplicationLink(link: ApplicationLink): Promise<void> {
  await setDoc(doc(db, APPLICATION_LINKS_COLLECTION, link.token), linkToFirestore(link))
}

export async function revokeApplicationLinkDoc(token: string): Promise<void> {
  await updateDoc(doc(db, APPLICATION_LINKS_COLLECTION, token), { revokedAt: serverTimestamp() })
}

export async function loadApplicationLink(token: string): Promise<ApplicationLink | null> {
  const snapshot = await getDoc(doc(db, APPLICATION_LINKS_COLLECTION, token))
  return snapshot.exists() ? mapLinkDoc(snapshot.id, snapshot.data()) : null
}
