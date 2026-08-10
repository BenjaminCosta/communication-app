/**
 * SVC Quest Coral — framework-free core model.
 *
 * Single source of truth for project statuses, update types, progress math
 * and coverage derivation. Kept free of React and Firebase, same reasoning
 * as lib/applications-core.ts: the rules can run anywhere later without a
 * second implementation.
 *
 * This module deliberately does not talk to a backend. The dashboard selects
 * either the Firestore adapter or the local demo adapter around this model.
 */

export const QUEST_CORAL_SCHEMA_VERSION = 1

// ── Status model ────────────────────────────────────────────────────────

export type ProjectStatus = "planning" | "on_track" | "at_risk" | "completed"

/** Visual tone — maps to the Quest Coral palette in globals.css. */
export type QuestCoralTone = "neutral" | "info" | "pending" | "missing" | "complete" | "ai"

export interface StatusMeta {
  label: string
  tone: QuestCoralTone
  description: string
}

export const PROJECT_STATUS_META: Record<ProjectStatus, StatusMeta> = {
  planning: {
    label: "Planning",
    tone: "neutral",
    description: "Scoped but tracking hasn't started yet.",
  },
  on_track: {
    label: "On track",
    tone: "complete",
    description: "Moving at the expected pace, no open blockers.",
  },
  at_risk: {
    label: "At risk",
    tone: "pending",
    description: "Something is slowing this down and needs attention.",
  },
  completed: {
    label: "Completed",
    tone: "complete",
    description: "Done. Kept for reference.",
  },
}

/** Order used by the dashboard filter row. */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ["planning", "on_track", "at_risk", "completed"]

// ── Mission fit ─────────────────────────────────────────────────────────

export type MissionFitScore = 1 | 2 | 3 | 4 | 5

export function missionFitLabel(score: MissionFitScore): "Low" | "Medium" | "High" {
  if (score >= 4) return "High"
  if (score >= 2) return "Medium"
  return "Low"
}

// ── Updates ─────────────────────────────────────────────────────────────

export type UpdateType = "update" | "feedback" | "blocker" | "red_team_review"

export interface UpdateTypeMeta {
  label: string
  tone: QuestCoralTone
  description: string
}

export const UPDATE_TYPE_META: Record<UpdateType, UpdateTypeMeta> = {
  update: {
    label: "Update",
    tone: "info",
    description: "What's new, what changed.",
  },
  feedback: {
    label: "Feedback",
    tone: "neutral",
    description: "Input from the team or a stakeholder.",
  },
  blocker: {
    label: "Blocker",
    tone: "missing",
    description: "Something is stuck and needs help.",
  },
  red_team_review: {
    label: "Red Team Review",
    tone: "pending",
    description: "A deliberately critical look — what could go wrong.",
  },
}

export const UPDATE_TYPE_ORDER: UpdateType[] = ["update", "feedback", "blocker", "red_team_review"]

export interface ProjectUpdate {
  id: string
  projectId: string
  type: UpdateType
  authorId: string
  authorName: string
  body: string
  status?: ProjectStatus
  progress?: number
  nextStep?: string
  nextStepDue?: string | null
  isBlocker: boolean
  createdAt: string
}

/**
 * An append-only reply to a Feedback activity, authored in Communications.
 * It deliberately stays separate from ProjectUpdate: replies are thread
 * conversation, not a new project signal or unread-count activity.
 */
export interface FeedbackReply {
  id: string
  projectId: string
  feedbackId: string
  authorId: string
  authorName: string
  body: string
  communicationMessageId: string
  replyToCommunicationMessageId: string
  createdAt: string
  imageUrl?: string
  imageName?: string
  fileUrl?: string
  fileName?: string
}

// ── Per-user unread activity ───────────────────────────────────────────

/**
 * A private reading marker for one user/project pair. `unreadCount` is a
 * materialized convenience value; `lastReadAt` remains the source used to
 * calculate it from the immutable activity feed.
 */
export interface ProjectUnreadState {
  projectId: string
  userId: string
  unreadCount: number
  lastReadAt: string | null
  updatedAt: string
}

/** Stable private document id for one user's state on one project. */
export function questCoralProjectUnreadStateId(userId: string, projectId: string): string {
  return `${userId}__${projectId}`
}

