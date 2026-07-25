/**
 * Mock applications for the UI-only phase.
 *
 * Job shapes mirror DirectoryJob (name / location / companyName) so swapping
 * this module for the real /directoryIndex query is a data change, not a
 * component change.
 */

import {
  createApplicationLink,
  emptyGeneralApplication,
  emptyIntroVideo,
  standardDocuments,
  type ApplicationLink,
  type ApplicationSectionId,
  type CandidateApplication,
  type LinkedJob,
  type LinkPurpose,
  type RequiredDocument,
} from "@/lib/applications-core"

export const MOCK_JOBS: LinkedJob[] = [
  { id: "job-rw-dake", name: "RW Dake Construction", location: "Morrow, GA", companyName: "RW Dake Construction" },
  { id: "job-lakeview", name: "Lakeview Build", location: "Atlanta, GA", companyName: "Lakeview Partners" },
  { id: "job-pine-ridge", name: "Pine Ridge Utilities", location: "Covington, GA", companyName: "Pine Ridge Utilities" },
]

function jobById(id: string): LinkedJob {
  return MOCK_JOBS.find((job) => job.id === id) ?? MOCK_JOBS[0]
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(9, 30, 0, 0)
  return date.toISOString()
}

function documents(overrides: Partial<Record<string, Partial<RequiredDocument>>>, extra: RequiredDocument[] = []): RequiredDocument[] {
  return [
    ...standardDocuments().map((document) => ({ ...document, ...(overrides[document.id] ?? {}) })),
    ...extra,
  ]
}

function jobDocument(id: string, label: string, helper: string, status: RequiredDocument["status"] = "missing"): RequiredDocument {
  return {
    id,
    label,
    helper,
    required: true,
    status,
    fileName: status === "missing" ? null : `${id}.pdf`,
    uploadedAt: status === "missing" ? null : daysAgo(2),
    storagePath: null,
    downloadUrl: null,
    origin: "job",
  }
}

function optionalJobDocument(id: string, label: string, helper: string): RequiredDocument {
  return {
    id,
    label,
    helper,
    required: false,
    status: "not_required",
    fileName: null,
    uploadedAt: null,
    storagePath: null,
    downloadUrl: null,
    origin: "job",
  }
}

