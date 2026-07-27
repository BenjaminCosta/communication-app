"use strict";
// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/applications-core.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_MESSAGE_MAX = exports.LINK_RESOLUTION_MESSAGE = exports.LINK_PURPOSE_META = exports.LINK_EXPIRY_DAYS = exports.UNARCHIVE_FALLBACK_STATUS = exports.INTRO_VIDEO_MAX_DURATION_SECONDS = exports.INTRO_VIDEO_PROMPTS = exports.INTRO_VIDEO_MISSING_FIELDS = exports.REQUIRED_GENERAL_FIELD_COUNT = exports.REQUIRED_GENERAL_FIELDS = exports.APPLICATION_TIME_ESTIMATE = exports.GENERAL_FIELDS = exports.TRADE_OPTIONS = exports.CANDIDATE_STEP_ORDER = exports.CANDIDATE_STEPS = exports.CANDIDATE_STEP_COUNT = exports.OPERATING_AGREEMENT_TEMPLATE = exports.AGREEMENT_STATUS_META = exports.APPLICATION_STATUS_ORDER = exports.APPLICATION_STATUS_META = exports.APPLICATIONS_SCHEMA_VERSION = void 0;
exports.emptySignatureDraft = emptySignatureDraft;
exports.normalizeSignatureName = normalizeSignatureName;
exports.nameMatches = nameMatches;
exports.signatureReadiness = signatureReadiness;
exports.candidateStep = candidateStep;
exports.nextCandidateStep = nextCandidateStep;
exports.previousCandidateStep = previousCandidateStep;
exports.emptyGeneralApplication = emptyGeneralApplication;
exports.missingGeneralFields = missingGeneralFields;
exports.emptyIntroVideo = emptyIntroVideo;
exports.standardDocuments = standardDocuments;
exports.missingDocuments = missingDocuments;
exports.emptyLinkedJob = emptyLinkedJob;
exports.blankApplication = blankApplication;
exports.generalState = generalState;
exports.videoState = videoState;
exports.describeTranscriptionStatus = describeTranscriptionStatus;
exports.documentsState = documentsState;
exports.computeApplicationProgress = computeApplicationProgress;
exports.nextIncompleteSection = nextIncompleteSection;
exports.resumeStep = resumeStep;
exports.nextActionLabel = nextActionLabel;
exports.canApprove = canApprove;
exports.canRequestInfo = canRequestInfo;
exports.canMarkHired = canMarkHired;
exports.needsAgreementAttention = needsAgreementAttention;
exports.canArchive = canArchive;
exports.canUnarchive = canUnarchive;
exports.resolveUnarchiveStatus = resolveUnarchiveStatus;
exports.linkState = linkState;
exports.daysUntilExpiry = daysUntilExpiry;
exports.describeLinkExpiry = describeLinkExpiry;
exports.createApplicationLink = createApplicationLink;
exports.applicationLinkUrl = applicationLinkUrl;
exports.candidateUid = candidateUid;
exports.resolveLink = resolveLink;
exports.requestableItems = requestableItems;
exports.composeRequestMessage = composeRequestMessage;
exports.emptyFilters = emptyFilters;
exports.filterApplications = filterApplications;
exports.summarizeApplications = summarizeApplications;
exports.formatApplicationDate = formatApplicationDate;
exports.formatRelativeDate = formatRelativeDate;
exports.initialsFor = initialsFor;
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
exports.APPLICATIONS_SCHEMA_VERSION = 1;
exports.APPLICATION_STATUS_META = {
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
};
/** Order used by the dashboard filter row. */
exports.APPLICATION_STATUS_ORDER = [
    "draft",
    "submitted",
    "needs_information",
    "ready_for_review",
    "approved",
    "agreement_pending",
    "payroll_in_progress",
    "hired",
    "archived",
];
exports.AGREEMENT_STATUS_META = {
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
};
/**
 * Placeholder text — NOT reviewed by a lawyer. It exists so the reading,
 * consent and signing UX can be built and tested; the real template replaces
 * `sections` without touching the flow.
 */
