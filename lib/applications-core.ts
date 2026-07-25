/**
 * SVC Applications — framework-free core model.
 *
 * Single source of truth for statuses, the candidate step model, progress
 * math and missing-item derivation. Kept free of React and Firebase so the
 * same rules can later run in a Cloud Function (link issuing, reminders,
 * agreement lifecycle) without a second implementation.
 *
 * Nothing here talks to a backend yet — the UI drives it with local state.
 */

export const APPLICATIONS_SCHEMA_VERSION = 1

// ── Status model ────────────────────────────────────────────────────────

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "needs_information"
  | "ready_for_review"
  | "approved"
  | "agreement_pending"
  | "payroll_in_progress"
  | "hired"
  | "archived"

/** Visual tone — maps to the Applications palette in globals.css. */
export type ApplicationTone = "neutral" | "info" | "pending" | "missing" | "complete" | "ai"

export interface StatusMeta {
  label: string
  tone: ApplicationTone
  /** One-line explanation used in the detail header and filter menu. */
  description: string
}

export const APPLICATION_STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    description: "The candidate started but has not submitted yet.",
  },
  submitted: {
    label: "Submitted",
    tone: "info",
    description: "Submitted and waiting to be picked up for review.",
  },
  needs_information: {
    label: "Needs information",
    tone: "pending",
    description: "We asked the candidate for something and are waiting.",
  },
  ready_for_review: {
    label: "Ready for review",
    tone: "info",
    description: "Everything required is in. Waiting on a decision.",
  },
  approved: {
    label: "Approved",
    tone: "complete",
    description: "Approved. The operating agreement is the next step.",
  },
  agreement_pending: {
    label: "Agreement pending",
    tone: "pending",
    description: "Waiting on the operating agreement signature.",
  },
  payroll_in_progress: {
    label: "Payroll in progress",
    tone: "pending",
    description: "Agreement signed. Payroll setup is running.",
  },
  hired: {
    label: "Hired",
    tone: "complete",
    description: "Fully onboarded.",
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    description: "Closed without hiring.",
  },
}

/** Order used by the dashboard filter row. */
export const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  "draft",
  "submitted",
  "needs_information",
  "ready_for_review",
  "approved",
  "agreement_pending",
  "payroll_in_progress",
  "hired",
  "archived",
]

// ── Operating agreement (future step, mocked states only) ───────────────

export type AgreementStatus = "locked" | "awaiting_signature" | "signed" | "expired"

export const AGREEMENT_STATUS_META: Record<AgreementStatus, StatusMeta> = {
  locked: {
    label: "Locked",
    tone: "neutral",
    description: "Unlocks after the application is approved.",
  },
  awaiting_signature: {
    label: "Awaiting signature",
    tone: "pending",
    description: "Sent to the candidate. Not signed yet.",
  },
  signed: {
    label: "Signed",
    tone: "complete",
    description: "Signed and on file.",
  },
  expired: {
    label: "Expired",
    tone: "missing",
    description: "The signing window closed. Send a new agreement.",
  },
}

export interface OperatingAgreement {
  status: AgreementStatus
  sentAt: string | null
  signedAt: string | null
  expiresAt: string | null
  /** Which version of the text was signed — the evidence that matters. */
  signedVersion?: string | null
  signedName?: string | null
}

// ── Agreement document ──────────────────────────────────────────────────

export interface AgreementSection {
  heading: string
  body: string
}

export interface AgreementTemplate {
  id: string
  version: string
  title: string
  intro: string
  sections: AgreementSection[]
}

/**
 * Placeholder text — NOT reviewed by a lawyer. It exists so the reading,
 * consent and signing UX can be built and tested; the real template replaces
 * `sections` without touching the flow.
 */