export const MOCK_APPLICATIONS: CandidateApplication[] = [
  {
    id: "app-benjamin-lopez",
    linkToken: "demo",
    candidateName: "Benjamin Lopez",
    trade: "Carpenter",
    job: jobById("job-rw-dake"),
    status: "submitted",
    general: {
      fullName: "Benjamin Lopez",
      phone: "(770) 555-0142",
      email: "benjamin.lopez@email.com",
      cityState: "Morrow, GA",
      yearsExperience: "6",
      primaryTrade: "Carpenter",
      resumeFileName: "benjamin-lopez-resume.pdf",
      workReference: "Dale Whitman — Whitman Framing",
    },
    video: {
      state: "ready",
      source: "record",
      fileName: "intro-benjamin.mp4",
      durationSeconds: 78,
      capturedAt: daysAgo(3),
      storagePath: null,
      downloadUrl: null,
      transcript:
        "Hi, I’m Benjamin Lopez. I’m based in Morrow and have worked as a carpenter for six years. Most of my recent work has been residential framing, concrete formwork, and commercial build-outs. I take safety seriously and I’m ready to start on the RW Dake project.",
      summary:
        "Benjamin is a carpenter from Morrow with six years of residential and commercial experience. He highlights framing, concrete formwork, and job-site safety as his strengths.",
    },
    documents: documents(
      {
        "drivers-license": { status: "verified", fileName: "license-front.jpg", uploadedAt: daysAgo(3) },
        "osha-card": { status: "uploaded", fileName: "osha-10.jpg", uploadedAt: daysAgo(3) },
      },
      [optionalJobDocument("project-document", "Project document", "Not required for this job.")],
    ),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [
      { id: "a1", kind: "created", actor: "Candidate", message: "Opened the application link", at: daysAgo(4) },
      { id: "a2", kind: "submitted", actor: "Candidate", message: "Submitted the application", at: daysAgo(3) },
    ],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
    submittedAt: daysAgo(3),
    pendingRequest: null,
  },
  {
    id: "app-marcus-johnson",
    linkToken: "marcus",
    candidateName: "Marcus Johnson",
    trade: "Concrete finisher",
    job: jobById("job-lakeview"),
    status: "needs_information",
    general: {
      fullName: "Marcus Johnson",
      phone: "(404) 555-0177",
      email: "marcus.johnson@email.com",
      cityState: "Atlanta, GA",
      yearsExperience: "11",
      primaryTrade: "Concrete finisher",
      resumeFileName: "",
      workReference: "Ivy Contreras — Ridge Concrete",
    },
    video: {
      state: "ready",
      source: "upload",
      fileName: "marcus-intro.mov",
      durationSeconds: 64,
      capturedAt: daysAgo(6),
      storagePath: null,
      downloadUrl: null,
summary: null,
    },
    documents: documents({
      "osha-card": { status: "verified", fileName: "osha-card.jpg", uploadedAt: daysAgo(6) },
    }),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [
      { id: "b1", kind: "created", actor: "Candidate", message: "Opened the application link", at: daysAgo(8) },
      { id: "b2", kind: "submitted", actor: "Candidate", message: "Submitted the application", at: daysAgo(6) },
      {
        id: "b3",
        kind: "info_requested",
        actor: "Sofia Ramirez",
        message: "Requested a readable photo of the driver's license",
        at: daysAgo(2),
      },
    ],
    createdAt: daysAgo(8),
    updatedAt: daysAgo(2),
    submittedAt: daysAgo(6),
    pendingRequest: "Waiting on a readable driver's license photo",
  },
  {
    id: "app-tasha-williams",
    linkToken: "tasha",
    candidateName: "Tasha Williams",
    trade: "Equipment operator",
    job: jobById("job-pine-ridge"),
    status: "ready_for_review",
    general: {
      fullName: "Tasha Williams",
      phone: "(678) 555-0164",
      email: "tasha.williams@email.com",
      cityState: "Covington, GA",
      yearsExperience: "9",
      primaryTrade: "Equipment operator",
      resumeFileName: "tasha-williams-resume.pdf",
      workReference: "Ray Okafor — Pine Ridge Utilities",
    },
    video: {
      state: "ready",
      source: "record",
      fileName: "tasha-intro.mp4",
      durationSeconds: 92,
      capturedAt: daysAgo(5),
      storagePath: null,
      downloadUrl: null,
summary: null,
    },
    documents: documents(
      {
        "drivers-license": { status: "verified", fileName: "license.jpg", uploadedAt: daysAgo(5) },
        "osha-card": { status: "verified", fileName: "osha-10.jpg", uploadedAt: daysAgo(5) },
      },
      [jobDocument("cdl", "CDL Class A", "Required by Pine Ridge Utilities.", "uploaded")],
    ),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [
      { id: "c1", kind: "created", actor: "Candidate", message: "Opened the application link", at: daysAgo(7) },
      { id: "c2", kind: "submitted", actor: "Candidate", message: "Submitted the application", at: daysAgo(5) },
      { id: "c3", kind: "note", actor: "Sofia Ramirez", message: "Strong equipment background, moved to review", at: daysAgo(1) },
    ],
    createdAt: daysAgo(7),
    updatedAt: daysAgo(1),
    submittedAt: daysAgo(5),
    pendingRequest: null,
  },
  {
    id: "app-jose-ramirez",
    linkToken: "jose",
    candidateName: "Jose Ramirez",
    trade: "Laborer",
    job: jobById("job-rw-dake"),
    status: "agreement_pending",
    general: {
      fullName: "Jose Ramirez",
      phone: "(470) 555-0188",
      email: "jose.ramirez@email.com",
      cityState: "Jonesboro, GA",
      yearsExperience: "3",
      primaryTrade: "Laborer",
      resumeFileName: "",
      workReference: "Hector Lima — RW Dake Construction",
    },
    video: {
      state: "ready",
      source: "upload",
      fileName: "jose-intro.mp4",
      durationSeconds: 55,
      capturedAt: daysAgo(12),
      storagePath: null,
      downloadUrl: null,
summary: null,
    },
    documents: documents({
      "drivers-license": { status: "verified", fileName: "license.jpg", uploadedAt: daysAgo(12) },
      "osha-card": { status: "verified", fileName: "osha-10.jpg", uploadedAt: daysAgo(12) },
    }),
    agreement: { status: "awaiting_signature", sentAt: daysAgo(2), signedAt: null, expiresAt: null },
    activity: [
      { id: "d1", kind: "submitted", actor: "Candidate", message: "Submitted the application", at: daysAgo(12) },
      { id: "d2", kind: "approved", actor: "Sofia Ramirez", message: "Approved the application", at: daysAgo(3) },
      { id: "d3", kind: "note", actor: "System", message: "Operating agreement sent for signature", at: daysAgo(2) },
    ],
    createdAt: daysAgo(14),
    updatedAt: daysAgo(2),
    submittedAt: daysAgo(12),
    pendingRequest: null,
  },
  {
    id: "app-dana-price",
    linkToken: "dana",
    candidateName: "Dana Price",
    trade: "Drywall / finishing",
    job: jobById("job-lakeview"),
    status: "draft",
    general: {
      ...emptyGeneralApplication(),
      fullName: "Dana Price",
      phone: "(678) 555-0102",
      cityState: "Decatur, GA",
      primaryTrade: "Drywall / finishing",
    },
    video: emptyIntroVideo(),
    documents: documents({}),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [{ id: "e1", kind: "created", actor: "Candidate", message: "Opened the application link", at: daysAgo(1) }],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    submittedAt: null,
    pendingRequest: null,
  },
]

