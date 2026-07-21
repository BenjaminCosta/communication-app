"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { localDateToIso } from "@/lib/outlook-core"
import { DIRECTORY_AI_LIMITS } from "@/lib/ai/config-public"
import type { DirectoryListItem, DirectoryScope } from "@/lib/directory-config"
import type { DirectorySearchIndex } from "@/lib/directory-search"
import {
  isDisambiguation,
  type DirectoryAskContext,
  type DirectoryAskDisambiguation,
  type DirectoryAskRefinement,
  type DirectoryAskResponse,
} from "@/features/directory/ai/directory-ask-contract"
import {
  buildDirectorySuggestions,
  docToListItem,
  type AskSuggestion,
  type SuggestionRecord,
} from "@/features/directory/ai/directory-retrieval"
import {
  createDirectoryAiIdempotencyKey,
  DirectoryAiClientError,
  requestDirectoryAsk,
  requestDirectoryTranscription,
} from "@/features/directory/ai/client/directory-ai-client"

/**
 * Orchestrates a single Ask SVC Directory question:
 *   (voice →) question → server retrieval + reasoning → grounded answer + cards.
 *
 * Retrieval, planning and tool execution live on the server (V2); this hook owns
 * transient UI state only. No saved chats, no long history: each
 * `newQuestion()` starts clean. At most `maxRefinements` lightweight follow-ups
 * are allowed, carrying only the previous question, a short answer summary and
 * the used record ids.
 */

export type AskPhase = "empty" | "loading" | "answer" | "ambiguous" | "error"

export interface DirectoryAnswer {
  question: string
  text: string
  notFound: boolean
  mode: "mock" | "live"
  questionIntent: string
  primaryEntity: DirectoryListItem | null
  /** Supporting records, cited ones first — rendered as cards. */
  items: DirectoryListItem[]
  /** The subset the answer actually relied on (for the source chips). */
  sources: DirectoryListItem[]
  confirmedFacts: string[]
  inferredInsights: string[]
  limitations: string[]
  confidence: "high" | "medium" | "low"
}

interface UseDirectoryAskInput {
  index: DirectorySearchIndex | null
  scope: DirectoryScope
  recentItems: DirectoryListItem[]
  contextEntity?: DirectoryListItem | null
}

