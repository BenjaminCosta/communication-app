"use client"

/**
 * "AI Project Brief" — the always-visible status summary at the top of
 * Project Detail's AI card.
 *
 * Same "one hook, two backends" shape as useQuestCoralAsk: off (the default),
 * this is the Phase 1 mock (`generateProjectBrief`), synchronous, zero cost.
 * On, it calls the real `/api/quest-coral/brief` route.
 *
 * Unlike Ask AI (one call per user-typed question, naturally cost-bounded),
 * a Brief is content the screen renders on every visit — without caching,
 * simply reopening the same unchanged project would re-bill OpenAI every
 * time. `briefCache` is a module-level, session-lifetime cache keyed by
 * project id + a fingerprint of the fields the brief actually depends on:
 * a cache hit costs nothing and skips the network entirely; only a genuine
 * change (progress, status, next step, a new update, edited context) or an
 * explicit `regenerate()` triggers a fresh paid call.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { generateProjectBrief } from "@/features/quest-coral/quest-coral-mock-ai"
import { QUEST_CORAL_AI_ENABLED } from "@/lib/quest-coral-flags"
import {
  createQuestCoralAiIdempotencyKey,
  QuestCoralAiClientError,
  requestQuestCoralBrief,
} from "@/features/quest-coral/ai/client/quest-coral-ai-client"
import { projectToAskPayload } from "@/features/quest-coral/use-quest-coral-ask"
import type { FeedbackReply, Project, ProjectUpdate } from "@/lib/quest-coral-core"

export type QuestCoralBriefPhase = "idle" | "loading" | "ready"

interface CachedBrief {
  fingerprint: string
  text: string
  mode: "mock" | "live"
}

const briefCache = new Map<string, CachedBrief>()

function projectFingerprint(project: Project, updates: ProjectUpdate[], contextMarkdown?: string | null, feedbackReplies: FeedbackReply[] = []): string {
  const projectUpdates = updates.filter((update) => update.projectId === project.id)
  const latest = projectUpdates.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return [
    project.status,
    project.progress,
    project.nextStep ?? "",
    project.nextStepDue ?? "",
    projectUpdates.length,
    latest?.id ?? "",
    latest?.createdAt ?? "",
    feedbackReplies.filter((reply) => reply.projectId === project.id).length,
    feedbackReplies.filter((reply) => reply.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id ?? "",
    contextMarkdown ?? "",
  ].join("|")
}

export function useQuestCoralBrief(project: Project, updates: ProjectUpdate[], contextMarkdown?: string | null, feedbackReplies: FeedbackReply[] = []) {
  const fingerprint = useMemo(
    () => projectFingerprint(project, updates, contextMarkdown, feedbackReplies),
    [project, updates, contextMarkdown, feedbackReplies],
  )
  const mockBrief = useMemo(
    () => generateProjectBrief(project, updates, contextMarkdown, feedbackReplies),
    [project, updates, contextMarkdown, feedbackReplies],
  )

  const [phase, setPhase] = useState<QuestCoralBriefPhase>(QUEST_CORAL_AI_ENABLED ? "idle" : "ready")
  const [brief, setBrief] = useState<string | null>(QUEST_CORAL_AI_ENABLED ? null : mockBrief)
  const [mode, setMode] = useState<"mock" | "live" | null>(QUEST_CORAL_AI_ENABLED ? null : "mock")
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const load = useCallback(
    (force: boolean) => {
      if (!QUEST_CORAL_AI_ENABLED) {
        setBrief(mockBrief)
        setMode("mock")
        setPhase("ready")
        return
      }
      const cached = briefCache.get(project.id)
      if (!force && cached && cached.fingerprint === fingerprint) {
        setBrief(cached.text)
        setMode(cached.mode)
        setPhase("ready")
        return
      }
      if (busyRef.current) return
      busyRef.current = true
      setPhase("loading")
      setError(null)
      void (async () => {
        try {
          const response = await requestQuestCoralBrief(
            { project: projectToAskPayload(project, updates, contextMarkdown, feedbackReplies) },
            { idempotencyKey: createQuestCoralAiIdempotencyKey() },
          )
          briefCache.set(project.id, { fingerprint, text: response.brief, mode: response.mode })
          setBrief(response.brief)
          setMode(response.mode)
          setPhase("ready")
        } catch (err) {
          // A Brief is always-visible, ambient content, not a user action —
          // degrade to the local mock instead of showing a hard error block.
          setBrief(mockBrief)
          setMode("mock")
          setPhase("ready")
          setError(
            err instanceof QuestCoralAiClientError
              ? err.message
              : "The AI brief couldn't be generated — showing a basic summary instead.",
          )
        } finally {
          busyRef.current = false
        }
      })()
    },
    [project, updates, contextMarkdown, feedbackReplies, fingerprint, mockBrief],
  )

  useEffect(() => {
    load(false)
    // Re-run only when the project identity or its fingerprint actually
    // changes — `load` is recreated every render but that shouldn't retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, fingerprint])

  const regenerate = useCallback(() => load(true), [load])

  return { brief, phase, mode, error, regenerate }
}
