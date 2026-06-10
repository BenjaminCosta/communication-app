"use client"

import { useState } from "react"
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AppContext } from "@/lib/store"

interface ContextDetailScreenProps {
  context: AppContext
  currentUserId: string
  onBack: () => void
  onUpdate: (
    id: string,
    updates: Partial<Pick<AppContext, "name" | "description" | "fields">>
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
  className?: string
}

export function ContextDetailScreen({
  context,
  currentUserId,
  onBack,
  onUpdate,
  onDelete,
  className,
}: ContextDetailScreenProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(context.name)
  const [savingName, setSavingName] = useState(false)

  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(context.description ?? "")
  const [savingDesc, setSavingDesc] = useState(false)

  const [newFieldLabel, setNewFieldLabel] = useState("")
  const [newFieldValue, setNewFieldValue] = useState("")
  const [addingField, setAddingField] = useState(false)
  const [showFieldForm, setShowFieldForm] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isCreator = context.createdBy === currentUserId

  const saveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) { setNameValue(context.name); setEditingName(false); return }
    if (trimmed === context.name) { setEditingName(false); return }
    setSavingName(true)
    try { await onUpdate(context.id, { name: trimmed }) }
    finally { setSavingName(false); setEditingName(false) }
  }

  const saveDesc = async () => {
    const trimmed = descValue.trim()
    if (trimmed === (context.description ?? "").trim()) { setEditingDesc(false); return }
    setSavingDesc(true)
    try { await onUpdate(context.id, { description: trimmed || undefined }) }
    finally { setSavingDesc(false); setEditingDesc(false) }
  }

  const addField = async () => {
    const label = newFieldLabel.trim()
    const value = newFieldValue.trim()
    if (!label || addingField) return
    setAddingField(true)
    try {
      await onUpdate(context.id, { fields: [...context.fields, { label, value }] })
      setNewFieldLabel("")
      setNewFieldValue("")
      setShowFieldForm(false)
    } finally { setAddingField(false) }
  }

  const removeField = async (idx: number) => {
    await onUpdate(context.id, { fields: context.fields.filter((_, i) => i !== idx) })
  }

  const handleDelete = async () => {
    setDeleting(true)
    try { await onDelete(context.id) }
    finally { setDeleting(false) }
  }

  return (
    <div className={cn("flex-1 flex flex-col stream-glass-screen overflow-hidden", className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1 truncate">{context.name}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-5">

          {/* Name */}
          <div className="rounded-2xl bg-card border border-white/10 px-4 py-3 flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
              Name
            </span>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName()
                    if (e.key === "Escape") { setEditingName(false); setNameValue(context.name) }
                  }}
                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-emerald-400/40 transition-colors"
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  className="w-7 h-7 rounded-lg bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameValue(context.name) }}
                  className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{context.name}</span>
                <button
                  onClick={() => setEditingName(true)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="rounded-2xl bg-card border border-white/10 px-4 py-3 flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
              Description
            </span>
            {editingDesc ? (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={descValue}
                  onChange={(e) => setDescValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setEditingDesc(false); setDescValue(context.description ?? "") }
                  }}
                  placeholder="Describe this context..."
                  className="bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400/40 resize-none transition-colors min-h-[72px]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveDesc}
                    disabled={savingDesc}
                    className="px-3 py-1.5 rounded-lg bg-emerald-400/15 border border-emerald-400/25 text-emerald-400 text-xs font-semibold disabled:opacity-40 active:scale-95 transition-all"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingDesc(false); setDescValue(context.description ?? "") }}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground text-xs active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-foreground/80 flex-1">
                  {context.description || (
                    <span className="text-muted-foreground/40 italic">No description</span>
                  )}
                </span>
                <button
                  onClick={() => setEditingDesc(true)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-colors shrink-0"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </div>
            )}
          </div>

          {/* Custom fields */}
          <div className="rounded-2xl bg-card border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                Custom Fields
              </span>
              <button
                onClick={() => setShowFieldForm((v) => !v)}
                className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                + Add field
              </button>
            </div>

            {showFieldForm && (
              <div className="px-4 py-3 border-b border-white/8 flex flex-col gap-2 bg-white/3">
                <input
                  autoFocus
                  placeholder="Label (e.g. Phone, Company)"
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  className="bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-emerald-400/40 transition-colors"
                />
                <input
                  placeholder="Value"
                  value={newFieldValue}
                  onChange={(e) => setNewFieldValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addField() }}
                  className="bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-emerald-400/40 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addField}
                    disabled={!newFieldLabel.trim() || addingField}
                    className="px-3 py-1.5 rounded-lg bg-emerald-400/15 border border-emerald-400/25 text-emerald-400 text-xs font-semibold disabled:opacity-40 active:scale-95 transition-all"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowFieldForm(false); setNewFieldLabel(""); setNewFieldValue("") }}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground text-xs active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {context.fields.length === 0 && !showFieldForm ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground/40">No custom fields yet</p>
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {context.fields.map((field, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block">
                        {field.label}
                      </span>
                      <p className="text-sm text-foreground/90 truncate">
                        {field.value || (
                          <span className="text-muted-foreground/40 italic">empty</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => removeField(idx)}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors shrink-0"
                    >
                      <X className="w-3 h-3 text-muted-foreground/40" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Metadata */}
          <p className="text-xs text-muted-foreground/40 px-1">
            Created {context.createdAt.toLocaleDateString()}
          </p>

          {/* Delete — only creator */}
          {isCreator && (
            <div className="flex justify-end pt-1">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground/60">Delete this context?</span>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-muted-foreground active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-lg bg-destructive/15 border border-destructive/25 text-xs font-semibold text-destructive disabled:opacity-40 active:scale-95 transition-all"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-xs text-destructive/60 hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete context
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