exports.OPERATING_AGREEMENT_TEMPLATE = {
    id: "svc-operating-agreement",
    version: "1.0",
    title: "Operating Agreement",
    intro: "This agreement covers how you work with SVC on assigned jobs. Please read it in full — you'll sign at the end.",
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
};
function emptySignatureDraft() {
    return { reachedEnd: false, consent: false, typedName: "", hasSignature: false };
}
/** Loose comparison: case, accents, punctuation and extra spaces don't matter. */
function normalizeSignatureName(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^\p{L}\s]/gu, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}
function nameMatches(typed, expected) {
    const typedNormalized = normalizeSignatureName(typed);
    if (!typedNormalized)
        return false;
    const expectedNormalized = normalizeSignatureName(expected);
    return expectedNormalized ? typedNormalized === expectedNormalized : true;
}
/**
 * Every requirement is part of the evidence trail, so none of them is
 * optional: read it, agree to it, name yourself, sign.
 */
function signatureReadiness(draft, expectedName) {
    const pending = [];
    if (!draft.reachedEnd)
        pending.push("Read to the end of the agreement");
    if (!draft.consent)
        pending.push("Agree to sign electronically");
    if (!draft.typedName.trim())
        pending.push("Type your full name");
    else if (!nameMatches(draft.typedName, expectedName))
        pending.push("Type your name as it appears above");
    if (!draft.hasSignature)
        pending.push("Draw your signature");
    return { ready: pending.length === 0, pending };
}
exports.CANDIDATE_STEP_COUNT = 4;
exports.CANDIDATE_STEPS = [
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
];
function candidateStep(id) {
    return exports.CANDIDATE_STEPS.find((step) => step.id === id) ?? exports.CANDIDATE_STEPS[0];
}
/**
 * Linear order the candidate walks through. The agreement steps are absent on
 * purpose: they are a separate visit, reached by their own link.
 */
exports.CANDIDATE_STEP_ORDER = [
    "welcome",
    "general",
    "video",
    "documents",
    "review",
    "submitted",
];
function nextCandidateStep(id) {
    const index = exports.CANDIDATE_STEP_ORDER.indexOf(id);
    return index >= 0 && index < exports.CANDIDATE_STEP_ORDER.length - 1 ? exports.CANDIDATE_STEP_ORDER[index + 1] : null;
}
function previousCandidateStep(id) {
    const index = exports.CANDIDATE_STEP_ORDER.indexOf(id);
    return index > 0 ? exports.CANDIDATE_STEP_ORDER[index - 1] : null;
}
exports.TRADE_OPTIONS = [
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
];
/**
 * One column, placeholder-first, icon-led. Labels stay in the model for
 * accessibility, review summaries and missing-item lists.
 */
exports.GENERAL_FIELDS = [
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
        options: exports.TRADE_OPTIONS,
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
];
/** Shown on the welcome screen so candidates know what they're signing up for. */
exports.APPLICATION_TIME_ESTIMATE = "8–10 minutes";
function emptyGeneralApplication() {
    return exports.GENERAL_FIELDS.reduce((draft, field) => {
        draft[field.id] = "";
        return draft;
    }, {});
}
/**
 * The required general fields, resolved once at module load. The progress
 * math runs per candidate card, so recomputing this filter on every call
 * (previously up to 5× per progress calculation) was pure waste.
 */
exports.REQUIRED_GENERAL_FIELDS = exports.GENERAL_FIELDS.filter((field) => field.required);
exports.REQUIRED_GENERAL_FIELD_COUNT = exports.REQUIRED_GENERAL_FIELDS.length;
function missingGeneralFields(general) {
    return exports.REQUIRED_GENERAL_FIELDS.filter((field) => !general[field.id]?.trim());
}
/** How many required general fields are filled — cheap, single pass. */
function filledRequiredGeneralCount(general) {
    let filled = 0;
    for (const field of exports.REQUIRED_GENERAL_FIELDS) {
        if (general[field.id]?.trim())
            filled += 1;
    }
    return filled;
}
exports.INTRO_VIDEO_MISSING_FIELDS = ["name", "town", "yearsOfExperience"];
exports.INTRO_VIDEO_PROMPTS = ["Your name", "Your town", "Your years of experience"];
/** Recommended (not enforced) — the candidate is never blocked on length. */
exports.INTRO_VIDEO_MAX_DURATION_SECONDS = 120;
function emptyIntroVideo() {
    return {
        state: "not_started",
        source: null,
        fileName: null,
        durationSeconds: null,
        capturedAt: null,
        storagePath: null,
        downloadUrl: null,
        mimeType: null,
        sizeBytes: null,
        transcriptionStatus: null,
        transcript: null,
        summary: null,
        transcriptionModel: null,
        summaryModel: null,
        processedAt: null,
        processingError: null,
        processedStoragePath: null,
    };
}
function standardDocuments() {
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
    ];
}
function missingDocuments(documents) {
    return documents.filter((document) => document.required && document.status === "missing");
}
function emptyLinkedJob() {
    return { id: "", name: "", location: "", companyName: "" };
}
/**
 * A fresh application for a brand-new invite. The reviewer names the candidate
 * and picks the trade/job up front; the candidate fills in the rest. The name
 * and trade are prefilled into `general` so the form isn't blank on first open.
 */
