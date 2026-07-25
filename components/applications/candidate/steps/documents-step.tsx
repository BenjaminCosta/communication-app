"use client"

import { FileText } from "lucide-react"
import { StepLayout } from "@/components/applications/candidate/step-layout"
import { UploadRow } from "@/components/applications/ui/apps-form"
import { StatusPill } from "@/components/applications/ui/apps-primitives"
import { missingDocuments, type RequiredDocument } from "@/lib/applications-core"

interface DocumentsStepProps {
  documents: RequiredDocument[]
  jobName: string
  upload?: { id: string; error: string | null } | null
  onUpload: (documentId: string, file: File) => void
  onRemove: (documentId: string) => void
  onContinue: () => void
}

export function DocumentsStep({ documents, jobName, upload, onUpload, onRemove, onContinue }: DocumentsStepProps) {
  const missing = missingDocuments(documents)
  const jobDocuments = documents.filter((document) => document.origin === "job")

  return (
    <StepLayout
      title="Please upload:"
      primary={{ label: "Continue to review", onClick: onContinue }}
      note="You can take a photo with your phone camera."
    >
      <div className="-mt-2 mb-3 flex items-center justify-between">
        <p className="text-[0.8125rem] font-medium text-[var(--apps-text-muted)]">
          {documents.length - missing.length} of {documents.length} uploaded
        </p>
        {missing.length > 0 && <StatusPill label={`${missing.length} missing`} tone="missing" dot />}
      </div>

      <div className="flex flex-col gap-2.5">
        {documents.map((document) => (
          <div key={document.id}>
            <UploadRow
              icon={<FileText className="h-4.5 w-4.5" strokeWidth={2} />}
              title={document.label}
              subtitle={document.helper}
              fileName={document.fileName}
              tone={document.status === "missing" ? "missing" : "neutral"}
              accept="image/*,application/pdf"
              busy={upload?.id === document.id && !upload.error}
              onPick={(file) => onUpload(document.id, file)}
              onClear={() => onRemove(document.id)}
            />
            {upload?.id === document.id && upload.error && (
              <p className="mt-1 px-1 text-xs font-medium text-[#DC5A5A]">{upload.error}</p>
            )}
          </div>
        ))}
      </div>

      {jobDocuments.length > 0 && (
        <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--apps-text-muted)]">
          {jobDocuments.length === 1 ? "One item is" : `${jobDocuments.length} items are`} required specifically for{" "}
          <span className="font-semibold text-[var(--apps-text)]">{jobName}</span>.
        </p>
      )}
    </StepLayout>
  )
}