/**
 * Counts only other people's posted activity after this user's last read.
 * Project Context edits, AI output and project field edits never enter the
 * `ProjectUpdate` feed, so they cannot affect this number.
 */
export function countUnreadProjectActivities(
  updates: ProjectUpdate[],
  projectId: string,
  userId: string,
  lastReadAt: string | null | undefined,
): number {
  const lastReadMs = lastReadAt ? new Date(lastReadAt).getTime() : Number.NEGATIVE_INFINITY
  const safeLastReadMs = Number.isFinite(lastReadMs) ? lastReadMs : Number.NEGATIVE_INFINITY
  return updates.reduce((count, update) => {
    if (update.projectId !== projectId || update.authorId === userId) return count
    const createdAtMs = new Date(update.createdAt).getTime()
    return Number.isFinite(createdAtMs) && createdAtMs > safeLastReadMs ? count + 1 : count
  }, 0)
}

// ── Project timeline ────────────────────────────────────────────────────

export interface ProjectTimelinePhase {
  range: string
  items: string[]
}

export interface ProjectTimeline {
  past: ProjectTimelinePhase
  present: ProjectTimelinePhase
  future: ProjectTimelinePhase
}

// ── Project ─────────────────────────────────────────────────────────────

export interface ProjectPerson {
  id: string
  name: string
  initials: string
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  progress: number
  missionFitScore: MissionFitScore
  ownerId: string
  ownerName: string
  people: ProjectPerson[]
  nextStep: string | null
  nextStepDue: string | null
  timeline: ProjectTimeline | null
  createdAt: string
  updatedAt: string
  isFavorited?: boolean
}

