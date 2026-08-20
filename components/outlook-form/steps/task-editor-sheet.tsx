"use client"

import { Trash2 } from "lucide-react"
import { useState, useEffect } from "react"
import type { OutlookTask } from "@/lib/outlook-core"
import { OutlookFormButton, OutlookFormSheet } from "@/components/outlook-form/ui/outlook-form-primitives"
import { OutlookFormDateField, OutlookFormNumberField, OutlookFormTextField, OutlookFormTextarea } from "@/components/outlook-form/ui/outlook-form-fields"

interface TaskEditorSheetProps {
  editing: { task: OutlookTask; isNew: boolean } | null
  onSave: (task: OutlookTask) => void
  onRemove: (taskId: string) => void
  onClose: () => void
}

export function TaskEditorSheet({ editing, onSave, onRemove, onClose }: TaskEditorSheetProps) {
  const [draft, setDraft] = useState<OutlookTask | null>(editing?.task ?? null)

  useEffect(() => {
    setDraft(editing?.task ?? null)
  }, [editing])

  if (!editing || !draft) return null

  const patch = (fields: Partial<OutlookTask>) => setDraft((current) => (current ? { ...current, ...fields } : current))

  return (
    <OutlookFormSheet
      open
      title={editing.isNew ? "Add work item" : "Edit work item"}
      description="What's the main work planned, and when."
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2.5 pb-1">
          <OutlookFormButton fullWidth disabled={!draft.title.trim()} onClick={() => onSave(draft)}>
            {editing.isNew ? "Add to week" : "Save changes"}
          </OutlookFormButton>
          {!editing.isNew && (
            <OutlookFormButton fullWidth variant="danger" icon={<Trash2 className="h-4 w-4" strokeWidth={2} />} onClick={() => onRemove(draft.id)}>
              Remove work item
            </OutlookFormButton>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <OutlookFormTextField label="Work item" value={draft.title} onChange={(value) => patch({ title: value })} placeholder="e.g. Install wall framing" />
        <div className="grid grid-cols-2 gap-2.5">
          <OutlookFormTextField label="Trade" value={draft.trade} onChange={(value) => patch({ trade: value })} placeholder="e.g. Carpentry" />
          <OutlookFormTextField label="Company" value={draft.companyName} onChange={(value) => patch({ companyName: value })} placeholder="Optional" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <OutlookFormDateField label="Start date" value={draft.startDate ?? ""} onChange={(value) => patch({ startDate: value || null })} />
          <OutlookFormNumberField label="Duration (days)" value={draft.durationDays} onChange={(value) => patch({ durationDays: value })} />
        </div>
        <OutlookFormTextarea label="Notes (optional)" value={draft.description} onChange={(value) => patch({ description: value })} placeholder="Anything else about this task" rows={3} />
      </div>
    </OutlookFormSheet>
  )
}