export const OPERATING_AGREEMENT_TEMPLATE: AgreementTemplate = {
  id: "svc-operating-agreement",
  version: "1.0",
  title: "Operating Agreement",
  intro:
    "This agreement covers how you work with SVC on assigned jobs. Please read it in full — you'll sign at the end.",
  sections: [
    {
      heading: "1. Parties and assignment",
      body: "This agreement is between SVC and you, the contractor named below, for work performed on the job listed in your application. Each assignment is confirmed separately before it starts.",
    },
    {
      heading: "2. Independent contractor status",
      body: "You perform work as an independent contractor. You control how the work is done, provide your own basic hand tools unless stated otherwise, and are responsible for your own taxes.",
    },
    {
      heading: "3. Pay and invoicing",
      body: "Pay is agreed per assignment before work begins, either hourly or by scope. Approved hours are submitted weekly and paid on the schedule communicated for that job.",
    },
    {
      heading: "4. Safety and site rules",
      body: "You agree to follow all site safety requirements, wear required protective equipment, hold the certifications listed in your application, and report incidents the same day they happen.",
    },
    {
      heading: "5. Documents and eligibility",
      body: "You confirm the documents you uploaded are yours, current and valid, and that you are legally eligible to perform this work.",
    },
    {
      heading: "6. Confidentiality",
      body: "Job plans, client information and site details stay confidential. Photos of a site may only be shared when the job supervisor approves it.",
    },
    {
      heading: "7. Term and ending the agreement",
      body: "This agreement stays in place while you take assignments. Either side may end it in writing at any time; work already performed is still paid.",
    },
    {
      heading: "8. Electronic signature",
      body: "By checking the consent box, typing your name and signing below, you agree that your electronic signature has the same effect as a handwritten one, and that we may keep a sealed copy of this document as a record.",
    },
  ],
}

// ── Signature ───────────────────────────────────────────────────────────

export interface SignatureDraft {
  /** The candidate scrolled to the end of the agreement. */
  reachedEnd: boolean
  consent: boolean
  typedName: string
  hasSignature: boolean
}

export function emptySignatureDraft(): SignatureDraft {
  return { reachedEnd: false, consent: false, typedName: "", hasSignature: false }
}

/** Loose comparison: case, accents, punctuation and extra spaces don't matter. */
export function normalizeSignatureName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
}

export function nameMatches(typed: string, expected: string): boolean {
  const typedNormalized = normalizeSignatureName(typed)
  if (!typedNormalized) return false
  const expectedNormalized = normalizeSignatureName(expected)
  return expectedNormalized ? typedNormalized === expectedNormalized : true
}

export interface SignatureReadiness {
  ready: boolean
  /** What is still missing, in reading order — shown instead of a dead button. */
  pending: string[]
}

/**
 * Every requirement is part of the evidence trail, so none of them is
 * optional: read it, agree to it, name yourself, sign.
 */
export function signatureReadiness(draft: SignatureDraft, expectedName: string): SignatureReadiness {
  const pending: string[] = []
  if (!draft.reachedEnd) pending.push("Read to the end of the agreement")
  if (!draft.consent) pending.push("Agree to sign electronically")
  if (!draft.typedName.trim()) pending.push("Type your full name")
  else if (!nameMatches(draft.typedName, expectedName)) pending.push("Type your name as it appears above")
  if (!draft.hasSignature) pending.push("Draw your signature")
  return { ready: pending.length === 0, pending }
}

// ── Candidate steps ─────────────────────────────────────────────────────

export type CandidateStepId =
  | "welcome"
  | "general"
  | "video"
  | "documents"
  | "review"
  | "submitted"
  // Reached only through an `agreement` link, after approval — outside the
  // 4-step application flow.
  | "agreement"
  | "agreement-signed"

/** Steps that carry data and therefore count towards progress. */
export type ApplicationSectionId = "general" | "video" | "documents"

export type SectionState = "not_started" | "in_progress" | "complete"

export interface CandidateStepMeta {
  id: CandidateStepId
  /** Short label for the stepper. */
  label: string
  /** Shown in the top bar — the screen's name. */
  title: string
  /** One short sentence — candidates read very little. */
  intro: string
  /** Position in the "Step N of 4" counter. Welcome/submitted are outside it. */
  index: number | null
}