function blankApplication(id, token, invite) {
    const now = new Date().toISOString();
    const candidateName = invite?.candidateName?.trim() ?? "";
    const trade = invite?.trade?.trim() ?? "";
    const jobName = invite?.jobName?.trim() ?? "";
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
        previousStatus: null,
        agreementId: null,
    };
}
/** Section weights — they must add up to 100. */
const SECTION_WEIGHTS = {
    general: 45,
    video: 25,
    documents: 30,
};
function generalState(general) {
    if (filledRequiredGeneralCount(general) === exports.REQUIRED_GENERAL_FIELD_COUNT)
        return "complete";
    // Any field filled (including optional ones) counts as "in progress".
    return exports.GENERAL_FIELDS.some((field) => general[field.id]?.trim()) ? "in_progress" : "not_started";
}
function videoState(video) {
    if (video.state === "ready")
        return "complete";
    return video.state === "processing" ? "in_progress" : "not_started";
}
/**
 * Dashboard label for the AI pipeline, independent of the upload state above.
 * No video uploaded yet is represented by `null` — distinct from "pending",
 * which means a video exists and is queued.
 */
function describeTranscriptionStatus(status) {
    switch (status) {
        case "pending":
            return { label: "Uploaded", tone: "info" };
        case "processing":
            return { label: "Processing", tone: "pending" };
        case "completed":
            return { label: "Ready", tone: "complete" };
        case "failed":
            return { label: "Failed", tone: "missing" };
        default:
            return { label: "Missing", tone: "neutral" };
    }
}
function documentsState(documents) {
    const required = documents.filter((document) => document.required);
    if (required.length === 0)
        return "complete";
    const done = required.filter((document) => document.status !== "missing");
    if (done.length === required.length)
        return "complete";
    return done.length === 0 ? "not_started" : "in_progress";
}
function sectionRatio(state) {
    if (state === "complete")
        return 1;
    return state === "in_progress" ? 0.5 : 0;
}
function computeApplicationProgress(application) {
    // Compute the missing general fields ONCE — it drives the general state, the
    // ratio and the missing-item labels below. (This used to run the same filter
    // ~5 times per call, and this whole function runs per candidate card.)
    const missingGeneral = missingGeneralFields(application.general);
    const general = missingGeneral.length === 0
        ? "complete"
        : exports.GENERAL_FIELDS.some((field) => application.general[field.id]?.trim())
            ? "in_progress"
            : "not_started";
    const video = videoState(application.video);
    const documents = documentsState(application.documents);
    const requiredDocuments = application.documents.filter((document) => document.required);
    const uploadedDocuments = requiredDocuments.filter((document) => document.status !== "missing");
    // General is scored per-field so the bar moves while the candidate types;
    // the other two sections are coarse (not started / in progress / complete).
    const generalRatio = exports.REQUIRED_GENERAL_FIELD_COUNT === 0
        ? 1
        : (exports.REQUIRED_GENERAL_FIELD_COUNT - missingGeneral.length) / exports.REQUIRED_GENERAL_FIELD_COUNT;
    const documentsRatio = requiredDocuments.length === 0 ? 1 : uploadedDocuments.length / requiredDocuments.length;
    const percent = Math.round(generalRatio * SECTION_WEIGHTS.general +
        sectionRatio(video) * SECTION_WEIGHTS.video +
        documentsRatio * SECTION_WEIGHTS.documents);
    const missingItems = [
        ...missingGeneral.map((field) => ({ step: "general", label: field.label })),
        ...(video === "complete" ? [] : [{ step: "video", label: "Intro video" }]),
        ...missingDocuments(application.documents).map((document) => ({ step: "documents", label: document.label })),
    ];
    const sections = [
        {
            id: "general",
            label: "Application",
            state: general,
            detail: general === "complete"
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
            detail: documents === "complete"
                ? "Complete"
                : `${requiredDocuments.length - uploadedDocuments.length} missing`,
        },
    ];
    return {
        percent: Math.max(0, Math.min(100, percent)),
        sections,
        missingItems,
        isComplete: missingItems.length === 0,
    };
}
/** First section the candidate still has to deal with — drives "Continue". */
function nextIncompleteSection(application) {
    const progress = computeApplicationProgress(application);
    return progress.missingItems[0]?.step ?? null;
}
/** The step the "Continue application" button should open. */
function resumeStep(application) {
    if (application.status !== "draft")
        return "submitted";
    return nextIncompleteSection(application) ?? "review";
}
/**
 * Short line shown on dashboard cards: what the reviewer should do next, or
 * what is blocking the candidate.
 */
