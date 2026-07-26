import assert from "node:assert/strict"
import test from "node:test"
import {
  APPLICATION_STATUS_META,
  CANDIDATE_STEP_ORDER,
  applicationLinkUrl,
  blankApplication,
  canApprove,
  canMarkHired,
  candidateStep,
  candidateUid,
  composeRequestMessage,
  computeApplicationProgress,
  createApplicationLink,
  daysUntilExpiry,
  describeLinkExpiry,
  emptyGeneralApplication,
  emptyIntroVideo,
  emptySignatureDraft,
  filterApplications,
  emptyFilters,
  GENERAL_FIELDS,
  initialsFor,
  linkState,
  missingGeneralFields,
  nameMatches,
  nextCandidateStep,
  nextIncompleteSection,
  previousCandidateStep,
  requestableItems,
  resolveLink,
  resumeStep,
  signatureReadiness,
  standardDocuments,
  summarizeApplications,
  type CandidateApplication,
} from "../lib/applications-core"
import { applicationToFirestore, linkToFirestore, mapApplicationDoc } from "../lib/applications-store"

function application(overrides: Partial<CandidateApplication> = {}): CandidateApplication {
  return {
    id: "app-1",
    linkToken: "token",
    candidateName: "Benjamin Lopez",
    trade: "Carpenter",
    job: { id: "job-1", name: "RW Dake Construction", location: "Morrow, GA", companyName: "RW Dake Construction" },
    status: "draft",
    general: emptyGeneralApplication(),
    video: emptyIntroVideo(),
    documents: standardDocuments(),
    agreement: { status: "locked", sentAt: null, signedAt: null, expiresAt: null },
    activity: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    submittedAt: null,
    pendingRequest: null,
    ...overrides,
  }
}

function completeGeneral() {
  return GENERAL_FIELDS.reduce<Record<string, string>>((draft, field) => {
    draft[field.id] = field.id === "primaryTrade" ? "Carpenter" : "filled"
    return draft
  }, {}) as CandidateApplication["general"]
}

test("an untouched application reports 0% and every required item missing", () => {
  const progress = computeApplicationProgress(application())
  assert.equal(progress.percent, 0)
  assert.equal(progress.isComplete, false)
  // 8 required general fields + intro video + 2 documents
  assert.equal(progress.missingItems.length, missingGeneralFields(emptyGeneralApplication()).length + 3)
  assert.equal(progress.sections.every((section) => section.state === "not_started"), true)
})

test("a fully completed application reports 100% and nothing missing", () => {
  const progress = computeApplicationProgress(
    application({
      general: completeGeneral(),
      video: { ...emptyIntroVideo(), state: "ready" },
      documents: standardDocuments().map((document) => ({ ...document, status: "uploaded", fileName: "f.jpg" })),
    }),
  )
  assert.equal(progress.percent, 100)
  assert.equal(progress.isComplete, true)
  assert.deepEqual(progress.missingItems, [])
})

test("a not-required document is shown without blocking the application", () => {
  const documents = [
    ...standardDocuments().map((document) => ({ ...document, status: "verified" as const, fileName: "verified.jpg" })),
    {
      id: "project-document",
      label: "Project document",
      helper: "Not needed for this job.",
      required: false,
      status: "not_required" as const,
      fileName: null,
      uploadedAt: null,
      storagePath: null,
      downloadUrl: null,
      origin: "job" as const,
    },
  ]
  const progress = computeApplicationProgress(
    application({ general: completeGeneral(), video: { ...emptyIntroVideo(), state: "ready" }, documents }),
  )
  assert.equal(progress.percent, 100)
  assert.equal(progress.missingItems.some((item) => item.label === "Project document"), false)
})

test("section weights add up and partial progress stays between the bounds", () => {
  const progress = computeApplicationProgress(
    application({ general: completeGeneral(), video: emptyIntroVideo(), documents: standardDocuments() }),
  )
  // General alone is worth 45.
  assert.equal(progress.percent, 45)
  assert.equal(progress.sections[0].state, "complete")
  assert.equal(progress.sections[2].detail, "2 missing")
})

test("resume jumps to the first incomplete section, then to review", () => {
  assert.equal(resumeStep(application()), "general")
  assert.equal(resumeStep(application({ general: completeGeneral() })), "video")
  const ready = application({
    general: completeGeneral(),
    video: { ...emptyIntroVideo(), state: "ready" },
    documents: standardDocuments().map((document) => ({ ...document, status: "verified" })),
  })
  assert.equal(nextIncompleteSection(ready), null)
  assert.equal(resumeStep(ready), "review")
  // Once submitted, the link opens the confirmation instead of the form.
  assert.equal(resumeStep({ ...ready, status: "submitted" }), "submitted")
})