export const CANDIDATE_STEP_COUNT = 4

export const CANDIDATE_STEPS: CandidateStepMeta[] = [
  {
    id: "welcome",
    label: "Welcome",
    title: "SVC Applications",
    intro: "Complete these steps to be considered for upcoming construction opportunities.",
    index: null,
  },
  {
    id: "general",
    label: "Application",
    title: "General Application",
    intro: "Tell us how to reach you and what you do.",
    index: 1,
  },
  {
    id: "video",
    label: "Intro Video",
    title: "Intro Video",
    intro: "Record a short video telling us about yourself.",
    index: 2,
  },
  {
    id: "documents",
    label: "Documents",
    title: "Documents",
    intro: "Only the items required for your job are listed.",
    index: 3,
  },
  {
    id: "review",
    label: "Review",
    title: "Review & Submit",
    intro: "Check everything looks right before you send it.",
    index: 4,
  },
  {
    id: "submitted",
    label: "Submitted",
    title: "Submitted",
    intro: "We received everything. We will be in touch.",
    index: null,
  },
  {
    id: "agreement",
    label: "Agreement",
    title: "Operating Agreement",
    intro: "Read it in full, then sign at the end.",
    index: null,
  },
  {
    id: "agreement-signed",
    label: "Signed",
    title: "Signed",
    intro: "Your signed agreement is on file.",
    index: null,
  },
]

export function candidateStep(id: CandidateStepId): CandidateStepMeta {
  return CANDIDATE_STEPS.find((step) => step.id === id) ?? CANDIDATE_STEPS[0]
}

/**
 * Linear order the candidate walks through. The agreement steps are absent on
 * purpose: they are a separate visit, reached by their own link.
 */
export const CANDIDATE_STEP_ORDER: CandidateStepId[] = [
  "welcome",
  "general",
  "video",
  "documents",
  "review",
  "submitted",
]

export function nextCandidateStep(id: CandidateStepId): CandidateStepId | null {
  const index = CANDIDATE_STEP_ORDER.indexOf(id)
  return index >= 0 && index < CANDIDATE_STEP_ORDER.length - 1 ? CANDIDATE_STEP_ORDER[index + 1] : null
}

export function previousCandidateStep(id: CandidateStepId): CandidateStepId | null {
  const index = CANDIDATE_STEP_ORDER.indexOf(id)
  return index > 0 ? CANDIDATE_STEP_ORDER[index - 1] : null
}

// ── General application ─────────────────────────────────────────────────

export type GeneralFieldId =
  | "fullName"
  | "phone"
  | "email"
  | "cityState"
  | "yearsExperience"
  | "primaryTrade"
  | "resumeFileName"
  | "workReference"

export type GeneralApplication = Record<GeneralFieldId, string>

/** Icon key — resolved to a lucide component in the form layer. */
export type FieldIcon = "user" | "phone" | "mail" | "pin" | "calendar" | "trade" | "file"

export interface GeneralFieldMeta {
  id: GeneralFieldId
  label: string
  placeholder: string
  /** Drives the input type / keyboard on mobile. "upload" renders a row. */
  kind: "text" | "tel" | "email" | "number" | "select" | "upload"
  required: boolean
  icon: FieldIcon
  /** Second line on upload rows. */
  helper?: string
  options?: string[]
}

export const TRADE_OPTIONS = [
  "Carpenter",
  "Concrete finisher",
  "Equipment operator",
  "Electrician",
  "Plumber",
  "Laborer",
  "Framer",
  "Drywall / finishing",
  "Painter",
  "Welder",
  "Foreman / supervisor",
  "Other",
]

/**
 * One column, placeholder-first, icon-led. Labels stay in the model for
 * accessibility, review summaries and missing-item lists.
 */
