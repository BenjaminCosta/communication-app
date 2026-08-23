"use client"

/**
 * The one real Outlook write/PDF/Comms sequence — publish a version, generate
 * its PDF, upload it to Directory, attach it, post to Communications. Used by
 * BOTH Directory's own interactive Outlook editor
 * (features/outlooks/use-job-outlook-controller.ts) and Courtney Roberts
 * Center's "Generate Outlook" action (reviewed form submission → real
 * Outlook). Extracted so there is exactly one implementation of this
 * sequence, not two hand-mirrored copies — the whole point of reusing
 * Directory's existing Outlook logic instead of building a parallel
 * Courtney-specific generator.
 *
 * Client Firestore/Storage SDK only, same as job-outlooks.ts/directory-files.ts
 * — must run in an authenticated browser session, with `userId` equal to
 * that session's real signed-in uid (Firestore/Storage rules enforce this).
 */

import { attachPdfToOutlookVersion, publishJobOutlook, type JobOutlookVersion } from "@/lib/job-outlooks"
import { uploadDirectoryFile } from "@/lib/directory-files"
import { formatOutlookRange, type OutlookTask, type OutlookWindow } from "@/lib/outlook-core"
import { publishOutlookVersionToComms } from "@/features/outlooks/outlook-comms-client"

export interface GenerateRealOutlookInput {
  userId: string
  /** Raw contexts/{id} doc id (job.sourceId), NOT the composite directory id. */
  jobId: string
  /** Composite "job__<id>" directory id (job.id) — required for uploadDirectoryFile's entityIds. */
  jobDirectoryId: string
  jobName: string
  companyName?: string | null
  location?: string | null
  window: OutlookWindow
  tasks: OutlookTask[]
  expectedRevision?: number | null
}

export interface GenerateRealOutlookResult {
  version: JobOutlookVersion
  revision: number
  /** False when the Outlook + PDF were created successfully but posting to Communications failed (e.g. the "3 Week Outlook" project tag doesn't exist yet) — non-fatal, the real Outlook already exists either way. */
  commsPublished: boolean
  commsError?: string
}

/** "storage/unauthorized" gets a friendlier message; everything else falls back to the raw error text. */
export function outlookPdfErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : ""
  if (code === "storage/unauthorized") {
    return "The version was saved, but PDF upload is not enabled in Storage yet. Try again after Storage rules are updated."
  }
  return error instanceof Error ? error.message : "The PDF could not be generated."
}

export async function generateRealOutlook(input: GenerateRealOutlookInput): Promise<GenerateRealOutlookResult> {
  const published = await publishJobOutlook({
    userId: input.userId,
    jobId: input.jobId,
    jobDirectoryId: input.jobDirectoryId,
    window: input.window,
    tasks: input.tasks,
    expectedRevision: input.expectedRevision,
  })
  let version = published.version

  if (!version.pdf) {
    const { generateOutlookPdf } = await import("@/features/outlooks/pdf/generate-outlook-pdf")
    const bytes = await generateOutlookPdf({
      jobName: input.jobName,
      companyName: input.companyName,
      location: input.location,
      window: input.window,
      versionNumber: version.versionNumber,
      tasks: version.tasks,
    })
    const safeJob = input.jobName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "job"
    const fileName = `${safeJob}-3-week-outlook-${input.window.start}-v${version.versionNumber}.pdf`
    const file = new File([bytes as BlobPart], fileName, { type: "application/pdf" })
    const stored = await uploadDirectoryFile(input.userId, input.jobDirectoryId, file, {
      category: "report",
      caption: `3-Week Outlook · ${formatOutlookRange(input.window)} · Version ${version.versionNumber}`,
    })
    const pdf = { directoryFileId: stored.id, storagePath: stored.storagePath, downloadUrl: stored.downloadUrl, fileName: stored.fileName }
    await attachPdfToOutlookVersion(input.jobId, input.window.start, version.id, pdf)
    version = { ...version, pdf }
  }

  let commsPublished = true
  let commsError: string | undefined
  try {
    await publishOutlookVersionToComms({ jobContextId: input.jobId, windowStart: input.window.start, versionId: version.id })
  } catch (err) {
    commsPublished = false
    commsError = outlookPdfErrorMessage(err)
  }

  return { version, revision: published.revision, commsPublished, commsError }
}