/**
 * The record the candidate link opens. A brand-new candidate starts empty;
 * the "demo" token resumes an in-progress draft so the returning-candidate
 * flow can be demonstrated.
 */
export function createCandidateDraft(token: string): CandidateApplication {
  const now = new Date().toISOString()
  return {
    id: `app-${token}`,
    linkToken: token,
    candidateName: "",
    trade: "",
    job: MOCK_JOBS[0],
    status: "draft",
    general: {
      ...emptyGeneralApplication(),
      // Pre-filled by the recruiter when the link is issued.
      fullName: "Benjamin Lopez",
      phone: "(770) 555-0142",
    },
    video: emptyIntroVideo(),
    documents: standardDocuments(),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [{ id: "seed", kind: "created", actor: "Candidate", message: "Opened the application link", at: now }],
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    pendingRequest: null,
  }
}

export function applicationById(applicationId: string): CandidateApplication | null {
  const found = MOCK_APPLICATIONS.find((application) => application.id === applicationId)
  return found ? { ...found } : null
}

/**
 * Fallback for tokens with no link record. Only resumes a draft — a token
 * pointing at an already-submitted application starts a fresh one instead of
 * dropping the candidate on a confirmation screen.
 */
export function applicationByToken(token: string): CandidateApplication {
  const existing = MOCK_APPLICATIONS.find(
    (application) => application.linkToken === token && application.status === "draft",
  )
  return existing ? { ...existing } : createCandidateDraft(token)
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * Mock link registry. The real one is `/applicationLinks/{tokenHash}` — the
 * shape here is deliberately the same so swapping it is a data change.
 */
const MOCK_LINKS = new Map<string, ApplicationLink>()

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
  MOCK_LINKS.set(link.token, link)
  return link
}

export function revokeApplicationLink(token: string): ApplicationLink | null {
  const link = MOCK_LINKS.get(token)
  if (!link) return null
  const revoked = { ...link, revokedAt: new Date().toISOString() }
  MOCK_LINKS.set(token, revoked)
  return revoked
}

/**
 * What a token opens. Unknown tokens fall back to a plain application link so
 * the demo never dead-ends; the real resolver returns 404 instead.
 */
export function linkForToken(token: string): ApplicationLink {
  const known = MOCK_LINKS.get(token)
  if (known) return known
  // Reserved demo tokens so the dashboard preview can show each purpose.
  if (token.startsWith("agreement")) {
    return createApplicationLink({ applicationId: `app-${token}`, purpose: "agreement", token })
  }
  if (token.startsWith("documents") || token.startsWith("video") || token.startsWith("general")) {
    const step = token.split("-")[0] as ApplicationSectionId
    return createApplicationLink({ applicationId: `app-${token}`, purpose: "step", step, token })
  }
  return createApplicationLink({ applicationId: `app-${token}`, purpose: "application", token })
}