test("filters combine query, status, job and trade", () => {
  const list = [
    application({ id: "a", candidateName: "Benjamin Lopez", trade: "Carpenter", status: "submitted" }),
    application({ id: "b", candidateName: "Tasha Williams", trade: "Equipment operator", status: "approved" }),
  ]
  assert.equal(filterApplications(list, { ...emptyFilters(), query: "tasha" }).length, 1)
  assert.equal(filterApplications(list, { ...emptyFilters(), status: "approved" })[0].id, "b")
  assert.equal(filterApplications(list, { ...emptyFilters(), trade: "Carpenter" })[0].id, "a")
  assert.equal(filterApplications(list, { ...emptyFilters(), query: "rw dake" }).length, 2)
  assert.equal(filterApplications(list, { ...emptyFilters(), status: "archived" }).length, 0)
})

test("dashboard counters bucket by status", () => {
  const counts = summarizeApplications([
    application({ status: "submitted", general: completeGeneral() }),
    application({ status: "ready_for_review" }),
    application({ status: "needs_information" }),
    application({ status: "hired" }),
  ])
  assert.equal(counts.newCount, 1)
  assert.equal(counts.needsReview, 1)
  assert.equal(counts.approved, 1)
  assert.ok(counts.missingItems >= 1)
})

test("approval is only offered on reviewable statuses", () => {
  assert.equal(canApprove("submitted"), true)
  assert.equal(canApprove("ready_for_review"), true)
  assert.equal(canApprove("archived"), false)
  assert.equal(canApprove("hired"), false)
})

test("payroll completion is the only path to the hired action", () => {
  assert.equal(canMarkHired("approved"), false)
  assert.equal(canMarkHired("payroll_in_progress"), true)
  assert.equal(canMarkHired("hired"), false)
})

test("every status has display metadata", () => {
  for (const status of Object.keys(APPLICATION_STATUS_META)) {
    const meta = APPLICATION_STATUS_META[status as keyof typeof APPLICATION_STATUS_META]
    assert.ok(meta.label.length > 0)
    assert.ok(meta.description.length > 0)
  }
})

test("request items preselect only what is genuinely missing", () => {
  const items = requestableItems(application())
  const preselected = items.filter((item) => item.missing).map((item) => item.id)
  // Both standard documents plus the intro video are outstanding.
  assert.deepEqual(preselected, ["drivers-license", "osha-card", "intro-video"])
  // Soft asks are offered but never preselected.
  assert.equal(items.find((item) => item.id === "resume")?.requirement, "Helpful")
  assert.equal(items.find((item) => item.id === "resume")?.missing, false)
  assert.ok(items.some((item) => item.id === "operating-agreement"))
})

test("request items drop what the candidate already provided", () => {
  const items = requestableItems(
    application({
      general: completeGeneral(),
      video: { ...emptyIntroVideo(), state: "ready" },
      documents: standardDocuments().map((document) => ({ ...document, status: "verified" })),
      agreement: { status: "signed", sentAt: null, signedAt: "2026-07-02T00:00:00.000Z", expiresAt: null },
    }),
  )
  assert.equal(items.every((item) => !item.missing), true)
  assert.equal(items.some((item) => item.id === "intro-video"), false)
  assert.equal(items.some((item) => item.id === "operating-agreement"), false)
})

test("the default request message names the candidate and the items", () => {
  assert.equal(
    composeRequestMessage("Benjamin Lopez", ["Driver's license"]),
    "Hi Benjamin,\n\nPlease upload your Driver's license using the secure link below. Thank you!",
  )
  assert.match(composeRequestMessage("Tasha Williams", ["A", "B", "C"]), /your A, B and C using/)
  assert.equal(composeRequestMessage("", []).startsWith("Hi there,"), true)
})

test("link expiry is shorter for the riskier purposes", () => {
  const now = new Date("2026-07-20T12:00:00.000Z")
  const application = createApplicationLink({ applicationId: "a", purpose: "application", token: "t1", now })
  const step = createApplicationLink({ applicationId: "a", purpose: "step", step: "documents", token: "t2", now })
  const agreement = createApplicationLink({ applicationId: "a", purpose: "agreement", token: "t3", now })

  assert.equal(daysUntilExpiry(application, now), 14)
  assert.equal(daysUntilExpiry(step, now), 7)
  assert.equal(daysUntilExpiry(agreement, now), 3)
  // The step only exists on step links — the other purposes ignore it.
  assert.equal(step.step, "documents")
  assert.equal(application.step, null)
})

test("link state reflects revocation and expiry", () => {
  const now = new Date("2026-07-20T12:00:00.000Z")
  const link = createApplicationLink({ applicationId: "a", purpose: "step", token: "t", now })
  assert.equal(linkState(link, now), "active")
  assert.equal(describeLinkExpiry(link, now), "Expires in 7 days")

  const later = new Date("2026-07-28T12:00:00.000Z")
  assert.equal(linkState(link, later), "expired")
  assert.equal(describeLinkExpiry(link, later), "Expired")

  // Revocation wins over a still-valid window.
  assert.equal(linkState({ ...link, revokedAt: now.toISOString() }, now), "revoked")
})

test("the shared URL carries only the token", () => {
  assert.equal(applicationLinkUrl("a7f3k2", "https://svc.app"), "https://svc.app/?apply=a7f3k2")
  // Trailing slashes in the origin never double up.
  assert.equal(applicationLinkUrl("a7f3k2", "https://svc.app/"), "https://svc.app/?apply=a7f3k2")
})