export function blankProject(id: string, ownerId: string, ownerName: string): Project {
  const now = new Date().toISOString()
  return {
    id,
    name: "",
    description: "",
    status: "planning",
    progress: 0,
    missionFitScore: 3,
    ownerId,
    ownerName,
    people: [{ id: ownerId, name: ownerName, initials: initialsFromName(ownerName) }],
    nextStep: null,
    nextStepDue: null,
    timeline: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * The status a project should be treated as everywhere it's read: 100%
 * progress always reads as Completed, even on older records saved before
 * `useQuestCoralDashboard`'s `addUpdate` started forcing status to follow
 * progress. Read-side normalization rather than a data migration — no
 * stored record needs to change for every status badge, filter and stat to
 * agree. Use this instead of `project.status` directly wherever "is this
 * project done" matters; only the raw write path should read the field itself.
 */
export function effectiveProjectStatus(project: Project): ProjectStatus {
  return project.progress >= 100 ? "completed" : project.status
}

// ── Coverage (the "0°–360°" ring on the dashboard/detail) ───────────────
//
// A derived completeness read: how many of the tracked dimensions actually
// have something in them. Not a field anyone fills in by hand — computed
// from what's already on the project + its updates.

export interface CoverageResult {
  /** 0–360, one dimension per 60°. */
  degrees: number
  covered: number
  total: number
}

export function computeProjectCoverage(project: Project, updates: ProjectUpdate[]): CoverageResult {
  const projectUpdates = updates.filter((update) => update.projectId === project.id)
  const dimensions = [
    project.progress > 0,
    project.people.length > 1,
    project.missionFitScore >= 3,
    !projectUpdates.some((update) => update.isBlocker),
    projectUpdates.length > 0,
    projectUpdates.some((update) => update.type === "red_team_review"),
  ]
  const covered = dimensions.filter(Boolean).length
  const total = dimensions.length
  return { degrees: Math.round((covered / total) * 360), covered, total }
}

export function openBlockerCount(projectId: string, updates: ProjectUpdate[]): number {
  return updates.filter((update) => update.projectId === projectId && update.isBlocker).length
}

// ── Project context (the Markdown brief) ────────────────────────────────
//
// A per-project Markdown document a human writes/uploads to answer "what is
// this, really" — separate from the auto-generated AI brief and from the
// activity log. It is persisted independently from project records/updates so
// it can stay a focused, replaceable brief rather than a field that every
// project update rewrites.

export type ProjectContextSource = "manual" | "upload"

/** Matches the editor's allowance and keeps one context safely below Firestore's document limit. */
export const PROJECT_CONTEXT_MAX_CHARS = 12_000

export interface ProjectContext {
  projectId: string
  markdown: string
  updatedAt: string
  updatedBy: string
  source: ProjectContextSource
  /** Set only when source === "upload". */
  fileName?: string | null
}

export const PROJECT_CONTEXT_SECTIONS: Array<{ heading: string; hint: string }> = [
  { heading: "Purpose", hint: "Why this project exists, in a sentence or two." },
  { heading: "Problem it solves", hint: "The pain point or gap before this project started." },
  { heading: "Key question", hint: "The single question this project is trying to answer." },
  { heading: "Users", hint: "Who this is for, and who else is affected." },
  { heading: "How it works", hint: "The mechanics or approach, in plain language." },
  { heading: "Flows", hint: "The main paths people take through it, step by step." },
  { heading: "Features", hint: "What is actually built or planned." },
  { heading: "Decisions", hint: "Calls that were made on purpose, and why." },
  { heading: "Current state", hint: "Where things stand right now." },
  { heading: "Pending", hint: "What is still open or unresolved." },
]

/** Empty skeleton offered the first time a project has no context yet. */
export function blankProjectContextTemplate(): string {
  return PROJECT_CONTEXT_SECTIONS.map((section) => `## ${section.heading}\n\n`).join("\n")
}

export function contextSourceLabel(context: Pick<ProjectContext, "source" | "fileName">): string {
  if (context.source === "upload") return context.fileName ? `Uploaded · ${context.fileName}` : "Uploaded file"
  return "Written manually"
}

/** Plain-text excerpt for the summary card — strips Markdown syntax, no rendering. */
export function summarizeMarkdown(markdown: string, maxChars = 180): string {
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  if (plain.length <= maxChars) return plain
  const truncated = plain.slice(0, maxChars)
  const lastSpace = truncated.lastIndexOf(" ")
  return `${(lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trimEnd()}…`
}

// ── Mock seed data ──────────────────────────────────────────────────────

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-onboarding-redesign",
    name: "Customer Onboarding Redesign",
    description: "Improve activation and reduce churn during the first week.",
    status: "on_track",
    progress: 72,
    missionFitScore: 5,
    ownerId: "user-maya",
    ownerName: "Maya Lin",
    people: [
      { id: "user-maya", name: "Maya Lin", initials: "ML" },
      { id: "user-arjun", name: "Arjun Patel", initials: "AP" },
      { id: "user-jordan", name: "Jordan Torres", initials: "JT" },
      { id: "user-sam", name: "Sam Chen", initials: "SC" },
      { id: "user-priya", name: "Priya Shah", initials: "PS" },
      { id: "user-noah", name: "Noah Diaz", initials: "ND" },
      { id: "user-lee", name: "Lee Kim", initials: "LK" },
    ],
    nextStep: "User testing round 2",
    nextStepDue: "2026-08-02",
    timeline: {
      past: { range: "May – Jun", items: ["Research complete", "Stakeholders aligned"] },
      present: { range: "Jul – Aug", items: ["Usability testing", "Copy review"] },
      future: { range: "Sep", items: ["Rollout to all new signups"] },
    },
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-07-24T15:00:00.000Z",
    isFavorited: true,
  },
  {
    id: "proj-crew-scheduling",
    name: "Field Crew Scheduling Rollout",
    description: "Replace the spreadsheet hand-off with real-time crew scheduling.",
    status: "at_risk",
    progress: 41,
    missionFitScore: 4,
    ownerId: "user-arjun",
    ownerName: "Arjun Patel",
    people: [
      { id: "user-arjun", name: "Arjun Patel", initials: "AP" },
      { id: "user-noah", name: "Noah Diaz", initials: "ND" },
      { id: "user-priya", name: "Priya Shah", initials: "PS" },
    ],
    nextStep: "Backfill missing shift data",
    nextStepDue: "2026-08-04",
    timeline: {
      past: { range: "Jun", items: ["Vendor selected"] },
      present: { range: "Jul", items: ["Data migration", "Foreman training"] },
      future: { range: "Aug", items: ["Go-live for two crews"] },
    },
    createdAt: "2026-06-02T09:00:00.000Z",
    updatedAt: "2026-07-25T11:20:00.000Z",
  },
  {
    id: "proj-vendor-directory",
    name: "Vendor Directory Migration",
    description: "Bring vendor contacts into SVC Directory as the single source of truth.",
    status: "planning",
    progress: 15,
    missionFitScore: 3,
    ownerId: "user-sam",
    ownerName: "Sam Chen",
    people: [
      { id: "user-sam", name: "Sam Chen", initials: "SC" },
      { id: "user-lee", name: "Lee Kim", initials: "LK" },
    ],
    nextStep: "Finalize field mapping",
    nextStepDue: "2026-08-10",
    timeline: {
      past: { range: "Jul", items: ["Scope agreed"] },
      present: { range: "Jul – Aug", items: ["Field mapping"] },
      future: { range: "Sep", items: ["Import", "Dedupe pass"] },
    },
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  },
  {
    id: "proj-safety-audit",
    name: "Q3 Safety Compliance Audit",
    description: "Confirm every active job site meets the updated safety checklist.",
    status: "completed",
    progress: 100,
    missionFitScore: 5,
    ownerId: "user-priya",
    ownerName: "Priya Shah",
    people: [
      { id: "user-priya", name: "Priya Shah", initials: "PS" },
      { id: "user-jordan", name: "Jordan Torres", initials: "JT" },
      { id: "user-maya", name: "Maya Lin", initials: "ML" },
    ],
    nextStep: null,
    nextStepDue: null,
    timeline: {
      past: { range: "May – Jul", items: ["All sites inspected", "Findings closed out"] },
      present: { range: "Jul", items: ["Sign-off filed"] },
      future: { range: "—", items: [] },
    },
    createdAt: "2026-05-15T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
  },
  {
    id: "proj-timesheet-revamp",
    name: "Mobile Timesheet Revamp",
    description: "Cut clock-in time and stop the weekly timesheet disputes.",
    status: "on_track",
    progress: 58,
    missionFitScore: 4,
    ownerId: "user-jordan",
    ownerName: "Jordan Torres",
    people: [
      { id: "user-jordan", name: "Jordan Torres", initials: "JT" },
      { id: "user-noah", name: "Noah Diaz", initials: "ND" },
    ],
    nextStep: "Ship beta to 10 crews",
    nextStepDue: "2026-08-08",
    timeline: {
      past: { range: "Jun", items: ["Prototype tested"] },
      present: { range: "Jul", items: ["Beta build", "Red Team Review"] },
      future: { range: "Aug – Sep", items: ["Full crew rollout"] },
    },
    createdAt: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-07-26T14:00:00.000Z",
  },
]