function nextActionLabel(application, progress) {
    // Only the draft branch needs progress; callers that already have it (the
    // card, the detail) pass it in to avoid a second full computation.
    const resolved = application.status === "draft" ? (progress ?? computeApplicationProgress(application)) : null;
    switch (application.status) {
        case "draft": {
            const missingCount = resolved?.missingItems.length ?? 0;
            return missingCount > 0
                ? `Candidate has ${missingCount} item${missingCount === 1 ? "" : "s"} left`
                : "Waiting for the candidate to submit";
        }
        case "needs_information":
            return application.pendingRequest ?? "Waiting on the candidate";
        case "submitted":
            return "Start review";
        case "ready_for_review":
            return "Ready for review";
        case "approved":
            return "Send operating agreement";
        case "agreement_pending":
            return exports.AGREEMENT_STATUS_META[application.agreement.status].label;
        case "payroll_in_progress":
            return "Finish payroll and mark hired";
        case "hired":
            return "Onboarded";
        case "archived":
            return "Archived";
    }
}
/** Statuses a reviewer can act on — everything else is terminal for now. */
function canApprove(status) {
    return status === "submitted" || status === "ready_for_review" || status === "needs_information";
}
function canRequestInfo(status) {
    return (status === "draft" ||
        status === "submitted" ||
        status === "needs_information" ||
        status === "ready_for_review" ||
        status === "approved" ||
        status === "agreement_pending");
}
/** The internal final step, available once the signed agreement reaches payroll. */
function canMarkHired(status) {
    return status === "payroll_in_progress";
}
/**
 * True once a candidate is approved but hasn't signed yet — the reviewer's
 * next step is to make sure they got the link, or send a fresh one if it
 * expired. Drives the "needs attention" badge on the card and detail screen.
 */
function needsAgreementAttention(application) {
    return application.status === "approved" && application.agreement.status !== "signed";
}
function canArchive(status) {
    return status !== "archived";
}
function canUnarchive(status) {
    return status === "archived";
}
/** Where an unarchive lands when there is no (or an unrecognized) saved `previousStatus`. */
exports.UNARCHIVE_FALLBACK_STATUS = "submitted";
/** Guards a persisted `previousStatus` before it is trusted as a restore target. */
function resolveUnarchiveStatus(previousStatus) {
    return previousStatus && exports.APPLICATION_STATUS_ORDER.includes(previousStatus) && previousStatus !== "archived"
        ? previousStatus
        : exports.UNARCHIVE_FALLBACK_STATUS;
}
/** Shorter windows for the riskier purposes — signing is the shortest. */
exports.LINK_EXPIRY_DAYS = {
    application: 14,
    step: 7,
    agreement: 3,
};
exports.LINK_PURPOSE_META = {
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
};
function linkState(link, now = new Date()) {
    if (link.revokedAt)
        return "revoked";
    return new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}
function daysUntilExpiry(link, now = new Date()) {
    const ms = new Date(link.expiresAt).getTime() - now.getTime();
    return Math.max(0, Math.ceil(ms / 86_400_000));
}
/** Short line for the share sheet: "Expires in 6 days" / "Expired". */
function describeLinkExpiry(link, now = new Date()) {
    const state = linkState(link, now);
    if (state === "revoked")
        return "Revoked";
    if (state === "expired")
        return "Expired";
    const days = daysUntilExpiry(link, now);
    if (days <= 1)
        return "Expires within a day";
    return `Expires in ${days} days`;
}
function createApplicationLink(input) {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + exports.LINK_EXPIRY_DAYS[input.purpose] * 86_400_000);
    return {
        token: input.token,
        applicationId: input.applicationId,
        purpose: input.purpose,
        step: input.purpose === "step" ? (input.step ?? null) : null,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
        usedCount: 0,
    };
}
/** The URL that gets shared. Origin is injected so this stays testable. */
function applicationLinkUrl(token, origin = "") {
    const base = origin.replace(/\/+$/, "");
    return `${base}/?apply=${token}`;
}
/**
 * Deterministic per-application candidate uid. The `cand_` prefix keeps it in
 * a namespace that can never collide with a real SVC user's Firebase uid, and
 * making it stable means reopening the same link resumes the same identity.
 */
