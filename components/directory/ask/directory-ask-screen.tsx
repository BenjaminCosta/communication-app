"use client"

import { useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { ArrowLeft, ArrowUp, Loader2, Mic, Pencil, RotateCcw, Sparkles } from "lucide-react"
import { DirectoryResultRow } from "@/components/directory/directory-result-row"
import { DirectoryAskAnswer } from "@/components/directory/ask/directory-ask-answer"
import { DirectoryAskContextChips } from "@/components/directory/ask/directory-ask-context-chips"
import { DirectoryAskGenerating } from "@/components/directory/ask/directory-ask-generating"
import { DirectoryAskSuggestions } from "@/components/directory/ask/directory-ask-suggestions"
import { DirectoryAskVoice } from "@/components/directory/ask/directory-ask-voice"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import { useDirectoryAsk } from "@/features/directory/ai/client/use-directory-ask"
import type { DirectoryListItem, DirectoryScope } from "@/lib/directory-config"
import type { DirectorySearchIndex } from "@/lib/directory-search"
import { cn } from "@/lib/utils"

interface DirectoryAskScreenProps {
  index: DirectorySearchIndex | null
  scope: DirectoryScope
  recentItems: DirectoryListItem[]
  contextEntity?: DirectoryListItem | null
  voiceEnabled: boolean
  onOpenDetail: (directoryId: string) => void
  onBack: () => void
  className?: string
}

export function DirectoryAskScreen({
  index,
  scope,
  recentItems,
  contextEntity,
  voiceEnabled,
  onOpenDetail,
  onBack,
  className,
}: DirectoryAskScreenProps) {
  const ask = useDirectoryAsk({ index, scope, recentItems, contextEntity })
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [refineText, setRefineText] = useState("")
  const [generationAttempt, setGenerationAttempt] = useState(0)
  const composeRef = useRef<HTMLTextAreaElement>(null)
  const generationVisible = useGeneratingReveal(generationAttempt, ask.phase === "loading", 360)
  const isGenerating = ask.phase === "loading" || (ask.phase === "answer" && generationVisible)
  const showNewQuestion = !isGenerating && (ask.phase === "answer" || ask.phase === "error" || ask.phase === "ambiguous")

  const focusComposer = () => requestAnimationFrame(() => composeRef.current?.focus())
  const fillSuggestion = (suggestion: Parameters<typeof ask.fillSuggestion>[0]) => {
    ask.fillSuggestion(suggestion)
    focusComposer()
  }
  const restartWithCurrentQuestion = () => {
    const currentQuestion = ask.answer?.question ?? ask.question
    ask.newQuestion()
    requestAnimationFrame(() => {
      ask.setQuestion(currentQuestion)
      composeRef.current?.focus()
    })
  }
  const handleComposeKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      setGenerationAttempt((attempt) => attempt + 1)
      ask.submit()
    }
  }
  const handleRefineKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (refineText.trim()) {
        setGenerationAttempt((attempt) => attempt + 1)
        ask.refine(refineText)
        setRefineText("")
      }
    }
  }

  return (
    <div className={cn("directory-glass-screen directory-ask-screen relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="directory-ask-header app-topbar flex shrink-0 items-center justify-between gap-3 border-b px-4 animate-slide-down">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="glass-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full border active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70" aria-label="Back to Directory">
            <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
          </button>
          {ask.mode === "mock" && <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 sm:inline">Mock</span>}
        </div>
        {showNewQuestion && (
          <button type="button" onClick={() => { ask.newQuestion(); setRefineText("") }} className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--directory-ai-border)] bg-[var(--directory-ai-soft)] px-3 py-1.5 text-[13px] font-medium text-[var(--directory-ai)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
            New question
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className={cn("directory-results-enter mx-auto w-full max-w-2xl px-4 pt-6 md:px-6", ask.phase === "answer" ? "pb-36" : "pb-16")}>
          {(ask.phase === "empty" || ask.phase === "error") && (
            <div>
              <div className="flex flex-col items-center pt-3 text-center">
                <Sparkles className="h-8 w-8 text-[var(--directory-ai)] directory-ai-spark" strokeWidth={1.6} />
                <h1 className="mt-5 text-[2rem] font-light tracking-[-0.04em] text-foreground">Ask <span className="text-[var(--directory-title)]">SVC Directory</span></h1>
                <p className="mt-2 max-w-sm text-[15px] text-muted-foreground/70">Ask about people, companies and jobs.</p>
              </div>

              <ComposeCard inputRef={composeRef} value={ask.question} onChange={ask.setQuestion} onKeyDown={handleComposeKeyDown} onSubmit={() => { setGenerationAttempt((attempt) => attempt + 1); ask.submit() }} onMic={voiceEnabled ? () => setVoiceOpen(true) : undefined} canSubmit={ask.canSubmit} transcribing={ask.transcribing} maxChars={ask.maxQuestionChars} />
              <DirectoryAskContextChips index={index} pinnedEntity={ask.pinnedEntity} onChange={ask.setPinnedEntity} />

              {ask.phase === "error" && ask.error && (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3" role="alert">
                  <span className="min-w-0 flex-1 text-sm text-red-200/90">{ask.error}</span>
                  <button type="button" onClick={() => { setGenerationAttempt((attempt) => attempt + 1); ask.submit(ask.question || undefined) }} disabled={!ask.question.trim() || ask.askCooldownSeconds > 0} className="flex shrink-0 items-center gap-1 text-xs font-medium text-red-100 transition-colors hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200">
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {ask.askCooldownSeconds > 0 ? `${ask.askCooldownSeconds}s` : "Try again"}
                  </button>
                </div>
              )}
              {ask.phase === "empty" && <DirectoryAskSuggestions suggestions={ask.suggestions} onSelect={fillSuggestion} />}
              {ask.phase === "empty" && <p className="mt-8 text-center text-xs text-muted-foreground/50">Answers are based only on SVC Directory data.</p>}
            </div>
          )}

          {isGenerating && <DirectoryAskGenerating question={ask.question} />}

          {ask.phase === "ambiguous" && (
            <div>
              <QuestionSummary question={ask.question} onEdit={restartWithCurrentQuestion} />
              <h2 className="mt-6 text-lg font-medium tracking-tight text-foreground">Which one did you mean?</h2>
              <p className="mt-1 text-sm text-muted-foreground/70">
                {ask.ambiguousMention
                  ? `Several records match “${ask.ambiguousMention}”. Choose one to continue.`
                  : "Several records match that name. Choose one to continue."}
              </p>
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015]">
                {ask.ambiguous.map((item) => <DirectoryResultRow key={item.id} item={item} onSelect={(selected) => { setGenerationAttempt((attempt) => attempt + 1); ask.pickEntity(selected) }} showChevron />)}
              </div>
            </div>
          )}

          {!isGenerating && ask.phase === "answer" && ask.answer && (
            <div className="animate-fade-in">
              <QuestionSummary question={ask.answer.question} onEdit={restartWithCurrentQuestion} />
              <div className="mt-6"><DirectoryAskAnswer answer={ask.answer} onOpenDetail={onOpenDetail} /></div>
            </div>
          )}
        </div>
      </main>

      {!isGenerating && ask.phase === "answer" && (
        <footer className="directory-ask-dock shrink-0 border-t px-4 pb-[calc(var(--sab)+0.75rem)] pt-3">
          {ask.canRefine ? (
            <ComposeCard value={refineText} onChange={setRefineText} onKeyDown={handleRefineKeyDown} onSubmit={() => { setGenerationAttempt((attempt) => attempt + 1); ask.refine(refineText); setRefineText("") }} canSubmit={Boolean(refineText.trim()) && ask.askCooldownSeconds === 0} transcribing={false} maxChars={ask.maxQuestionChars} compact placeholder="Ask a follow-up…" />
          ) : (
            <p className="py-2 text-center text-xs text-muted-foreground/60">Start a new question to keep exploring the Directory.</p>
          )}
        </footer>
      )}

      {voiceOpen && <DirectoryAskVoice question={ask.question} onAudio={ask.transcribeFromAudio} onClose={() => setVoiceOpen(false)} onError={(message) => ask.setError(message)} />}
    </div>
  )
}

function QuestionSummary({ question, onEdit }: { question: string; onEdit: () => void }) {
  return (
    <div className="directory-ask-question rounded-2xl border px-4 py-3">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--directory-ai)]" strokeWidth={1.8} />
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground/90">{question}</p>
        <button type="button" onClick={onEdit} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70" aria-label="Edit question">
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}

function ComposeCard({
  inputRef,
  value,
  onChange,
  onKeyDown,
  onSubmit,
  onMic,
  canSubmit,
  transcribing,
  maxChars,
  compact = false,
  placeholder,
}: {
  inputRef?: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSubmit: () => void
  onMic?: () => void
  canSubmit: boolean
  transcribing: boolean
  maxChars: number
  compact?: boolean
  placeholder?: string
}) {
  return (
    <div className={cn("directory-ask-compose rounded-3xl border focus-within:border-[var(--directory-ai-border)]", compact ? "p-2" : "mt-8 p-3")}>
      <textarea ref={inputRef} value={value} onChange={(event) => onChange(event.target.value.slice(0, maxChars))} onKeyDown={onKeyDown} rows={compact ? 1 : 2} placeholder={transcribing ? "Transcribing…" : placeholder ?? "Ask anything about the Directory…"} className={cn("w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/45", compact ? "min-h-[2.25rem] px-2 pt-1" : "min-h-[3rem] px-2 pt-1")} aria-label={compact ? "Ask a follow-up question" : "Ask a question about the Directory"} />
      <div className={cn("flex items-center justify-end gap-2", compact ? "mt-0" : "mt-1")}>
        {transcribing && <Loader2 className="h-4 w-4 animate-spin text-[var(--directory-ai)]" strokeWidth={1.8} />}
        {onMic && !transcribing && <button type="button" onClick={onMic} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--directory-ai-border)] bg-[var(--directory-ai-soft)] text-[var(--directory-ai)] transition-transform active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70" aria-label="Ask with your voice"><Mic className="h-4.5 w-4.5" strokeWidth={1.8} /></button>}
        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--directory-ai-action)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition-transform active:scale-[0.94] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--directory-ai)]/70" aria-label={compact ? "Ask follow-up" : "Ask"}><ArrowUp className="h-4.5 w-4.5" strokeWidth={2.2} /></button>
      </div>
    </div>
  )
}