export const GENERAL_FIELDS: GeneralFieldMeta[] = [
  { id: "fullName", label: "Full name", placeholder: "Full name", kind: "text", required: true, icon: "user" },
  { id: "phone", label: "Phone", placeholder: "Phone", kind: "tel", required: true, icon: "phone" },
  { id: "email", label: "Email", placeholder: "Email", kind: "email", required: true, icon: "mail" },
  { id: "cityState", label: "City & state", placeholder: "City & state", kind: "text", required: true, icon: "pin" },
  {
    id: "yearsExperience",
    label: "Years of experience",
    placeholder: "Years of experience",
    kind: "number",
    required: true,
    icon: "calendar",
  },
  {
    id: "primaryTrade",
    label: "Primary trade",
    placeholder: "Primary trade",
    kind: "select",
    required: true,
    icon: "trade",
    options: TRADE_OPTIONS,
  },
  {
    id: "resumeFileName",
    label: "Résumé",
    placeholder: "Upload your résumé",
    kind: "upload",
    required: false,
    icon: "file",
  },
  {
    id: "workReference",
    label: "Work reference",
    placeholder: "Upload or add reference",
    kind: "upload",
    required: false,
    icon: "file",
  },
]

/** Shown on the welcome screen so candidates know what they're signing up for. */
export const APPLICATION_TIME_ESTIMATE = "8–10 minutes"

export function emptyGeneralApplication(): GeneralApplication {
  return GENERAL_FIELDS.reduce((draft, field) => {
    draft[field.id] = ""
    return draft
  }, {} as GeneralApplication)
}

export function missingGeneralFields(general: GeneralApplication): GeneralFieldMeta[] {
  return GENERAL_FIELDS.filter((field) => field.required && !general[field.id]?.trim())
}

// ── Intro video ─────────────────────────────────────────────────────────

export type IntroVideoState = "not_started" | "processing" | "ready"

export interface IntroVideo {
  state: IntroVideoState
  source: "record" | "upload" | null
  fileName: string | null
  durationSeconds: number | null
  capturedAt: string | null
  /** Firebase Storage object path — the source of truth for the file. */
  storagePath: string | null
  /** Tokenized download URL for playback in the dashboard. */
  downloadUrl: string | null
  /** Populated later by the transcription job. */
  transcript?: string | null
  /** Placeholder for the future transcription + AI summary pipeline. */
  summary: string | null
}

export const INTRO_VIDEO_PROMPTS = ["Your name", "Your town", "Your years of experience"]

export function emptyIntroVideo(): IntroVideo {
  return {
    state: "not_started",
    source: null,
    fileName: null,
    durationSeconds: null,
    capturedAt: null,
    storagePath: null,
    downloadUrl: null,
    summary: null,
  }
}

// ── Documents ───────────────────────────────────────────────────────────

export type DocumentStatus = "missing" | "uploaded" | "verified" | "not_required"

export interface RequiredDocument {
  id: string
  label: string
  /** Why it is being asked for — one short line. */
  helper: string
  /** A job can explicitly mark an item as not needed for this candidate. */
  required: boolean
  status: DocumentStatus
  fileName: string | null
  uploadedAt: string | null
  /** Firebase Storage object path — the source of truth for the file. */
  storagePath: string | null
  /** Tokenized download URL for review in the dashboard. */
  downloadUrl: string | null
  /** "standard" = always asked; "job" = required by the linked job only. */
  origin: "standard" | "job"
}

export function standardDocuments(): RequiredDocument[] {
  return [
    {
      id: "drivers-license",
      label: "Driver's license",
      helper: "Front side, clearly readable.",
      required: true,
      status: "missing",
      fileName: null,
      uploadedAt: null,
      storagePath: null,
      downloadUrl: null,
      origin: "standard",
    },
    {
      id: "osha-card",
      label: "OSHA 10 card",
      helper: "Front side of the card.",
      required: true,
      status: "missing",
      fileName: null,
      uploadedAt: null,
      storagePath: null,
      downloadUrl: null,
      origin: "standard",
    },
  ]
}