function candidateUid(applicationId) {
    return `cand_${applicationId}`;
}
/** Server-side gate before a token is turned into a session. Pure so it's tested. */
function resolveLink(link, now = new Date()) {
    if (!link)
        return { ok: false, reason: "not_found" };
    const state = linkState(link, now);
    if (state === "revoked")
        return { ok: false, reason: "revoked" };
    if (state === "expired")
        return { ok: false, reason: "expired" };
    return { ok: true, link };
}
exports.LINK_RESOLUTION_MESSAGE = {
    not_found: "This link is not valid. Ask your SVC contact for a new one.",
    revoked: "This link was turned off. Ask your SVC contact for a new one.",
    expired: "This link has expired. Ask your SVC contact for a new one.",
};
// ── Request information ─────────────────────────────────────────────────
exports.REQUEST_MESSAGE_MAX = 300;
/**
 * What a reviewer can ask a candidate for, in the order they should read:
 * blocking documents first, then the video, then the soft asks.
 */
function requestableItems(application) {
    const items = application.documents
        .filter((document) => document.required)
        .map((document) => ({
        id: document.id,
        label: document.label,
        requirement: "Required",
        missing: document.status === "missing",
    }));
    if (videoState(application.video) !== "complete") {
        items.push({ id: "intro-video", label: "Intro video", requirement: "Required", missing: true });
    }
    if (!application.general.workReference?.trim()) {
        items.push({ id: "work-reference", label: "Work reference", requirement: "Helpful", missing: false });
    }
    if (!application.general.resumeFileName?.trim()) {
        items.push({ id: "resume", label: "Résumé", requirement: "Helpful", missing: false });
    }
    if (application.agreement.status !== "signed") {
        items.push({ id: "operating-agreement", label: "Operating agreement", requirement: "Required", missing: false });
    }
    return items;
}
/** Default message body — reviewers can edit it before sending. */
function composeRequestMessage(candidateName, labels, link = "") {
    const firstName = candidateName.trim().split(/\s+/)[0] || "there";
    const suffix = link ? `\n\n${link}` : "";
    if (labels.length === 0)
        return `Hi ${firstName},\n\n${suffix.trim()}`;
    const list = labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
    return `Hi ${firstName},\n\nPlease upload your ${list} using the secure link below. Thank you!${suffix}`;
}
function emptyFilters() {
    return { query: "", status: "all", jobId: "all", trade: "all" };
}
function filterApplications(applications, filters) {
    const query = filters.query.trim().toLowerCase();
    return applications.filter((application) => {
        if (filters.status !== "all" && application.status !== filters.status)
            return false;
        if (filters.jobId !== "all" && application.job.id !== filters.jobId)
            return false;
        if (filters.trade !== "all" && application.trade !== filters.trade)
            return false;
        if (!query)
            return true;
        return (application.candidateName.toLowerCase().includes(query) ||
            application.trade.toLowerCase().includes(query) ||
            application.job.name.toLowerCase().includes(query) ||
            application.job.companyName.toLowerCase().includes(query));
    });
}
function summarizeApplications(applications) {
    return {
        newCount: applications.filter((application) => application.status === "submitted").length,
        needsReview: applications.filter((application) => application.status === "ready_for_review").length,
        missingItems: applications.filter((application) => application.status === "needs_information" || computeApplicationProgress(application).missingItems.length > 0).length,
        approved: applications.filter((application) => application.status === "approved" ||
            application.status === "agreement_pending" ||
            application.status === "payroll_in_progress" ||
            application.status === "hired").length,
    };
}
// ── Formatting helpers ──────────────────────────────────────────────────
function formatApplicationDate(iso) {
    if (!iso)
        return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "—";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatRelativeDate(iso, now = new Date()) {
    if (!iso)
        return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return "—";
    const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
    if (days <= 0)
        return "Today";
    if (days === 1)
        return "Yesterday";
    if (days < 7)
        return `${days} days ago`;
    return formatApplicationDate(iso);
}
function initialsFor(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "?";
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
//# sourceMappingURL=applications-core.js.map