export const MOCK_UPDATES: ProjectUpdate[] = [
  {
    id: "upd-1",
    projectId: "proj-onboarding-redesign",
    type: "update",
    authorId: "user-arjun",
    authorName: "Arjun Patel",
    body: "Completed first round of usability testing. Insights documented.",
    status: "on_track",
    progress: 72,
    nextStep: "User testing round 2",
    nextStepDue: "2026-08-02",
    isBlocker: false,
    createdAt: "2026-07-24T15:00:00.000Z",
  },
  {
    id: "upd-2",
    projectId: "proj-onboarding-redesign",
    type: "blocker",
    authorId: "user-maya",
    authorName: "Maya Lin",
    body: "API rate limits are causing delays during the onboarding flow's identity check.",
    isBlocker: true,
    createdAt: "2026-07-22T10:30:00.000Z",
  },
  {
    id: "upd-3",
    projectId: "proj-onboarding-redesign",
    type: "red_team_review",
    authorId: "user-sam",
    authorName: "Sam Chen",
    body: "If the rate-limit issue isn't fixed before rollout, the whole activation funnel takes the hit, not just onboarding.",
    isBlocker: false,
    createdAt: "2026-07-20T09:15:00.000Z",
  },
  {
    id: "upd-4",
    projectId: "proj-crew-scheduling",
    type: "blocker",
    authorId: "user-noah",
    authorName: "Noah Diaz",
    body: "Two years of shift history are missing from the export — scheduling can't go live without it.",
    isBlocker: true,
    createdAt: "2026-07-25T11:20:00.000Z",
  },
  {
    id: "upd-5",
    projectId: "proj-crew-scheduling",
    type: "feedback",
    authorId: "user-priya",
    authorName: "Priya Shah",
    body: "Foremen liked the mobile check-in but want a faster way to swap two crew members.",
    isBlocker: false,
    createdAt: "2026-07-21T16:00:00.000Z",
  },
  {
    id: "upd-6",
    projectId: "proj-timesheet-revamp",
    type: "red_team_review",
    authorId: "user-noah",
    authorName: "Noah Diaz",
    body: "Offline clock-ins could double-submit if connectivity flaps mid-shift — needs a dedupe check before beta.",
    isBlocker: false,
    createdAt: "2026-07-26T14:00:00.000Z",
  },
  {
    id: "upd-7",
    projectId: "proj-timesheet-revamp",
    type: "update",
    authorId: "user-jordan",
    authorName: "Jordan Torres",
    body: "Beta build is stable in the test environment. Lining up 10 crews for next week.",
    status: "on_track",
    progress: 58,
    nextStep: "Ship beta to 10 crews",
    nextStepDue: "2026-08-08",
    isBlocker: false,
    createdAt: "2026-07-24T09:00:00.000Z",
  },
  {
    id: "upd-8",
    projectId: "proj-safety-audit",
    type: "update",
    authorId: "user-priya",
    authorName: "Priya Shah",
    body: "Last site signed off. Filing the quarterly report today.",
    status: "completed",
    progress: 100,
    isBlocker: false,
    createdAt: "2026-07-18T09:00:00.000Z",
  },
]

