"use client"

/**
 * "Ask AI about this project."
 *
 * Same "one hook, two backends" shape the rest of Quest Coral uses: when
 * QUEST_CORAL_AI_ENABLED is off (the default), this behaves exactly like the
 * Phase 1 mock — answers come from quest-coral-mock-ai.ts on a short local
 * delay, zero network, zero cost. When the flag is on, it calls the real
 * `/api/quest-coral/ask` route (see features/quest-coral/ai/), grounded only
 * in this project's own fields, Project Context and updates. Either way the contract
 * (question/phase/answer/submit/reset/canSubmit) is identical, so
 * ProjectDetailScreen never needs to know which backend answered.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { answerProjectQuestion } from "@/features/quest-coral/quest-coral-mock-ai"
import { QUEST_CORAL_AI_ENABLED } from "@/lib/quest-coral-flags"
import {
  createQuestCoralAiIdempotencyKey,
  QuestCoralAiClientError,
  requestQuestCoralAsk,
} from "@/features/quest-coral/ai/client/quest-coral-ai-client"
import type { QuestCoralAskProject } from "@/features/quest-coral/ai/quest-coral-ask-contract"
import { effectiveProjectStatus, type FeedbackReply, type RedTeamReviewReply, type Project, type ProjectUpdate } from "@/lib/quest-coral-core"

export type QuestCoralAskPhase = "idle" | "asking" | "answered" | "error"

export interface QuestCoralAnswer {
  question: string
  text: string
}

/** Project a Project + its updates into the small, bounded wire payload the server validates. */
export function projectToAskPayload(
  project: Project,
  updates: ProjectUpdate[],
  contextMarkdown?: string | null,
  feedbackReplies: FeedbackReply[] = [],
  redTeamReviewReplies: RedTeamReviewReply[] = [],
): QuestCoralAskProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description || null,
    status: effectiveProjectStatus(project),
    progress: project.progress,
    missionFitScore: project.missionFitScore,
    ownerName: project.ownerName,
    peopleNames: project.people.map((person) => person.name),
    nextStep: project.nextStep,
    nextStepDue: project.nextStepDue,
    contextMarkdown: contextMarkdown?.trim().slice(0, 12_000) || null,
    updates: updates
      .filter((update) => update.projectId === project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((update) => ({
        type: update.type,
        body: update.body,
        authorName: update.authorName,
        createdAt: update.createdAt,
        isBlocker: update.isBlocker,
      })),
    feedbackReplies: feedbackReplies
      .filter((reply) => reply.projectId === project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((reply) => ({
        feedbackId: reply.feedbackId,
        body: reply.body.slice(0, 600),
        authorName: reply.authorName,
        createdAt: reply.createdAt,
      })),
    redTeamReviewReplies: redTeamReviewReplies
      .filter((reply) => reply.projectId === project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((reply) => ({
        redTeamReviewId: reply.redTeamReviewId,
        body: reply.body.slice(0, 600),
        authorName: reply.authorName,
        createdAt: reply.createdAt,
      })),
  }
}

function secondsRemaining(untilMs: number, nowMs: number): number {
  return untilMs > nowMs ? Math.max(1, Math.ceil((untilMs - nowMs) / 1000)) : 0
}

export function useQuestCoralAsk(project: Project, updates: ProjectUpdate[], contextMarkdown?: string | null, feedbackReplies: FeedbackReply[] = [], redTeamReviewReplies: RedTeamReviewReply[] = []) {
  const [question, setQuestion] = useState("")
  const [phase, setPhase] = useState<QuestCoralAskPhase>("idle")
  const [answer, setAnswer] = useState<QuestCoralAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [clockMs, setClockMs] = useState(() => Date.now())
  // Bumped on every submit(); pair with useGeneratingReveal so the screen can
  // hold the generating skeleton visible for a minimum duration per question.
  const [attempt, setAttempt] = useState(0)
  const busyRef = useRef(false)

  const cooldownSeconds = secondsRemaining(cooldownUntil, clockMs)

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = setInterval(() => setClockMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [cooldownSeconds])

  const submit = useCallback(() => {
    const trimmed = question.trim()
    if (!trimmed || busyRef.current || cooldownUntil > Date.now()) return
    busyRef.current = true
    setPhase("asking")
    setError(null)
    setAttempt((current) => current + 1)

    if (!QUEST_CORAL_AI_ENABLED) {
      window.setTimeout(() => {
        setAnswer({ question: trimmed, text: answerProjectQuestion(project, updates, trimmed, contextMarkdown, feedbackReplies, redTeamReviewReplies) })
        setPhase("answered")
        busyRef.current = false
      }, 450)
      return
    }

    void (async () => {
      try {
        const response = await requestQuestCoralAsk(
          { question: trimmed, scope: "project", projects: [projectToAskPayload(project, updates, contextMarkdown, feedbackReplies, redTeamReviewReplies)] },
          { idempotencyKey: createQuestCoralAiIdempotencyKey() },
        )
        setAnswer({ question: trimmed, text: response.answer })
        setPhase("answered")
      } catch (err) {
        if (err instanceof QuestCoralAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
          setCooldownUntil(Date.now() + err.retryAfterSeconds * 1000)
          setClockMs(Date.now())
        }
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
        setPhase("error")
      } finally {
        busyRef.current = false
      }
    })()
  }, [question, project, updates, contextMarkdown, feedbackReplies, redTeamReviewReplies, cooldownUntil])

  const reset = useCallback(() => {
    setQuestion("")
    setAnswer(null)
    setError(null)
    setPhase("idle")
    busyRef.current = false
  }, [])

  return {
    question,
    setQuestion,
    phase,
    answer,
    error,
    cooldownSeconds,
    attempt,
    submit,
    reset,
    canSubmit: question.trim().length > 0 && phase !== "asking" && cooldownSeconds === 0,
  }
}
