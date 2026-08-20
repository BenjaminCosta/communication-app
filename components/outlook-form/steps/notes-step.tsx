"use client"

import { CalendarDays, Clock, CloudSun, Handshake, ListChecks, MapPin, Truck, Users, type LucideIcon, ClipboardCheck } from "lucide-react"
import { formatOutlookDate } from "@/lib/outlook-core"
import { OutlookFormStepLayout } from "@/components/outlook-form/step-layout"
import { OutlookFormCard, OutlookFormChip } from "@/components/outlook-form/ui/outlook-form-primitives"
import { OutlookFormTextarea } from "@/components/outlook-form/ui/outlook-form-fields"
import { OUTLOOK_FORM_NOTE_TAGS, type OutlookFormNoteTagId } from "@/lib/outlook-form-submissions/wizard-core"
import type { OutlookFormWizard } from "@/features/outlook-form/use-outlook-form-wizard"

const NOTE_TAG_ICON: Record<OutlookFormNoteTagId, LucideIcon> = {
  delay: Clock,
  delivery: Truck,
  inspection: ClipboardCheck,
  manpower: Users,
  weather: CloudSun,
  coordination: Handshake,
}

const NOTES_MAX_LENGTH = 500

export function NotesStep({ wizard }: { wizard: OutlookFormWizard }) {
  const taskCount = wizard.tasks.filter((task) => task.title.trim()).length

  return (
    <OutlookFormStepLayout title="Anything Frank should know?" intro="Optional notes, issues, or important updates." primary={{ label: "Continue", onClick: wizard.goNext }}>
      <div className="grid grid-cols-3 gap-2">
        {OUTLOOK_FORM_NOTE_TAGS.map(({ id, label }) => {
          const Icon = NOTE_TAG_ICON[id]
          return (
            <OutlookFormChip
              key={id}
              label={label}
              icon={<Icon className="h-3.5 w-3.5" strokeWidth={2} />}
              selected={wizard.noteTags.includes(id)}
              onClick={() => wizard.toggleNoteTag(id)}
            />
          )
        })}
      </div>

      <div className="mt-4">
        <OutlookFormTextarea value={wizard.notesText} onChange={wizard.setNotesText} placeholder="Add notes (optional)…" rows={6} maxLength={NOTES_MAX_LENGTH} />
      </div>

      <OutlookFormCard flat className="mt-5 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--of-text)]">
          <ListChecks className="h-4 w-4 text-[var(--of-blue-strong)]" strokeWidth={2} />
          Quick summary
        </p>
        <div className="flex flex-col gap-2 text-sm text-[var(--of-text-muted)]">
          <SummaryRow icon={MapPin} label={wizard.jobName || "No job selected"} />
          <SummaryRow icon={ListChecks} label={`${taskCount} work item${taskCount === 1 ? "" : "s"} added`} />
          <SummaryRow icon={CalendarDays} label={`${formatOutlookDate(wizard.window.start)} – ${formatOutlookDate(wizard.window.end, { month: "short", day: "numeric", year: "numeric" })}`} />
        </div>
      </OutlookFormCard>
    </OutlookFormStepLayout>
  )
}

function SummaryRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-[var(--of-text-muted)]" strokeWidth={2} />
      {label}
    </span>
  )
}