test("the request message appends the direct link", () => {
  const message = composeRequestMessage("Marcus Johnson", ["Driver's license"], "https://svc.app/?apply=x1")
  assert.match(message, /^Hi Marcus,/)
  assert.match(message, /https:\/\/svc\.app\/\?apply=x1$/)
})

test("signing requires reading, consent, a matching name and a stroke", () => {
  const draft = emptySignatureDraft()
  assert.equal(signatureReadiness(draft, "Benjamin Lopez").ready, false)
  assert.deepEqual(signatureReadiness(draft, "Benjamin Lopez").pending, [
    "Read to the end of the agreement",
    "Agree to sign electronically",
    "Type your full name",
    "Draw your signature",
  ])

  const complete = { reachedEnd: true, consent: true, typedName: "benjamin  lópez", hasSignature: true }
  // Case, accents and extra spaces don't block a genuine match.
  assert.equal(signatureReadiness(complete, "Benjamin Lopez").ready, true)

  const wrongName = { ...complete, typedName: "Someone Else" }
  assert.deepEqual(signatureReadiness(wrongName, "Benjamin Lopez").pending, ["Type your name as it appears above"])
})

test("a name is only accepted when it matches the candidate on file", () => {
  assert.equal(nameMatches("Benjamin Lopez", "benjamin lopez"), true)
  assert.equal(nameMatches("  Benjamin   Lopez  ", "Benjamin Lopez"), true)
  assert.equal(nameMatches("Ben Lopez", "Benjamin Lopez"), false)
  assert.equal(nameMatches("", "Benjamin Lopez"), false)
  // With nothing on file, any real name passes.
  assert.equal(nameMatches("Benjamin Lopez", ""), true)
})

test("resolveLink gates every invalid link state", () => {
  const now = new Date("2026-07-20T12:00:00.000Z")
  const active = createApplicationLink({ applicationId: "a", purpose: "application", token: "t", now })

  const notFound = resolveLink(null)
  assert.equal(notFound.ok, false)
  assert.equal(notFound.ok === false && notFound.reason, "not_found")
  assert.equal(resolveLink(active, now).ok, true)

  const revoked = { ...active, revokedAt: now.toISOString() }
  const revokedResult = resolveLink(revoked, now)
  assert.equal(revokedResult.ok === false && revokedResult.reason, "revoked")

  const later = new Date("2026-08-20T12:00:00.000Z")
  const expiredResult = resolveLink(active, later)
  assert.equal(expiredResult.ok === false && expiredResult.reason, "expired")
})

test("a blank invite prefills the reviewer's details into the draft", () => {
  const app = blankApplication("app-x", "tok-x", { candidateName: "Dana Price", trade: "Painter", jobName: "Lakeview Build" })
  assert.equal(app.candidateName, "Dana Price")
  assert.equal(app.trade, "Painter")
  assert.equal(app.general.fullName, "Dana Price")
  assert.equal(app.general.primaryTrade, "Painter")
  assert.equal(app.job.name, "Lakeview Build")
  assert.equal(app.status, "draft")
  // A truly empty invite is still valid.
  const empty = blankApplication("app-y", "tok-y")
  assert.equal(empty.candidateName, "")
  assert.equal(empty.documents.length, standardDocuments().length)
})

test("uploaded documents and video carry their storage metadata", () => {
  const [doc] = standardDocuments()
  assert.equal(doc.storagePath, null)
  assert.equal(doc.downloadUrl, null)
  const video = emptyIntroVideo()
  assert.equal(video.storagePath, null)
  assert.equal(video.downloadUrl, null)
})

test("Firestore records never retain raw application link tokens", () => {
  const storedApplication = applicationToFirestore(application({ linkToken: "bearer-secret" }))
  assert.equal(Object.hasOwn(storedApplication, "linkToken"), false)

  const link = createApplicationLink({ applicationId: "app-1", purpose: "application", token: "bearer-secret" })
  const storedLink = linkToFirestore(link)
  assert.equal(Object.hasOwn(storedLink, "token"), false)

  // Legacy fields are deliberately not exposed by the read mapper either.
  assert.equal(mapApplicationDoc("app-1", { linkToken: "legacy-secret" }).linkToken, "")
})

test("candidate uid is stable and namespaced away from real users", () => {
  assert.equal(candidateUid("app-benjamin-lopez"), "cand_app-benjamin-lopez")
  // Stable across calls so reopening a link resumes the same identity.
  assert.equal(candidateUid("x"), candidateUid("x"))
  assert.ok(candidateUid("x").startsWith("cand_"))
})

test("the agreement steps stay out of the linear application flow", () => {
  assert.equal(CANDIDATE_STEP_ORDER.includes("agreement"), false)
  assert.equal(nextCandidateStep("submitted"), null)
  assert.equal(previousCandidateStep("agreement"), null)
  assert.equal(candidateStep("agreement").index, null)
})

test("initials handle single and multi-word names", () => {
  assert.equal(initialsFor("Benjamin Lopez"), "BL")
  assert.equal(initialsFor("Cher"), "CH")
  assert.equal(initialsFor("  "), "?")
})