export const MOCK_PROJECT_CONTEXTS: ProjectContext[] = [
  {
    projectId: "proj-onboarding-redesign",
    updatedAt: "2026-07-24T16:10:00.000Z",
    updatedBy: "Maya Lin",
    source: "manual",
    markdown: `## Purpose

Get new customers to their first real win inside the product during week one, instead of losing them to a confusing setup.

## Problem it solves

Roughly 4 in 10 new signups never finish setup, and support tickets in week one are dominated by "what do I do next" questions. The old onboarding was a single long form with no sense of progress.

## Key question

If we show people the smallest possible path to value, does activation go up without adding more steps?

## Users

New customers in their first 7 days, plus the support team who currently absorbs the confusion as tickets.

## How it works

A guided checklist replaces the long form. Each step unlocks the next, progress is always visible, and the identity check happens in the background instead of blocking the next step.

## Flows

- Sign up → guided checklist (3 steps) → first meaningful action → confirmation
- Stalled user (24h idle) → reminder nudge → resume where they left off

## Features

- Step-by-step checklist with visible progress
- Background identity verification (no more blocking screen)
- Resume-where-you-left-off state, even across devices

## Decisions

- Cut the form from 12 fields to 4 up front; the rest is collected contextually later.
- Identity check moved off the critical path after round 1 testing showed it as the main drop-off point.

## Current state

Usability testing round 1 is complete and insights are documented. Round 2 is scheduled next. The API rate-limit issue on the identity check (see current blocker) needs a fix before this can roll out broadly.

## Pending

- Resolve the identity-check rate-limit blocker
- Finish round 2 usability testing
- Decide on the copy for the stalled-user nudge`,
  },
  {
    projectId: "proj-crew-scheduling",
    updatedAt: "2026-07-25T11:45:00.000Z",
    updatedBy: "Arjun Patel",
    source: "manual",
    markdown: `## Purpose

Replace the weekly spreadsheet hand-off with a system foremen and crews can actually trust in real time.

## Problem it solves

Schedules live in a spreadsheet that's emailed around and goes stale within hours. Crews show up to the wrong site, and foremen spend Monday mornings untangling last-minute swaps by phone.

## Key question

Can a mobile-first schedule stay accurate enough, in real time, that people stop double-checking it against a phone call?

## Users

Foremen who build the schedule, field crews who read it, and dispatch who currently fields the "where do I go" calls.

## How it works

Foremen assign crews to sites for the week; each crew sees only their own upcoming shifts on their phone. Changes push instantly instead of waiting for the next spreadsheet email.

## Flows

- Foreman builds week → crew gets push notification → crew checks in on-site
- Foreman swaps two crew members → both notified instantly → dispatch sees the change logged

## Features

- Mobile check-in per shift
- Real-time schedule with push updates
- Vendor-provided shift history import (in progress)

## Decisions

- Chose a vendor for the scheduling backend instead of building shift math in-house — faster to trust for something safety-adjacent.
- Crew swap has to be two-sided (both people notified) after early feedback that one-sided swaps caused no-shows.

## Current state

Vendor is selected, data migration and foreman training are underway. Two years of shift history are missing from the export, which is currently blocking go-live.

## Pending

- Recover or backfill the missing shift history
- Build the faster two-person swap flow foremen asked for
- Pick the two crews for the initial go-live`,
  },
  {
    projectId: "proj-vendor-directory",
    updatedAt: "2026-07-20T09:30:00.000Z",
    updatedBy: "Sam Chen",
    source: "upload",
    fileName: "vendor-directory-brief.md",
    markdown: `## Purpose

Make SVC Directory the single place to look up a vendor — no more asking around for "does anyone have their number."

## Problem it solves

Vendor contacts are scattered across personal phones, a shared spreadsheet, and old email threads. Nobody trusts any one source is current.

## Key question

Once vendors live in Directory alongside people, do the old spreadsheets actually get abandoned, or do they linger?

## Users

Anyone who books or coordinates with an outside vendor — mostly ops and field leads.

## How it works

Vendor contacts are imported into Directory with the same shape as a person contact, tagged as a vendor so they're filterable separately.

## Flows

- Import batch → field mapping review → dedupe pass → vendors appear in Directory search

## Features

- Vendor-tagged contact records
- Field mapping tool for the import
- Dedupe pass against existing Directory entries

## Decisions

- Vendors reuse the existing Contact shape instead of a new entity — less to maintain, and Directory search already works.

## Current state

Scope is agreed and field mapping is in progress. Import and the dedupe pass are the next milestones.

## Pending

- Finish field mapping
- Run the import
- Dedupe against existing entries
- Decide who "owns" a vendor record going forward`,
  },
  {
    projectId: "proj-safety-audit",
    updatedAt: "2026-07-18T09:20:00.000Z",
    updatedBy: "Priya Shah",
    source: "manual",
    markdown: `## Purpose

Confirm every active job site meets the updated safety checklist before the quarter closes.

## Problem it solves

The safety checklist changed this quarter, and there was no single record confirming every site had actually been re-checked against it.

## Key question

Are all active sites compliant with the updated checklist, and where's the paper trail if someone asks?

## Users

Site inspectors doing the walkthroughs, and leadership who needs the sign-off for the quarterly report.

## How it works

Each site gets a physical walkthrough against the updated checklist; findings are logged and closed out before the site counts as compliant.

## Flows

- Site visit → checklist walkthrough → findings logged → findings closed → sign-off filed

## Features

- Standardized checklist per site
- Findings log with close-out tracking
- Quarterly sign-off report

## Decisions

- Every site required a fresh in-person visit rather than a self-report from site leads, after last quarter's self-reports missed two real issues.

## Current state

Every site has been inspected and all findings closed out. The quarterly sign-off report was filed today. This project is complete.

## Pending

None — kept for reference ahead of next quarter's audit.`,
  },
  {
    projectId: "proj-timesheet-revamp",
    updatedAt: "2026-07-26T14:20:00.000Z",
    updatedBy: "Jordan Torres",
    source: "upload",
    fileName: "timesheet-revamp-context.md",
    markdown: `## Purpose

Cut how long it takes crews to clock in, and stop the weekly arguments over what a timesheet actually said.

## Problem it solves

Clock-in on the old system takes long enough that crews started clocking in for each other, which is exactly the kind of thing that turns into a dispute later. Weekly timesheet reviews were dominated by "that's not what I worked."

## Key question

If clock-in takes seconds instead of minutes, does the dispute rate at weekly review actually drop?

## Users

Field crews clocking in and out daily, and whoever reconciles timesheets weekly.

## How it works

A lightweight mobile clock-in replaces the old flow, built to also work with flaky site connectivity.

## Flows

- Crew member opens app on-site → clocks in → clocks out at end of shift → timesheet auto-populates for review

## Features

- One-tap mobile clock-in/out
- Offline-tolerant sync
- Weekly timesheet auto-populated from clock events

## Decisions

- Built for offline-first from the start, because half the job sites have poor signal — this wasn't optional.

## Current state

Beta build is stable in the test environment, with 10 crews lined up for next week's rollout. The Red Team Review flagged that offline clock-ins could double-submit if connectivity flaps mid-shift — a dedupe check is needed before beta ships wider.

## Pending

- Ship the dedupe check for offline double-submits
- Roll out beta to the 10 lined-up crews
- Decide on the go/no-go criteria for full crew rollout`,
  },
]
