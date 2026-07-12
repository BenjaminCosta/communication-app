"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getEditableFields,
  type DirectoryProfileViewModel,
} from "@/lib/directory-view-models"
import { applyDirectoryEdits, DirectoryWriteError, type DirectoryEditInput } from "@/lib/directory-writes"

interface DirectoryEditSheetProps {
  vm: DirectoryProfileViewModel
  onClose: () => void
  onSaved: () => void
}

const TITLES: Record<DirectoryProfileViewModel["type"], string> = {
  person: "Edit Contact",
  company: "Edit Company",
  job: "Edit Job",
  other: "Edit",
}

export function DirectoryEditSheet({ vm, onClose, onSaved }: DirectoryEditSheetProps) {
  const initial = useMemo(() => {
    const fields = getEditableFields(vm)
    const values: Record<string, string> = {}
    for (const field of fields) values[field.key] = field.value
    return { fields, values }
  }, [vm])

  const [values, setValues] = useState<Record<string, string>>(initial.values)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  const dirty = initial.fields.some((f) => (values[f.key] ?? "") !== (initial.values[f.key] ?? ""))

  const save = async () => {
    if (isSaving) return
    const edits: DirectoryEditInput = {}
    for (const field of initial.fields) {
      const next = values[field.key] ?? ""
      if (next !== (initial.values[field.key] ?? "")) edits[field.key] = next
    }
    if (Object.keys(edits).length === 0) { onClose(); return }
    setIsSaving(true)
    setError("")
    try {
      await applyDirectoryEdits(vm.sourceCollection, vm.sourceId, vm.type, edits)
      onSaved()
    } catch (err) {
      setError(err instanceof DirectoryWriteError ? err.message : "Changes could not be saved. Try again.")
      setIsSaving(false)
    }
  }

  return (
    <div className="directory-glass-screen animate-slide-in-right absolute inset-0 z-30 flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">{TITLES[vm.type]}</h2>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || !dirty}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-40",
            "bg-[var(--directory-title)]/15 text-[var(--directory-title)]",
          )}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {error && (
            <p className="mb-4 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-4">
            {initial.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{field.label}</span>
                {field.multiline ? (
                  <textarea
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm leading-6 text-foreground/90 placeholder:text-muted-foreground/40 focus:border-white/20 focus:outline-none"
                  />
                ) : (
                  <input
                    type={field.inputType === "tel" ? "tel" : field.inputType === "email" ? "email" : field.inputType === "url" ? "url" : "text"}
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-white/20 focus:outline-none"
                  />
                )}
              </label>
            ))}
          </div>
          <p className="mt-5 text-[11px] leading-5 text-muted-foreground/45">
            Edits update the public Overview and search across the app within a few seconds.
          </p>
        </div>
      </main>
    </div>
  )
}