export function missingDocuments(documents: RequiredDocument[]): RequiredDocument[] {
  return documents.filter((document) => document.required && document.status === "missing")
}

// ── Application record ──────────────────────────────────────────────────

export type ActivityKind = "created" | "submitted" | "info_requested" | "info_received" | "approved" | "archived" | "note"

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  /** Who did it — internal reviewer name or "Candidate". */
  actor: string
  message: string
  at: string
}

export interface LinkedJob {
  /** Directory job id — matches DirectoryIndexEntry ids once wired up. */
  id: string
  name: string
  location: string
  companyName: string
}

export interface CandidateApplication {
  id: string
  /** Token used by the secure candidate link (?apply=<token>). */
  linkToken: string
  candidateName: string
  trade: string
  job: LinkedJob
  status: ApplicationStatus
  general: GeneralApplication
  video: IntroVideo
  documents: RequiredDocument[]
  agreement: OperatingAgreement
  activity: ActivityEvent[]
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  /** Latest outstanding question sent to the candidate. */
  pendingRequest: string | null
}

export function emptyLinkedJob(): LinkedJob {
  return { id: "", name: "", location: "", companyName: "" }
}

export interface InviteDetails {
  candidateName: string
  trade: string
  jobName: string
}

/**
 * A fresh application for a brand-new invite. The reviewer names the candidate
 * and picks the trade/job up front; the candidate fills in the rest. The name
 * and trade are prefilled into `general` so the form isn't blank on first open.
 */
export function blankApplication(id: string, token: string, invite?: Partial<InviteDetails>): CandidateApplication {
  const now = new Date().toISOString()
  const candidateName = invite?.candidateName?.trim() ?? ""
  const trade = invite?.trade?.trim() ?? ""
  const jobName = invite?.jobName?.trim() ?? ""
  return {
    id,
    linkToken: token,
    candidateName,
    trade,
    job: { ...emptyLinkedJob(), name: jobName, companyName: jobName },
    status: "draft",
    general: { ...emptyGeneralApplication(), fullName: candidateName, primaryTrade: trade },
    video: emptyIntroVideo(),
    documents: standardDocuments(),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [],
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    pendingRequest: null,
  }
}

// ── Progress ────────────────────────────────────────────────────────────

export interface MissingItem {
  /** Where the candidate must go to fix it. */
  step: ApplicationSectionId
  label: string
}

export interface SectionProgress {
  id: ApplicationSectionId
  label: string
  state: SectionState
  /** Short right-aligned status text. */
  detail: string
}

export interface ApplicationProgress {
  percent: number
  sections: SectionProgress[]
  missingItems: MissingItem[]
  isComplete: boolean
}

/** Section weights — they must add up to 100. */
const SECTION_WEIGHTS: Record<ApplicationSectionId, number> = {
  general: 45,
  video: 25,
  documents: 30,
}

export function generalState(general: GeneralApplication): SectionState {
  const missing = missingGeneralFields(general)
  if (missing.length === 0) return "complete"
  const filled = GENERAL_FIELDS.filter((field) => general[field.id]?.trim()).length
  return filled === 0 ? "not_started" : "in_progress"
}

export function videoState(video: IntroVideo): SectionState {
  if (video.state === "ready") return "complete"
  return video.state === "processing" ? "in_progress" : "not_started"
}

export function documentsState(documents: RequiredDocument[]): SectionState {
  const required = documents.filter((document) => document.required)
  if (required.length === 0) return "complete"
  const done = required.filter((document) => document.status !== "missing")
  if (done.length === required.length) return "complete"
  return done.length === 0 ? "not_started" : "in_progress"
}

function sectionRatio(state: SectionState): number {
  if (state === "complete") return 1
  return state === "in_progress" ? 0.5 : 0
}

