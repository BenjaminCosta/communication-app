import type { QuestCoralAskProject, QuestCoralAskRequest, QuestCoralAskResult } from "@/features/quest-coral/ai/quest-coral-ask-contract"
import type { QuestCoralBriefResult } from "@/features/quest-coral/ai/quest-coral-brief-contract"

/**
 * Mock answerer for Quest Coral's Ask AI — used whenever no live provider call
 * is possible (no key, or `QUEST_CORAL_AI_MODE=mock`). Operates on the same
 * wire contract the live path validates against, not on the richer app-side
 * domain model, so this file has no dependency on `lib/quest-coral-core.ts`.
 *
 * Mirrors the keyword-matched templates `features/quest-coral/quest-coral-mock-ai.ts`
 * already uses client-side for the offline/Phase-1 experience, kept independent
 * so either can evolve without touching the other.
 */

function formatDue(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function projectBrief(project: QuestCoralAskProject): string {
  const blockers = project.updates.filter((update) => update.isBlocker).length
  const parts = [`${project.name} is ${project.progress}% complete and currently ${project.status.replace("_", " ")}.`]
  if (project.nextStep) parts.push(`Next step: "${project.nextStep}"${project.nextStepDue ? ` (due ${formatDue(project.nextStepDue)}).` : "."}`)
  parts.push(blockers > 0 ? `${blockers} open blocker${blockers === 1 ? "" : "s"}.` : "No open blockers right now.")
  return parts.join(" ")
}

function contextExcerpt(project: QuestCoralAskProject): string | null {
  const markdown = project.contextMarkdown?.trim()
  if (!markdown) return null
  const plain = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return null
  return plain.length > 420 ? `${plain.slice(0, 417).trimEnd()}…` : plain
}

function answerAboutProject(project: QuestCoralAskProject, question: string): string {
  if (/context|purpose|problem|users?|flow|feature|decision|pending|connection/i.test(question)) {
    const excerpt = contextExcerpt(project)
    return excerpt
      ? `Project context for ${project.name}: ${excerpt}`
      : `No written project context has been recorded for ${project.name} yet.`
  }
  if (/block/i.test(question)) {
    const blockers = project.updates.filter((update) => update.isBlocker)
    if (blockers.length === 0) return `${project.name} has no open blockers right now.`
    return `${blockers.length} open blocker${blockers.length === 1 ? "" : "s"} on ${project.name}: ${blockers.map((update) => `"${update.body}"`).join("; ")}`
  }
  if (/red team|critical|worst case/i.test(question)) {
    const reviews = project.updates.filter((update) => update.type === "red_team_review")
    if (reviews.length === 0) return `No Red Team Review has been logged for ${project.name} yet.`
    return `Red Team Review notes for ${project.name}: ${reviews.map((update) => `"${update.body}"`).join("; ")}`
  }
  if (/next step|due|when/i.test(question)) {
    return project.nextStep
      ? `Next step on ${project.name}: "${project.nextStep}"${project.nextStepDue ? ` (due ${formatDue(project.nextStepDue)}).` : "."}`
      : `There's no next step recorded yet for ${project.name}.`
  }
  if (/who|people|team|involved/i.test(question)) {
    return project.peopleNames.length
      ? `${project.peopleNames.length} people are involved in ${project.name}: ${project.peopleNames.join(", ")}.`
      : `No one besides the owner is recorded on ${project.name} yet.`
  }
  if (/mission|fit/i.test(question)) {
    return `${project.name}'s mission fit is scored ${project.missionFitScore}/5.`
  }
  return projectBrief(project)
}

function answerAboutPortfolio(projects: QuestCoralAskProject[], question: string): string {
  const atRisk = projects.filter((project) => project.status === "at_risk")
  const blockers = projects.flatMap((project) => project.updates.filter((update) => update.isBlocker))

  if (/block/i.test(question)) {
    if (blockers.length === 0) return "No open blockers across your projects right now."
    const affectedProjects = new Set(
      projects.filter((project) => project.updates.some((update) => update.isBlocker)).map((project) => project.id),
    ).size
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
      .map((project) => ({ project, excerpt: contextExcerpt(project) }))
      .filter((entry): entry is { project: QuestCoralAskProject; excerpt: string } => Boolean(entry.excerpt))
    if (contexts.length === 0) return "No written project contexts are available in this portfolio yet."
    return contexts.map(({ project, excerpt }) => `${project.name}: ${excerpt}`).join(" ")
  }

  const completed = projects.filter((project) => project.status === "completed").length
  return `You have ${projects.length} project${projects.length === 1 ? "" : "s"} tracked: ${atRisk.length} at risk, ${completed} completed. ${blockers.length} open blocker${blockers.length === 1 ? "" : "s"} in total.`
}

export function mockAnswerQuestCoralQuestion(request: QuestCoralAskRequest): QuestCoralAskResult {
  if (request.scope === "project") {
    return { answer: answerAboutProject(request.projects[0]!, request.question) }
  }
  return { answer: answerAboutPortfolio(request.projects, request.question) }
}

export function mockGenerateQuestCoralBrief(project: QuestCoralAskProject): QuestCoralBriefResult {
  const parts = [projectBrief(project)]
  const excerpt = contextExcerpt(project)
  if (excerpt) parts.push(`Context: ${excerpt}`)
  return { brief: parts.join(" ") }
}
