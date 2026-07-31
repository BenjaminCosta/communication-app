"use client"

/**
 * Write or replace a project's Markdown context. One textarea drives both
 * paths — the "Upload file" tab only adds a file picker above it that reads
 * the file's text client-side (FileReader) and drops it into the same
 * textarea for review before saving. No storage upload, no backend: this is
 * mock data (features/quest-coral/quest-coral-context-store.ts).
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { Check, FileText, UploadCloud } from "lucide-react"
import { cn } from "@/lib/utils"
import { QcSheet } from "@/components/quest-coral/ui/quest-coral-sheet"
import { QcButton } from "@/components/quest-coral/ui/quest-coral-primitives"
import { blankProjectContextTemplate, PROJECT_CONTEXT_MAX_CHARS, PROJECT_CONTEXT_SECTIONS, type ProjectContext, type ProjectContextSource } from "@/lib/quest-coral-core"
import type { SaveProjectContextInput } from "@/features/quest-coral/use-quest-coral-context"

const MAX_CONTEXT_CHARS = PROJECT_CONTEXT_MAX_CHARS
const MAX_FILE_BYTES = 300 * 1024

interface EditProjectContextSheetProps {
  open: boolean
  initialMode: "write" | "upload"
  context: ProjectContext | null
  projectName: string
  onClose: () => void
  onSave: (input: SaveProjectContextInput) => void | Promise<unknown>
}

export function EditProjectContextSheet({ open, initialMode, context, projectName, onClose, onSave }: EditProjectContextSheetProps) {
  const [mode, setMode] = useState<"write" | "upload">(initialMode)
  const [markdown, setMarkdown] = useState("")
  const [source, setSource] = useState<ProjectContextSource>("manual")
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setMarkdown(context?.markdown ?? blankProjectContextTemplate())
    setSource(context?.source ?? "manual")
    setFileName(context?.fileName ?? null)
    setFileError(null)
    setIsSaving(false)
    setSubmitError(null)
  }, [open, initialMode, context])

  const canSave = markdown.trim().length > 0 && !isSaving

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is too large — keep it under 300KB of text.")
      return
    }
    setFileError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      setMarkdown(text.slice(0, MAX_CONTEXT_CHARS))
      setFileName(file.name)
      setSource("upload")
    }
    reader.onerror = () => setFileError("That file could not be read. Try pasting the text instead.")
    reader.readAsText(file)
  }

  const submit = async () => {
    if (!canSave) return
    setIsSaving(true)
    setSubmitError(null)
    try {
      await onSave({ markdown: markdown.trim(), source, fileName: source === "upload" ? fileName : null })
    } catch {
      setSubmitError("The context could not be saved. Please try again.")
      setIsSaving(false)
    }
  }

  return (
    <QcSheet
      open={open}
      eyebrow="SVC Quest Coral"
      title="Edit project context"
      description={`Purpose, users, flows and more for ${projectName}.`}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="quest-coral-tap min-h-[3rem] rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-4 text-sm font-semibold text-[var(--coral-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <QcButton size="md" disabled={!canSave} icon={<Check className="h-4 w-4" strokeWidth={2.4} />} onClick={submit} className="min-h-[3rem]">
            {isSaving ? "Saving…" : "Save context"}
          </QcButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-1" role="tablist" aria-label="How to set the context">
          {(["write", "upload"] as const).map((candidate) => {
            const active = mode === candidate
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(candidate)}
                className={cn(
                  "quest-coral-tap min-h-9 flex-1 rounded-lg px-2 text-[0.8125rem] font-semibold",
                  active ? "bg-white text-[var(--coral-text)] shadow-sm" : "text-[var(--coral-text-muted)]",
                )}
              >
                {candidate === "write" ? "Write" : "Upload file"}
              </button>
            )
          })}
        </div>

        {mode === "upload" && (
          <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-[var(--coral-border)] bg-[var(--coral-surface-2)] p-3.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="quest-coral-tap flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--coral-border)] bg-white text-[0.8125rem] font-semibold text-[var(--coral-text)]"
            >
              <UploadCloud className="h-4 w-4 text-[var(--coral-strong)]" strokeWidth={2} />
              {fileName ? "Choose a different file" : "Choose a .md or .txt file"}
            </button>
            <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={handleFileChange} />
            {fileName && source === "upload" && (
              <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--coral-text-muted)]">
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--coral-strong)]" strokeWidth={2} />
                Loaded {fileName} — review it below before saving.
              </p>
            )}
            {fileError && <p className="text-[0.6875rem] font-medium text-[var(--coral-missing)]">{fileError}</p>}
          </div>
        )}

        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">Project context (Markdown)</span>
            {markdown.trim().length === 0 && (
              <button type="button" onClick={() => setMarkdown(blankProjectContextTemplate())} className="quest-coral-tap text-[0.75rem] font-semibold text-[var(--coral-strong)]">
                Start from a template
              </button>
            )}
          </div>
          <textarea
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value.slice(0, MAX_CONTEXT_CHARS))}
            rows={14}
            placeholder="## Purpose&#10;&#10;## Problem it solves"
            className="min-h-[16rem] w-full resize-y rounded-2xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8] transition-colors focus:border-[var(--coral)] focus:shadow-[0_0_0_3px_rgba(255,122,89,0.12)]"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.6875rem] leading-relaxed text-[var(--coral-text-muted)]">
              Suggested sections: {PROJECT_CONTEXT_SECTIONS.map((section) => section.heading).join(" · ")}
            </p>
            <span className="shrink-0 text-[0.6875rem] text-[var(--coral-text-muted)]">{markdown.length}/{MAX_CONTEXT_CHARS}</span>
          </div>
        </label>

        {submitError && <p role="alert" className="text-[0.75rem] font-medium text-[var(--coral-missing)]">{submitError}</p>}
      </div>
    </QcSheet>
  )
}