export function computeApplicationProgress(application: CandidateApplication): ApplicationProgress {
  const general = generalState(application.general)
  const video = videoState(application.video)
  const documents = documentsState(application.documents)

  const requiredDocuments = application.documents.filter((document) => document.required)
  const uploadedDocuments = requiredDocuments.filter((document) => document.status !== "missing")
  const missingGeneral = missingGeneralFields(application.general)

  // General is scored per-field so the bar moves while the candidate types;
  // the other two sections are coarse (not started / in progress / complete).
  const generalRatio =
    GENERAL_FIELDS.filter((field) => field.required).length === 0
      ? 1
      : (GENERAL_FIELDS.filter((field) => field.required).length - missingGeneral.length) /
        GENERAL_FIELDS.filter((field) => field.required).length

  const documentsRatio =
    requiredDocuments.length === 0 ? 1 : uploadedDocuments.length / requiredDocuments.length

  const percent = Math.round(
    generalRatio * SECTION_WEIGHTS.general +
      sectionRatio(video) * SECTION_WEIGHTS.video +
      documentsRatio * SECTION_WEIGHTS.documents,
  )

  const missingItems: MissingItem[] = [
    ...missingGeneral.map((field) => ({ step: "general" as const, label: field.label })),
    ...(video === "complete" ? [] : [{ step: "video" as const, label: "Intro video" }]),
    ...missingDocuments(application.documents).map((document) => ({ step: "documents" as const, label: document.label })),
  ]

  const sections: SectionProgress[] = [
    {
      id: "general",
      label: "Application",
      state: general,
      detail:
        general === "complete"
          ? "Complete"
          : general === "in_progress"
            ? `${missingGeneral.length} field${missingGeneral.length === 1 ? "" : "s"} left`
            : "Not started",
    },
    {
      id: "video",
      label: "Intro video",
      state: video,
      detail: video === "complete" ? "Uploaded" : video === "in_progress" ? "Processing" : "Not started",
    },
    {
      id: "documents",
      label: "Documents",
      state: documents,
      detail:
        documents === "complete"
          ? "Complete"
          : `${requiredDocuments.length - uploadedDocuments.length} missing`,
    },
  ]

  return {
    percent: Math.max(0, Math.min(100, percent)),
    sections,
    missingItems,
    isComplete: missingItems.length === 0,
  }
}

/** First section the candidate still has to deal with — drives "Continue". */
export function nextIncompleteSection(application: CandidateApplication): ApplicationSectionId | null {
  const progress = computeApplicationProgress(application)
  return progress.missingItems[0]?.step ?? null
}

/** The step the "Continue application" button should open. */
export function resumeStep(application: CandidateApplication): CandidateStepId {
  if (application.status !== "draft") return "submitted"
  return nextIncompleteSection(application) ?? "review"
}

/**
 * Short line shown on dashboard cards: what the reviewer should do next, or
 * what is blocking the candidate.
 */
export function nextActionLabel(application: CandidateApplication): string {
  const progress = computeApplicationProgress(application)
  switch (application.status) {
    case "draft":
      return progress.missingItems.length > 0
        ? `Candidate has ${progress.missingItems.length} item${progress.missingItems.length === 1 ? "" : "s"} left`
        : "Waiting for the candidate to submit"
    case "needs_information":
      return application.pendingRequest ?? "Waiting on the candidate"
    case "submitted":
      return "Start review"
    case "ready_for_review":
      return "Ready for review"
    case "approved":
      return "Send operating agreement"
    case "agreement_pending":
      return AGREEMENT_STATUS_META[application.agreement.status].label
    case "payroll_in_progress":
      return "Payroll setup running"
    case "hired":
      return "Onboarded"
    case "archived":
      return "Archived"
  }
}

/** Statuses a reviewer can act on — everything else is terminal for now. */
export function canApprove(status: ApplicationStatus): boolean {
  return status === "submitted" || status === "ready_for_review" || status === "needs_information"
}

