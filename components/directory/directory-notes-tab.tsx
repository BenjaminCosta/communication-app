"use client"

import { useEffect, useRef, useState } from "react"
import { NotebookPen, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  addDirectoryNote,
  deleteDirectoryNote,
  subscribeDirectoryNotes,
  updateDirectoryNote,
  type DirectoryNote,
} from "@/lib/directory-notes"

interface DirectoryNotesTabProps {
  directoryId: string
  userId: string
  autoFocus?: boolean
}

function timeAgo(date: Date | null): string {
  if (!date) return "Just now"
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 45) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function DirectoryNotesTab({ directoryId, userId, autoFocus }: DirectoryNotesTabProps) {
  const [notes, setNotes] = useState<DirectoryNote[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [draft, setDraft] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setIsLoading(true)
    const unsubscribe = subscribeDirectoryNotes(
      directoryId,
      (next) => { setNotes(next); setIsLoading(false) },
      () => setIsLoading(false),
    )
    return unsubscribe
  }, [directoryId])

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => inputRef.current?.focus())
  }, [autoFocus])

  const submit = async () => {
    const text = draft.trim()
    if (!text || isSaving) return
    setIsSaving(true)
    setError("")
    try {
      await addDirectoryNote(userId, directoryId, text)
      setDraft("")
    } catch {
      setError("Note could not be saved. Try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const saveEdit = async (noteId: string) => {
    const text = editingText.trim()
    if (!text) return
    try {
      await updateDirectoryNote(noteId, text)
      setEditingId(null)
      setEditingText("")
    } catch {
      setError("Note could not be updated.")
    }
  }

  const remove = async (noteId: string) => {
    try {
      await deleteDirectoryNote(noteId)
    } catch {
      setError("Note could not be deleted.")
    } finally {
      setConfirmingDelete(null)
    }
  }

  return (
    <div>
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit() }}
          placeholder="Add a note about this entity…"
          rows={3}
          className="w-full resize-none bg-transparent text-sm leading-6 text-foreground/90 placeholder:text-muted-foreground/45 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/40">⌘↵ to save</span>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || isSaving}
            className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:bg-white/[0.09] disabled:opacity-40 active:scale-[0.97]"
          >
            {isSaving ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-orange-200/80" role="alert">{error}</p>}

      <div className="mt-5 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />)}
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
              <NotebookPen className="h-5 w-5 text-[var(--directory-title)]/70" strokeWidth={1.7} />
            </div>
            <p className="text-sm font-medium text-foreground/80">No notes yet</p>
            <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground/60">Capture operational knowledge — it stays linked to this entity.</p>
          </div>
        ) : (
          notes.map((note) => {
            const isOwn = note.createdBy === userId
            const isEditing = editingId === note.id
            return (
              <article key={note.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground/60">
                    {isOwn ? "You" : "Teammate"} · {timeAgo(note.createdAt)}
                    {note.updatedAt && note.createdAt && note.updatedAt.getTime() - note.createdAt.getTime() > 1000 && (
                      <span className="text-muted-foreground/40"> · edited</span>
                    )}
                  </span>
                  {isOwn && !isEditing && (
                    <div className="flex items-center gap-1">
                      {confirmingDelete === note.id ? (
                        <>
                          <button type="button" onClick={() => remove(note.id)} className="text-[11px] font-semibold text-red-300/90">Delete</button>
                          <button type="button" onClick={() => setConfirmingDelete(null)} className="text-[11px] text-muted-foreground/60">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditingId(note.id); setEditingText(note.text); setConfirmingDelete(null) }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/50 hover:bg-white/[0.05] hover:text-foreground/80"
                            aria-label="Edit note"
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(note.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/50 hover:bg-white/[0.05] hover:text-red-300/80"
                            aria-label="Delete note"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="mt-2">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm leading-6 text-foreground/90 focus:outline-none"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={() => saveEdit(note.id)} disabled={!editingText.trim()} className="rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-foreground/90 disabled:opacity-40">Save</button>
                      <button type="button" onClick={() => { setEditingId(null); setEditingText("") }} className="text-xs text-muted-foreground/60">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-foreground/85">{note.text}</p>
                )}
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