export function useDirectoryAsk({ index, scope, recentItems, contextEntity }: UseDirectoryAskInput) {
  const [question, setQuestion] = useState("")
  const [phase, setPhase] = useState<AskPhase>("empty")
  const [transcribing, setTranscribing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState("")
  const [mode, setMode] = useState<"mock" | "live" | null>(null)
  const [answer, setAnswer] = useState<DirectoryAnswer | null>(null)
  const [ambiguous, setAmbiguous] = useState<DirectoryListItem[]>([])
  /** The phrase in the question that was ambiguous, shown in the picker. */
  const [ambiguousMention, setAmbiguousMention] = useState("")
  const [pinnedEntity, setPinnedEntity] = useState<DirectoryListItem | null>(contextEntity ?? null)
  // Ids the user picked for ambiguous names, replayed on every follow-up call.
  const resolvedIdsRef = useRef<string[]>([])
  const [refinementStep, setRefinementStep] = useState(0)
  // Bumped on mount and on each new question so suggestions rotate per visit.
  const [rotationSeed, setRotationSeed] = useState(() => Math.floor(Date.now() / 1000))
  const [askCooldownUntil, setAskCooldownUntil] = useState(0)
  const [transcriptionCooldownUntil, setTranscriptionCooldownUntil] = useState(0)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const busyRef = useRef(false)

  const maxQuestionChars = DIRECTORY_AI_LIMITS.maxQuestionChars
  const maxRefinements = DIRECTORY_AI_LIMITS.maxRefinements
  const askCooldownSeconds = secondsRemaining(askCooldownUntil, clockMs)
  const transcriptionCooldownSeconds = secondsRemaining(transcriptionCooldownUntil, clockMs)

  useEffect(() => {
    if (askCooldownSeconds <= 0 && transcriptionCooldownSeconds <= 0) return
    const timer = setInterval(() => setClockMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [askCooldownSeconds, transcriptionCooldownSeconds])

  const suggestions = useMemo<AskSuggestion[]>(() => {
    if (!index) return []
    // Recents carry their full index doc so templates can read status / tags /
    // role / location / completeness — not just the display fields.
    const recents: SuggestionRecord[] = recentItems.map((item, recencyIndex) => ({
      item,
      doc: index.byId.get(item.id) ?? null,
      recencyIndex,
    }))
    // Representative entities for the no-context fallback (fresh account).
    const fallbackEntities: DirectoryListItem[] = []
    const sampleCompany = index.byType.company[0]
    const sampleJob = index.byType.job[0]
    if (sampleCompany) fallbackEntities.push(docToListItem(sampleCompany))
    if (sampleJob) fallbackEntities.push(docToListItem(sampleJob))

    const contextItem = pinnedEntity ?? contextEntity ?? null
    return buildDirectorySuggestions({
      recents,
      scope,
      contextEntity: contextItem,
      contextDoc: contextItem ? index.byId.get(contextItem.id) ?? null : null,
      fallbackEntities,
      seed: rotationSeed,
    })
  }, [index, recentItems, scope, pinnedEntity, contextEntity, rotationSeed])

  const buildContext = useCallback(
    (entity: DirectoryListItem | null): DirectoryAskContext => ({
      scope,
      today: localDateToIso(new Date()),
      location: null,
      entityRefs: entity ? [{ id: entity.id, type: entity.type, name: entity.name }] : [],
    }),
    [scope],
  )

  const runAsk = useCallback(
    async (
      rawQuestion: string,
      options: {
        entity?: DirectoryListItem | null
        refinement?: DirectoryAskRefinement | null
        resolvedEntityIds?: string[]
      } = {},
    ) => {
      const trimmed = rawQuestion.trim().slice(0, maxQuestionChars)
      if (!trimmed || busyRef.current || askCooldownUntil > Date.now()) return
      busyRef.current = true
      setAsking(true)
      setError("")
      setPhase("loading")
      try {
        const entity = options.entity ?? pinnedEntity ?? contextEntity ?? null
        const context = buildContext(entity)
        const resolved = options.resolvedEntityIds ?? resolvedIdsRef.current

        // Retrieval, planning and tool execution all happen server-side.
        const response = await requestDirectoryAsk(
          {
            question: trimmed,
            context,
            refinement: options.refinement ?? null,
            resolvedEntityIds: resolved,
          },
          { idempotencyKey: createDirectoryAiIdempotencyKey() },
        )

        // A name in the question matched several records — ask, don't guess.
        if (isDisambiguation(response)) {
          setAmbiguous(response.candidates.map(candidateToItem))
          setAmbiguousMention(response.mention)
          setPhase("ambiguous")
          return
        }

        setAmbiguous([])
        setAmbiguousMention("")
        setMode(response.mode)
        setAnswer(makeAnswer(trimmed, response))
        setPhase("answer")
      } catch (err) {
        if (err instanceof DirectoryAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
          setAskCooldownUntil(Date.now() + err.retryAfterSeconds * 1000)
          setClockMs(Date.now())
        }
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
        setPhase("error")
      } finally {
        setAsking(false)
        busyRef.current = false
      }
    },
    [maxQuestionChars, askCooldownUntil, pinnedEntity, contextEntity, buildContext],
  )

  const submit = useCallback(
    (override?: string) => {
      const text = (override ?? question).trim()
      if (!text) return
      if (override) setQuestion(override)
      setRefinementStep(0)
      void runAsk(text)
    },
    [question, runAsk],
  )

  // Tapping a suggestion only fills the input (+ pins its entity) — it never
  // calls AI automatically. The user reviews/edits, then submits.
  const fillSuggestion = useCallback((suggestion: AskSuggestion) => {
    setQuestion(suggestion.text)
    setPinnedEntity(suggestion.entity ?? null)
    setRefinementStep(0)
  }, [])

  /**
   * Resolve one ambiguous name. The pick is remembered and replayed on the
   * retry, so a question with several ambiguous names resolves one at a time.
   */
  const pickEntity = useCallback(
    (item: DirectoryListItem) => {
      const resolved = [...new Set([...resolvedIdsRef.current, item.id])]
      resolvedIdsRef.current = resolved
      setAmbiguous([])
      setAmbiguousMention("")
      void runAsk(question, { resolvedEntityIds: resolved })
    },
    [question, runAsk],
  )

  const canRefine = Boolean(answer) && !answer?.notFound && refinementStep < maxRefinements
  const refine = useCallback(
    (refinementQuestion: string) => {
      const text = refinementQuestion.trim()
      if (!answer || !text || refinementStep >= maxRefinements) return
      const step = refinementStep + 1
      setRefinementStep(step)
      setQuestion(text)
      const refinement: DirectoryAskRefinement = {
        previousQuestion: answer.question,
        previousAnswerSummary: answer.text.slice(0, DIRECTORY_AI_LIMITS.maxSummaryChars),
        recordIds: answer.sources.map((source) => source.id).slice(0, DIRECTORY_AI_LIMITS.maxRecords),
        step,
      }
      void runAsk(text, { entity: answer.primaryEntity, refinement })
    },
    [answer, refinementStep, maxRefinements, runAsk],
  )

  const transcribeFromAudio = useCallback(
    async (audio: Blob, durationMs: number) => {
      if (busyRef.current || transcriptionCooldownUntil > Date.now()) return
      busyRef.current = true
      setTranscribing(true)
      setError("")
      try {
        const result = await requestDirectoryTranscription(audio, {
          durationMs,
          idempotencyKey: createDirectoryAiIdempotencyKey(),
        })
        setMode(result.mode)
        setQuestion((current) => {
          const next = current.trim() ? `${current.trim()} ${result.transcript}` : result.transcript
          return next.slice(0, maxQuestionChars)
        })
      } catch (err) {
        if (err instanceof DirectoryAiClientError && err.code === "rate-limited" && err.retryAfterSeconds) {
          setTranscriptionCooldownUntil(Date.now() + err.retryAfterSeconds * 1000)
          setClockMs(Date.now())
        }
        setError(err instanceof Error ? err.message : "Transcription failed.")
      } finally {
        setTranscribing(false)
        busyRef.current = false
      }
    },
    [maxQuestionChars, transcriptionCooldownUntil],
  )

  const newQuestion = useCallback(() => {
    setQuestion("")
    setPhase("empty")
    setAnswer(null)
    setAmbiguous([])
    setError("")
    setAmbiguousMention("")
    setPinnedEntity(contextEntity ?? null)
    setRefinementStep(0)
    resolvedIdsRef.current = []
    setRotationSeed((seed) => seed + 1) // rotate suggestions for the next question
  }, [contextEntity])

  return {
    question,
    setQuestion,
    phase,
    transcribing,
    asking,
    error,
    setError,
    mode,
    answer,
    ambiguous,
    ambiguousMention,
    suggestions,
    pinnedEntity,
    setPinnedEntity,
    canRefine,
    refinementStep,
    maxRefinements,
    maxQuestionChars,
    askCooldownSeconds,
    transcriptionCooldownSeconds,
    canSubmit: question.trim().length > 0 && !asking && !transcribing && askCooldownSeconds === 0,
    submit,
    fillSuggestion,
    pickEntity,
    refine,
    transcribeFromAudio,
    newQuestion,
  }
}

/** Project a server supporting record / disambiguation candidate for the UI. */
function candidateToItem(candidate: DirectoryAskDisambiguation["candidates"][number]): DirectoryListItem {
  return {
    id: candidate.id,
    type: candidate.type === "other" ? "person" : candidate.type,
    name: candidate.name,
    subtitle: candidate.subtitle ?? "",
    companyName: candidate.companyName ?? "",
    location: candidate.location ?? "",
    role: candidate.role ?? "",
  }
}

function makeAnswer(question: string, response: DirectoryAskResponse): DirectoryAnswer {
  const items: DirectoryListItem[] = response.supportingRecords.map((record) => ({
    id: record.id,
    type: record.type === "other" ? "person" : record.type,
    name: record.name,
    subtitle: record.subtitle ?? "",
    companyName: record.companyName ?? "",
    location: record.location ?? "",
    role: record.role ?? "",
    description: record.description ?? "",
  }))
  const used = new Set(response.usedRecordIds)
  const sources = used.size ? items.filter((item) => used.has(item.id)) : items
  return {
    question,
    text: response.answer,
    notFound: response.notFound,
    mode: response.mode,
    questionIntent: response.questionIntent,
    primaryEntity: items[0] ?? null,
    items,
    sources,
    confirmedFacts: response.confirmedFacts,
    inferredInsights: response.inferredInsights,
    limitations: response.limitations,
    confidence: response.confidence,
  }
}

function secondsRemaining(untilMs: number, nowMs: number): number {
  return untilMs > nowMs ? Math.max(1, Math.ceil((untilMs - nowMs) / 1000)) : 0
}