export function canRequestInfo(status: ApplicationStatus): boolean {
  return status !== "archived" && status !== "hired"
}

export function canArchive(status: ApplicationStatus): boolean {
  return status !== "archived"
}

// ── Secure links ────────────────────────────────────────────────────────

/**
 * One mechanism, three jobs. The step a link opens lives in the link record —
 * never in the URL — so the shared text stays short and can't be edited to
 * land somewhere else.
 */
export type LinkPurpose = "application" | "step" | "agreement"

export interface ApplicationLink {
  token: string
  applicationId: string
  purpose: LinkPurpose
  /** Only for purpose "step": where the candidate lands. */
  step: ApplicationSectionId | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  usedCount: number
}

/** Shorter windows for the riskier purposes — signing is the shortest. */
export const LINK_EXPIRY_DAYS: Record<LinkPurpose, number> = {
  application: 14,
  step: 7,
  agreement: 3,
}

export const LINK_PURPOSE_META: Record<LinkPurpose, { label: string; description: string }> = {
  application: {
    label: "Application link",
    description: "Opens the full application, or wherever the candidate left off.",
  },
  step: {
    label: "Direct link",
    description: "Opens the exact item that is missing — no restart, no app to install.",
  },
  agreement: {
    label: "Agreement link",
    description: "Opens the operating agreement for review and signature.",
  },
}

export type LinkState = "active" | "expired" | "revoked"

export function linkState(link: ApplicationLink, now: Date = new Date()): LinkState {
  if (link.revokedAt) return "revoked"
  return new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active"
}

