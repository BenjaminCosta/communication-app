/**
 * Mock "AI" for Quest Coral (Phase 1 — no OpenAI call yet).
 *
 * Generates the AI Project Brief and answers "Ask AI about this project"
 * from the project's own fields — same role AiSummaryCard plays in
 * Applications today. When Phase 3 wires a real model, this file is what
 * gets swapped for a call through lib/ai/ (see docs/svc-outlook-ai-handoff.md
 * for that runbook); the hook's contract (question/phase/answer) stays put.
 */

import { effectiveProjectStatus, PROJECT_STATUS_META, missionFitLabel, openBlockerCount, type FeedbackReply, type RedTeamReviewReply, type Project, type ProjectUpdate } from "@/lib/quest-coral-core"

function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null
  return Math.round((new Date(dateIso).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function formatDue(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function latestUpdate(projectId: string, updates: ProjectUpdate[]): ProjectUpdate | null {
  return (
    updates
      .filter((update) => update.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

export function generateProjectBrief(project: Project, updates: ProjectUpdate[], contextMarkdown?: string | null, feedbackReplies: FeedbackReply[] = [], redTeamReviewReplies: RedTeamReviewReply[] = []): string {
  const statusMeta = PROJECT_STATUS_META[effectiveProjectStatus(project)]
  const blockers = openBlockerCount(project.id, updates)
  const latest = latestUpdate(project.id, updates)
  const dueInDays = daysUntil(project.nextStepDue)

  const parts: string[] = [`${project.name} is ${project.progress}% complete and ${statusMeta.label.toLowerCase()}.`]

  if (project.nextStep) {
    parts.push(
      dueInDays !== null && dueInDays >= 0
        ? `Next step is "${project.nextStep}", due in ${dueInDays} day${dueInDays === 1 ? "" : "s"}.`
        : `Next step is "${project.nextStep}".`,
    )
  }

  parts.push(
    blockers > 0
      ? `${blockers} open blocker${blockers === 1 ? "" : "s"} ${blockers === 1 ? "is" : "are"} slowing this down.`
      : "No open blockers right now.",
  )

  if (latest) parts.push(`Latest from ${latest.authorName}: "${latest.body}"`)
  const latestReply = feedbackReplies
    .filter((reply) => reply.projectId === project.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (latestReply?.body) parts.push(`Latest feedback reply from ${latestReply.authorName}: "${latestReply.body}"`)
  const latestRedTeamReviewReply = redTeamReviewReplies
    .filter((reply) => reply.projectId === project.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (latestRedTeamReviewReply?.body) parts.push(`Latest Red Team Review reply from ${latestRedTeamReviewReply.authorName}: "${latestRedTeamReviewReply.body}"`)

  const excerpt = contextExcerpt(contextMarkdown)
  if (excerpt) parts.push(`Context: ${excerpt}`)

  return parts.join(" ")
}

interface AnswerTemplate {
  match: RegExp
  build: (project: Project, updates: ProjectUpdate[]) => string
}

const ANSWER_TEMPLATES: AnswerTemplate[] = [
  {
    match: /block/i,
    build: (project, updates) => {
      const blockers = updates.filter((update) => update.isBlocker)
      if (blockers.length === 0) return `${project.name} has no open blockers right now.`
      return `${blockers.length} open blocker${blockers.length === 1 ? "" : "s"}: ${blockers
        .map((update) => `"${update.body}"`)
        .join("; ")}`
    },
  },
  {
    match: /red team|critical|worst case/i,
    build: (project, updates) => {
      const reviews = updates.filter((update) => update.type === "red_team_review")
      if (reviews.length === 0) return `No Red Team Review has been logged for ${project.name} yet.`
      return `Red Team Review notes: ${reviews.map((update) => `"${update.body}"`).join("; ")}`
    },
  },
  {
    match: /next step|due|when/i,
    build: (project) =>
      project.nextStep
        ? `Next step: "${project.nextStep}"${project.nextStepDue ? ` (due ${formatDue(project.nextStepDue)}).` : "."}`
        : "There's no next step recorded yet.",
  },
  {
    match: /who|people|team|involved/i,
    build: (project) => `${project.people.length} people are involved: ${project.people.map((person) => person.name).join(", ")}.`,
  },
  {
    match: /mission|fit/i,
    build: (project) => `Mission fit is scored ${project.missionFitScore}/5 (${missionFitLabel(project.missionFitScore)}).`,
  },
  {
    match: /progress|status|track/i,
    build: (project) => `${project.name} is at ${project.progress}% and currently ${PROJECT_STATUS_META[effectiveProjectStatus(project)].label.toLowerCase()}.`,
  },
]

function contextExcerpt(markdown: string | null | undefined): string | null {
  if (!markdown?.trim()) return null
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return null
  return plain.length > 440 ? `${plain.slice(0, 437).trimEnd()}…` : plain
}

export function answerProjectQuestion(project: Project, updates: ProjectUpdate[], question: string, contextMarkdown?: string | null, feedbackReplies: FeedbackReply[] = [], redTeamReviewReplies: RedTeamReviewReply[] = []): string {
  const projectUpdates = updates.filter((update) => update.projectId === project.id)
  if (/context|purpose|problem|users?|flow|feature|decision|pending|connection/i.test(question)) {
    const excerpt = contextExcerpt(contextMarkdown)
    if (excerpt) return `Project context for ${project.name}: ${excerpt}`
    return `No written project context has been recorded for ${project.name} yet.`
  }
  const template = ANSWER_TEMPLATES.find((entry) => entry.match.test(question))
  if (template) return template.build(project, projectUpdates)
  return generateProjectBrief(project, projectUpdates, contextMarkdown, feedbackReplies, redTeamReviewReplies)
}

/** Portfolio-wide version of the same idea, for the Ask AI card on the Home screen. */
export function answerPortfolioQuestion(
  projects: Project[],
  updates: ProjectUpdate[],
  question: string,
  contextsByProjectId: Map<string, string> = new Map(),
): string {
  const atRisk = projects.filter((project) => effectiveProjectStatus(project) === "at_risk")
  const blockers = updates.filter((update) => update.isBlocker)

  if (/block/i.test(question)) {
    if (blockers.length === 0) return "No open blockers across your projects right now."
    const affectedProjects = new Set(blockers.map((update) => update.projectId)).size
    return `${blockers.length} open blocker${blockers.length === 1 ? "" : "s"} across ${affectedProjects} project${affectedProjects === 1 ? "" : "s"}: ${blockers.map((update) => `"${update.body}"`).join("; ")}`
  }
  if (/risk/i.test(question)) {
    if (atRisk.length === 0) return "Nothing is at risk right now — every project is on track, planning or completed."
    return `${atRisk.length} project${atRisk.length === 1 ? " is" : "s are"} at risk: ${atRisk.map((project) => project.name).join(", ")}.`
  }
  if (/next step|due|soon/i.test(question)) {
    const withDue = projects
      .filter((project) => project.nextStep && project.nextStepDue)
      .sort((a, b) => (a.nextStepDue ?? "").localeCompare(b.nextStepDue ?? ""))
    if (withDue.length === 0) return "No project has a dated next step scheduled."
    const soonest = withDue[0]!
    return `The soonest next step is "${soonest.nextStep}" on ${soonest.name}, due ${formatDue(soonest.nextStepDue!)}.`
  }

  if (/context|purpose|problem|users?|flow|feature|decision|pending|connection/i.test(question)) {
    const contexts = projects
      .map((project) => ({ project, excerpt: contextExcerpt(contextsByProjectId.get(project.id)) }))
      .filter((entry): entry is { project: Project; excerpt: string } => Boolean(entry.excerpt))
    if (contexts.length === 0) return "No written project contexts are available in this portfolio yet."
    return contexts.map(({ project, excerpt }) => `${project.name}: ${excerpt}`).join(" ")
  }

  const completed = projects.filter((project) => effectiveProjectStatus(project) === "completed").length
  return `You have ${projects.length} project${projects.length === 1 ? "" : "s"} tracked: ${atRisk.length} at risk, ${completed} completed. ${blockers.length} open blocker${blockers.length === 1 ? "" : "s"} in total.`
}