export function daysUntilExpiry(link: ApplicationLink, now: Date = new Date()): number {
  const ms = new Date(link.expiresAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

/** Short line for the share sheet: "Expires in 6 days" / "Expired". */
export function describeLinkExpiry(link: ApplicationLink, now: Date = new Date()): string {
  const state = linkState(link, now)
  if (state === "revoked") return "Revoked"
  if (state === "expired") return "Expired"
  const days = daysUntilExpiry(link, now)
  if (days <= 1) return "Expires within a day"
  return `Expires in ${days} days`
}

export function createApplicationLink(input: {
  applicationId: string
  purpose: LinkPurpose
  step?: ApplicationSectionId | null
  token: string
  now?: Date
}): ApplicationLink {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + LINK_EXPIRY_DAYS[input.purpose] * 86_400_000)
  return {
    token: input.token,
    applicationId: input.applicationId,
    purpose: input.purpose,
    step: input.purpose === "step" ? (input.step ?? null) : null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    usedCount: 0,
  }
}

/** The URL that gets shared. Origin is injected so this stays testable. */
export function applicationLinkUrl(token: string, origin = ""): string {
  const base = origin.replace(/\/+$/, "")
  return `${base}/?apply=${token}`
}

/**
 * Deterministic per-application candidate uid. The `cand_` prefix keeps it in
 * a namespace that can never collide with a real SVC user's Firebase uid, and
 * making it stable means reopening the same link resumes the same identity.
 */
export function candidateUid(applicationId: string): string {
  return `cand_${applicationId}`
}

export type LinkResolution =
  | { ok: true; link: ApplicationLink }
  | { ok: false; reason: "not_found" | "revoked" | "expired" }

/** Server-side gate before a token is turned into a session. Pure so it's tested. */
export function resolveLink(link: ApplicationLink | null, now: Date = new Date()): LinkResolution {
  if (!link) return { ok: false, reason: "not_found" }
  const state = linkState(link, now)
  if (state === "revoked") return { ok: false, reason: "revoked" }
  if (state === "expired") return { ok: false, reason: "expired" }
  return { ok: true, link }
}

export const LINK_RESOLUTION_MESSAGE: Record<Exclude<LinkResolution, { ok: true }>["reason"], string> = {
  not_found: "This link is not valid. Ask your SVC contact for a new one.",
  revoked: "This link was turned off. Ask your SVC contact for a new one.",
  expired: "This link has expired. Ask your SVC contact for a new one.",
}

// ── Request information ─────────────────────────────────────────────────

export const REQUEST_MESSAGE_MAX = 300

export interface RequestableItem {
  id: string
  label: string
  /** "Required" blocks the hire; "Helpful" is nice to have. */
  requirement: "Required" | "Helpful"
  /** Preselected because the candidate genuinely still owes it. */
  missing: boolean
}

/**
 * What a reviewer can ask a candidate for, in the order they should read:
 * blocking documents first, then the video, then the soft asks.
 */
export function requestableItems(application: CandidateApplication): RequestableItem[] {
  const items: RequestableItem[] = application.documents
    .filter((document) => document.required)
    .map((document) => ({
      id: document.id,
      label: document.label,
      requirement: "Required" as const,
      missing: document.status === "missing",
    }))

  if (videoState(application.video) !== "complete") {
    items.push({ id: "intro-video", label: "Intro video", requirement: "Required", missing: true })
  }

  if (!application.general.workReference?.trim()) {
    items.push({ id: "work-reference", label: "Work reference", requirement: "Helpful", missing: false })
  }
  if (!application.general.resumeFileName?.trim()) {
    items.push({ id: "resume", label: "Résumé", requirement: "Helpful", missing: false })
  }
  if (application.agreement.status !== "signed") {
    items.push({ id: "operating-agreement", label: "Operating agreement", requirement: "Required", missing: false })
  }

  return items
}

/** Default message body — reviewers can edit it before sending. */
export function composeRequestMessage(candidateName: string, labels: string[], link = ""): string {
  const firstName = candidateName.trim().split(/\s+/)[0] || "there"
  const suffix = link ? `\n\n${link}` : ""
  if (labels.length === 0) return `Hi ${firstName},\n\n${suffix.trim()}`
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
  return `Hi ${firstName},\n\nPlease upload your ${list} using the secure link below. Thank you!${suffix}`
}

// ── Dashboard filtering ─────────────────────────────────────────────────

export interface ApplicationFilters {
  query: string
  status: ApplicationStatus | "all"
  jobId: string | "all"
  trade: string | "all"
}

export function emptyFilters(): ApplicationFilters {
  return { query: "", status: "all", jobId: "all", trade: "all" }
}

export function filterApplications(
  applications: CandidateApplication[],
  filters: ApplicationFilters,
): CandidateApplication[] {
  const query = filters.query.trim().toLowerCase()
  return applications.filter((application) => {
    if (filters.status !== "all" && application.status !== filters.status) return false
    if (filters.jobId !== "all" && application.job.id !== filters.jobId) return false
    if (filters.trade !== "all" && application.trade !== filters.trade) return false
    if (!query) return true
    return (
      application.candidateName.toLowerCase().includes(query) ||
      application.trade.toLowerCase().includes(query) ||
      application.job.name.toLowerCase().includes(query) ||
      application.job.companyName.toLowerCase().includes(query)
    )
  })
}

export interface ApplicationCounts {
  newCount: number
  needsReview: number
  missingItems: number
  approved: number
}

export function summarizeApplications(applications: CandidateApplication[]): ApplicationCounts {
  return {
    newCount: applications.filter((application) => application.status === "submitted").length,
    needsReview: applications.filter((application) => application.status === "ready_for_review").length,
    missingItems: applications.filter(
      (application) => application.status === "needs_information" || computeApplicationProgress(application).missingItems.length > 0,
    ).length,
    approved: applications.filter(
      (application) =>
        application.status === "approved" ||
        application.status === "agreement_pending" ||
        application.status === "payroll_in_progress" ||
        application.status === "hired",
    ).length,
  }
}

// ── Formatting helpers ──────────────────────────────────────────────────

export function formatApplicationDate(iso: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function formatRelativeDate(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days} days ago`
  return formatApplicationDate(iso)
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}
