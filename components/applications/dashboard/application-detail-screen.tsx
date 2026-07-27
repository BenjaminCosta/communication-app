"use client"

/**
 * Internal Applications dashboard — candidate detail.
 *
 * Read then decide: summary, progress, one checklist that includes the
 * operating agreement, what's missing, the AI placeholder, then activity.
 * The two decisions sit at the bottom; archive hides in the header menu so
 * it can't be hit by accident.
 */

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  FileSignature,
  FileText,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  MoreVertical,
  Phone,
  Play,
  Share2,
  Trash2,
  User,
  Video,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AppsSheet } from "@/components/applications/ui/apps-sheet"
import {
  AiSummaryCard,
  AppsButton,
  AppsCard,
  Avatar,
  NoticeBadge,
  ProgressBar,
  SectionLabel,
  StatusPill,
} from "@/components/applications/ui/apps-primitives"
import { RequestInfoScreen } from "@/components/applications/dashboard/request-info-screen"
import { ShareLinkSheet } from "@/components/applications/dashboard/share-link-sheet"
import { useShareLink } from "@/features/applications/use-share-link"
import { issueApplicationLink } from "@/features/applications/candidate-links"
import { downloadApplicationFile, getApplicationDownloadUrl } from "@/lib/applications-storage"
import {
  downloadApplicationProfilePdf,
  downloadSignedAgreementPdf,
  loadSignedAgreementPdf,
  type ReviewerIdentity,
} from "@/lib/applications-writes"
import { TONE_STYLES, toneForSectionState } from "@/components/applications/ui/tone"
import {
  AGREEMENT_STATUS_META,
  APPLICATION_STATUS_META,
  canApprove,
  canArchive,
  canMarkHired,
  canRequestInfo,
  canUnarchive,
  computeApplicationProgress,
  formatApplicationDate,
  formatRelativeDate,
  initialsFor,
  needsAgreementAttention,
  type ApplicationSectionId,
  type ApplicationTone,
  type ActivityEvent,
  type CandidateApplication,
  type RequiredDocument,
} from "@/lib/applications-core"

const SECTION_ICON: Record<ApplicationSectionId, typeof User> = {
  general: User,
  video: Video,
  documents: FileText,
}

interface ChecklistRowProps {
  icon: typeof User
  label: string
  detail: string
  tone: ApplicationTone
  onClick?: () => void
  trailing?: "chevron" | "lock"
  /** Small notice count next to the trailing icon — e.g. "needs a signature". */
  badge?: boolean
}

function ChecklistRow({ icon: Icon, label, detail, tone, onClick, trailing, badge }: ChecklistRowProps) {
  const body = (
    <>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", TONE_STYLES[tone].soft, TONE_STYLES[tone].text)}>
        <Icon className="h-4 w-4" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--apps-text)]">{label}</span>
      <span className={cn("shrink-0 text-[0.8125rem] font-semibold", TONE_STYLES[tone].text)}>{detail}</span>
      {badge && <NoticeBadge tone={tone} />}
      {trailing === "chevron" && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />}
      {trailing === "lock" && <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />}
    </>
  )

  if (!onClick) return <div className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--apps-surface-2)]"
    >
      {body}
    </button>
  )
}

function documentPresentation(document: RequiredDocument): {
  label: string
  tone: ApplicationTone
  detail: string
} {
  if (!document.required || document.status === "not_required") {
    return { label: "Not required", tone: "neutral", detail: document.helper }
  }
  if (document.status === "missing") return { label: "Missing", tone: "missing", detail: document.helper }
  if (document.status === "verified") {
    return { label: "Verified", tone: "complete", detail: `${document.fileName} · ${formatRelativeDate(document.uploadedAt)}` }
  }
  return { label: "Uploaded", tone: "complete", detail: `${document.fileName} · ${formatRelativeDate(document.uploadedAt)}` }
}

interface ApplicationDetailScreenProps {
  application: CandidateApplication
  className?: string
  onBack: () => void
  onRequestInfo: (message: string) => Promise<boolean>
  onApprove: () => Promise<import("@/lib/applications-core").ApplicationLink | null>
  onMarkHired: () => Promise<boolean>
  onArchive: () => Promise<boolean>
  onUnarchive: () => Promise<boolean>
  onDelete: () => Promise<boolean>
  onPreviewCandidateFlow: (token: string) => void
  reviewer?: ReviewerIdentity
  onRecordActivity?: (kind: ActivityEvent["kind"], message: string) => void
}

export function ApplicationDetailScreen({
  application,
  className,
  onBack,
  onRequestInfo,
  onApprove,
  onMarkHired,
  onArchive,
  onUnarchive,
  onDelete,
  onPreviewCandidateFlow,
  reviewer,
  onRecordActivity,
}: ApplicationDetailScreenProps) {
  const [sheet, setSheet] = useState<
    "approve" | "archive" | "unarchive" | "delete" | "hire" | "menu" | "documents" | "agreement" | "video" | null
  >(null)
  const shareLink = useShareLink(reviewer)
  const [requestOpen, setRequestOpen] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isHiring, setIsHiring] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isUnarchiving, setIsUnarchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [videoDownloadUrl, setVideoDownloadUrl] = useState(application.video.downloadUrl)
  const [documentDownloadUrls, setDocumentDownloadUrls] = useState<Record<string, string>>({})
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null)
  const [fileActionError, setFileActionError] = useState<string | null>(null)
  const [isPreparingProfilePdf, setIsPreparingProfilePdf] = useState(false)
  const [profilePdfError, setProfilePdfError] = useState<string | null>(null)
  const [isDownloadingAgreement, setIsDownloadingAgreement] = useState(false)
  const [isOpeningAgreementPreview, setIsOpeningAgreementPreview] = useState(false)
  const [agreementDownloadError, setAgreementDownloadError] = useState<string | null>(null)
  const [agreementPreview, setAgreementPreview] = useState<{ url: string; fileName: string } | null>(null)

  useEffect(
    () => () => {
      if (agreementPreview) URL.revokeObjectURL(agreementPreview.url)
    },
    [agreementPreview],
  )

  // The detail re-renders on every sheet toggle and file-action tick; the
  // progress only depends on the application itself.
  const progress = useMemo(() => computeApplicationProgress(application), [application])
  const status = APPLICATION_STATUS_META[application.status]
  const agreement = AGREEMENT_STATUS_META[application.agreement.status]
  const documentsSection = progress.sections.find((section) => section.id === "documents")
  const videoReady = application.video.state === "ready"
  const videoPlayable = videoReady && Boolean(videoDownloadUrl)

  const closeSheet = () => setSheet(null)

  // A valid upload can predate persisted download URLs. Resolve Storage paths
  // for staff review instead of leaving a ready video with nothing to play.
  useEffect(() => {
    let cancelled = false
    setVideoDownloadUrl(application.video.downloadUrl)
    if (application.video.downloadUrl || !application.video.storagePath) return () => {
      cancelled = true
    }
    getApplicationDownloadUrl(application.video.storagePath)
      .then((url) => {
        if (!cancelled) setVideoDownloadUrl(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [application.video.downloadUrl, application.video.storagePath])

  // Records from before download URLs were persisted still have their Storage
  // path. Resolve it once so every uploaded document stays reviewable.
  useEffect(() => {
    let cancelled = false
    const suppliedUrls = Object.fromEntries(
      application.documents
        .filter((document) => document.downloadUrl)
        .map((document) => [document.id, document.downloadUrl as string]),
    )
    setDocumentDownloadUrls(suppliedUrls)

    const unresolved = application.documents.filter((document) => !document.downloadUrl && document.storagePath)
    if (unresolved.length === 0) return () => {
      cancelled = true
    }

    Promise.all(
      unresolved.map(async (document) => [document.id, await getApplicationDownloadUrl(document.storagePath as string)] as const),
    )
      .then((entries) => {
        if (!cancelled) setDocumentDownloadUrls((current) => ({ ...current, ...Object.fromEntries(entries) }))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [application.documents])

  const handleApprove = async () => {
    setIsApproving(true)
    const agreementLink = await onApprove()
    setIsApproving(false)
    if (!agreementLink) return
    closeSheet()
    shareLink.openExisting({ applicationId: application.id, purpose: "agreement" }, agreementLink)
  }

  const handleMarkHired = async () => {
    setIsHiring(true)
    const completed = await onMarkHired()
    setIsHiring(false)
    if (completed) closeSheet()
  }

  const handleArchive = async () => {
    setIsArchiving(true)
    const archived = await onArchive()
    setIsArchiving(false)
    if (archived) closeSheet()
  }

  const handleUnarchive = async () => {
    setIsUnarchiving(true)
    const restored = await onUnarchive()
    setIsUnarchiving(false)
    if (restored) closeSheet()
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    const deleted = await onDelete()
    setIsDeleting(false)
    if (deleted) closeSheet()
  }

  const handleFileDownload = async (key: string, downloadUrl: string, fileName: string) => {
    setDownloadingFile(key)
    setFileActionError(null)
    try {
      await downloadApplicationFile(downloadUrl, fileName)
    } catch {
      setFileActionError("The file could not be downloaded. Please try opening it instead.")
    } finally {
      setDownloadingFile(null)
    }
  }

  const handleDownloadSignedAgreement = async () => {
    if (!reviewer) {
      setAgreementDownloadError("Your reviewer session is required to download the signed agreement.")
      return
    }
    setIsDownloadingAgreement(true)
    setAgreementDownloadError(null)
    try {
      await downloadSignedAgreementPdf(application.id, reviewer)
    } catch (error) {
      setAgreementDownloadError(error instanceof Error ? error.message : "The signed agreement could not be downloaded. Please try again.")
    } finally {
      setIsDownloadingAgreement(false)
    }
  }

  const handlePreviewSignedAgreement = async () => {
    if (!reviewer) {
      setAgreementDownloadError("Your reviewer session is required to preview the signed agreement.")
      return
    }
    setIsOpeningAgreementPreview(true)
    setAgreementDownloadError(null)
    try {
      const file = await loadSignedAgreementPdf(application.id, reviewer)
      setAgreementPreview({ url: URL.createObjectURL(file.blob), fileName: file.fileName })
    } catch (error) {
      setAgreementDownloadError(error instanceof Error ? error.message : "The signed agreement could not be previewed. Please try again.")
    } finally {
      setIsOpeningAgreementPreview(false)
    }
  }

  const handleProfilePdfDownload = async () => {
    if (!reviewer) {
      setProfilePdfError("Your reviewer session is required to download this application.")
      return
    }
    setIsPreparingProfilePdf(true)
    setProfilePdfError(null)
    try {
      const source = await downloadApplicationProfilePdf(application, reviewer)
      if (source === "local") {
        onRecordActivity?.("note", "Downloaded the candidate application profile PDF")
      }
      closeSheet()
    } catch (error) {
      setProfilePdfError(error instanceof Error ? error.message : "The application PDF could not be prepared. Please try again.")
    } finally {
      setIsPreparingProfilePdf(false)
    }
  }

  return (
    <div
      className={cn(
        // Same shape as DirectoryProfileScreen: the list sibling is hidden
        // while this is open, so it fills the module container.
        "applications-scope applications-canvas relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden",
        className,
      )}
    >
      <header className="applications-topbar app-topbar flex shrink-0 items-center justify-between gap-2 border-b px-4">
        <button
          type="button"
          onClick={onBack}
          className="applications-tap -ml-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text)] hover:bg-[var(--apps-surface-2)]"
          aria-label="Back to applications"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <span className="min-w-0 truncate text-[0.9375rem] font-bold text-[var(--apps-blue)]">{application.candidateName}</span>
        <button
          type="button"
          onClick={() => setSheet("menu")}
          className="applications-tap -mr-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--apps-text)] hover:bg-[var(--apps-surface-2)]"
          aria-label="More actions"
        >
          <MoreVertical className="h-5 w-5" strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="applications-step-enter mx-auto w-full max-w-2xl px-4 pb-8 pt-4 md:px-6">
          {/* Summary */}
          <div className="flex items-start gap-3.5">
            <div className="relative shrink-0">
              <Avatar initials={initialsFor(application.candidateName)} className="h-14 w-14 text-base" />
              {needsAgreementAttention(application) && (
                <NoticeBadge tone={agreement.tone} className="absolute -right-0.5 -top-0.5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold text-[var(--apps-text)]">{application.trade}</p>
                <StatusPill label={status.label} tone={status.tone} />
              </div>
              <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--apps-text-muted)]">{application.job.name}</p>
              <p className="mt-0.5 truncate text-[0.8125rem] text-[var(--apps-text-muted)]">{application.job.location}</p>
              <p className="mt-1 text-xs text-[var(--apps-text-muted)]">
                {application.submittedAt
                  ? `Applied on ${formatApplicationDate(application.submittedAt)}`
                  : `Started ${formatRelativeDate(application.createdAt).toLowerCase()}`}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {application.general.phone && (
              <a
                href={`tel:${application.general.phone.replace(/[^+\d]/g, "")}`}
                className="applications-tap flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
              >
                <Phone className="h-4 w-4 text-[var(--apps-blue-strong)]" strokeWidth={2} />
                <span className="text-[0.6875rem] font-semibold">Call</span>
              </a>
            )}
            {application.general.phone && (
              <a
                href={`sms:${application.general.phone.replace(/[^+\d]/g, "")}`}
                className="applications-tap flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
              >
                <MessageSquare className="h-4 w-4 text-[var(--apps-blue-strong)]" strokeWidth={2} />
                <span className="text-[0.6875rem] font-semibold">Text</span>
              </a>
            )}
            {application.general.email && (
              <a
                href={`mailto:${application.general.email}`}
                className="applications-tap flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
              >
                <Mail className="h-4 w-4 text-[var(--apps-blue-strong)]" strokeWidth={2} />
                <span className="text-[0.6875rem] font-semibold">Email</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => shareLink.openFor({ applicationId: application.id, purpose: "application" })}
              className="applications-tap flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] text-[var(--apps-text-muted)] hover:bg-[var(--apps-surface-2)]"
            >
              <Share2 className="h-4 w-4 text-[var(--apps-blue-strong)]" strokeWidth={2} />
              <span className="text-[0.6875rem] font-semibold">Share link</span>
            </button>
          </div>

          {/* Progress */}
          <AppsCard className="mt-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[0.8125rem] font-semibold text-[var(--apps-text)]">Application progress</h2>
              <span className="text-sm font-bold tabular-nums text-[var(--apps-blue-strong)]">{progress.percent}%</span>
            </div>
            <ProgressBar percent={progress.percent} className="mt-2.5" tone={progress.isComplete ? "complete" : "info"} />
          </AppsCard>

          {/* One checklist — the agreement is just the step after the others */}
          <AppsCard className="mt-3 overflow-hidden">
            <ul className="divide-y divide-[var(--apps-border)]">
              {progress.sections.map((section) => {
                const tone = toneForSectionState(section.state)
                const isDocuments = section.id === "documents"
                return (
                  <li key={section.id}>
                    <ChecklistRow
                      icon={section.state === "complete" ? CheckCircle2 : SECTION_ICON[section.id]}
                      label={section.label}
                      detail={section.detail}
                      tone={tone}
                      onClick={isDocuments ? () => setSheet("documents") : undefined}
                      trailing={isDocuments ? "chevron" : undefined}
                    />
                  </li>
                )
              })}
              <li>
                <ChecklistRow
                  icon={application.agreement.status === "locked" ? Lock : FileSignature}
                  label="Operating agreement"
                  detail={agreement.label}
                  tone={agreement.tone}
                  onClick={() => setSheet("agreement")}
                  trailing={application.agreement.status === "locked" ? "lock" : "chevron"}
                  badge={needsAgreementAttention(application)}
                />
              </li>
            </ul>
          </AppsCard>

          {/* Needs signature — the next step after approval, made hard to miss */}
          {needsAgreementAttention(application) && (
            <div className="mt-4">
              <AppsCard
                className={cn(
                  "overflow-hidden",
                  application.agreement.status === "expired"
                    ? "border-[#FBD0D0] bg-[var(--apps-missing-soft)]/45"
                    : "border-[#FDE68A] bg-[var(--apps-pending-soft)]/60",
                )}
                flat
              >
                <button
                  type="button"
                  onClick={() => setSheet("agreement")}
                  className={cn(
                    "applications-tap flex w-full items-center gap-3 px-4 py-3.5 text-left",
                    application.agreement.status === "expired"
                      ? "hover:bg-[var(--apps-missing-soft)]"
                      : "hover:bg-[var(--apps-pending-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white",
                      application.agreement.status === "expired" ? "text-[#DC5A5A]" : "text-[#B45309]",
                    )}
                  >
                    <FileSignature className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        application.agreement.status === "expired" ? "text-[#9F3030]" : "text-[#8A5A08]",
                      )}
                    >
                      {application.agreement.status === "expired" ? "Signing link expired" : "Waiting on signature"}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-xs",
                        application.agreement.status === "expired" ? "text-[#B44C4C]" : "text-[#9A6708]",
                      )}
                    >
                      {application.agreement.status === "expired"
                        ? "Send a new link so the candidate can sign."
                        : "Resend the link if the candidate hasn't signed yet."}
                    </span>
                  </span>
                  <NoticeBadge tone={agreement.tone} />
                  <ChevronRight
                    className={cn("h-4 w-4 shrink-0", application.agreement.status === "expired" ? "text-[#DC5A5A]" : "text-[#B45309]")}
                    strokeWidth={2}
                  />
                </button>
              </AppsCard>
            </div>
          )}

          {application.status === "payroll_in_progress" && (
            <AppsCard className="mt-4 border-[#FDE68A] bg-[var(--apps-pending-soft)] p-4" flat>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#B45309]">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-[#8A5A08]">Agreement signed</h2>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#9A6708]">
                    The candidate is ready for payroll. Complete your internal setup, then mark them as hired.
                  </p>
                </div>
              </div>
            </AppsCard>
          )}

          {application.status === "hired" && (
            <AppsCard className="mt-4 border-[#BBE8C6] bg-[var(--apps-complete-soft)] p-4" flat>
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#15803D]">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-[#15803D]">Candidate hired</h2>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#287C42]">
                    The agreement and payroll setup are complete. This candidate is fully onboarded.
                  </p>
                </div>
              </div>
            </AppsCard>
          )}

          {/* Missing items */}
          {progress.missingItems.length > 0 && (
            <div className="mt-4">
              <AppsCard className="overflow-hidden border-[#FBD0D0] bg-[var(--apps-missing-soft)]/45" flat>
                <button
                  type="button"
                  onClick={() => setRequestOpen(true)}
                  className="applications-tap flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--apps-missing-soft)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#DC5A5A]">
                    <AlertCircle className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#9F3030]">Missing items</span>
                    <span className="mt-0.5 block text-xs text-[#B44C4C]">Request the remaining information securely.</span>
                  </span>
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#FBD0D0] px-1.5 text-xs font-bold text-[#C24141]">
                    {progress.missingItems.length}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#DC5A5A]" strokeWidth={2} />
                </button>
                <ul className="divide-y divide-[#FBD0D0]">
                  {progress.missingItems.map((item) => (
                    <li
                      key={`${item.step}-${item.label}`}
                      className="flex min-h-[2.75rem] items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 truncate text-[0.8125rem] text-[var(--apps-text-muted)]">{item.label}</span>
                      <span className="shrink-0 text-xs font-semibold text-[#DC5A5A]">Missing</span>
                    </li>
                  ))}
                </ul>
              </AppsCard>
            </div>
          )}

          {/* Pending request */}
          {application.pendingRequest && (
            <div className="mt-4 rounded-2xl border border-[#FDE68A] bg-[var(--apps-pending-soft)] p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-[#B45309]" strokeWidth={2} />
                <h3 className="text-[0.8125rem] font-semibold text-[#B45309]">Waiting on the candidate</h3>
              </div>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[#8A5A08]">{application.pendingRequest}</p>
            </div>
          )}

          {/* Application information */}
          <div className="mt-5">
            <SectionLabel className="mb-2 px-1">Application information</SectionLabel>
            <AppsCard className="overflow-hidden" flat>
              <dl className="divide-y divide-[var(--apps-border)]">
                {[
                  { icon: User, label: "Full name", value: application.general.fullName || application.candidateName },
                  { icon: Phone, label: "Phone", value: application.general.phone || "Not provided" },
                  { icon: Mail, label: "Email", value: application.general.email || "Not provided" },
                  { icon: MapPin, label: "City, state", value: application.general.cityState || "Not provided" },
                  { icon: Clock, label: "Years of experience", value: application.general.yearsExperience ? `${application.general.yearsExperience} years` : "Not provided" },
                  { icon: User, label: "Primary trade", value: application.general.primaryTrade || application.trade || "Not provided" },
                  { icon: FileText, label: "Résumé", value: application.general.resumeFileName || "Not uploaded" },
                  { icon: FileText, label: "Work references", value: application.general.workReference || "Not provided" },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex min-h-[3.25rem] items-center gap-3 px-4 py-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
                    <dt className="min-w-0 flex-1 text-[0.75rem] font-medium text-[var(--apps-text-muted)]">{label}</dt>
                    <dd className="max-w-[58%] truncate text-right text-[0.8125rem] font-semibold text-[var(--apps-text)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </AppsCard>
          </div>

          {/* Intro video */}
          <div className="mt-5">
            <SectionLabel className="mb-2 px-1">Intro video</SectionLabel>
            <AppsCard className="p-4" flat>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--apps-ai-soft)] text-[var(--apps-ai)]">
                  <Video className="h-4.5 w-4.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-[var(--apps-text)]">{videoReady ? application.video.fileName : "No video uploaded"}</p>
                    <StatusPill label={videoReady ? "Uploaded" : "Missing"} tone={videoReady ? "complete" : "missing"} />
                  </div>
                  {videoReady ? (
                    <p className="mt-1 text-xs text-[var(--apps-text-muted)]">
                      {Math.floor((application.video.durationSeconds ?? 0) / 60)}:{String((application.video.durationSeconds ?? 0) % 60).padStart(2, "0")} · Uploaded {formatRelativeDate(application.video.capturedAt)}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--apps-text-muted)]">Request a short introduction before reviewing.</p>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <AppsButton
                  variant="secondary"
                  size="md"
                  fullWidth
                  disabled={!videoPlayable}
                  onClick={() => setSheet("video")}
                  icon={<Play className="h-4 w-4" strokeWidth={2} fill="currentColor" />}
                >
                  Watch video
                </AppsButton>
                <AppsButton
                  variant="secondary"
                  size="md"
                  fullWidth
                  disabled={!videoDownloadUrl || downloadingFile === "video"}
                  onClick={() => {
                    if (videoDownloadUrl) handleFileDownload("video", videoDownloadUrl, application.video.fileName ?? "intro-video")
                  }}
                  icon={<Download className="h-4 w-4" strokeWidth={2} />}
                >
                  {downloadingFile === "video" ? "Downloading…" : "Download"}
                </AppsButton>
              </div>
              {fileActionError && <p className="mt-3 text-xs font-medium text-[#C24141]">{fileActionError}</p>}
            </AppsCard>
            <AiSummaryCard
              className="mt-3"
              title="AI Video Summary"
              body={
                application.video.summary ??
                (videoReady
                  ? `${application.candidateName.split(" ")[0]} recorded a ${Math.round((application.video.durationSeconds ?? 0) / 60) || 1}-minute intro. The review summary will appear here when processing is connected.`
                  : "No intro video yet. The summary generates automatically after the candidate uploads one.")
              }
              footer={
                videoReady ? (
                  <button type="button" onClick={() => setSheet("video")} className="applications-tap inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D3EE0]">
                    <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                    View transcript
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D3EE0] opacity-60">
                    <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                    Waiting for upload
                  </span>
                )
              }
            />
          </div>

          {/* Documents */}
          <div className="mt-5">
            <SectionLabel className="mb-2 px-1">Documents</SectionLabel>
            <AppsCard className="overflow-hidden" flat>
              <ul className="divide-y divide-[var(--apps-border)]">
                {application.documents.map((document) => {
                  const presentation = documentPresentation(document)
                  const documentUrl = documentDownloadUrls[document.id]
                  return (
                    <li key={document.id} className="flex min-h-[3.25rem] items-center gap-3 px-4 py-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-[var(--apps-text-muted)]" strokeWidth={2} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-semibold text-[var(--apps-text)]">{document.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--apps-text-muted)]">{presentation.detail}</span>
                      </span>
                      {documentUrl ? (
                        <a
                          href={documentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="applications-tap flex h-8 items-center rounded-full border border-[var(--apps-border)] px-2.5 text-xs font-semibold text-[var(--apps-blue-strong)] hover:bg-[var(--apps-blue-soft)]"
                        >
                          View
                        </a>
                      ) : (
                        <StatusPill label={presentation.label} tone={presentation.tone} />
                      )}
                    </li>
                  )
                })}
              </ul>
              <button
                type="button"
                onClick={() => setSheet("documents")}
                className="applications-tap flex min-h-[3rem] w-full items-center justify-between px-4 text-left text-[0.8125rem] font-semibold text-[var(--apps-blue-strong)] hover:bg-[var(--apps-surface-2)]"
              >
                View document checklist
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </AppsCard>
          </div>

          {/* Activity */}
          <div className="mt-5">
            <SectionLabel className="mb-2 px-1">Activity</SectionLabel>
            <AppsCard className="p-4" flat>
              <ol className="flex flex-col gap-3.5">
                {[...application.activity].reverse().map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--apps-blue-soft)] ring-2 ring-[var(--apps-blue)]/25" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] font-medium leading-snug text-[var(--apps-text)]">{event.message}</p>
                      <p className="mt-0.5 text-xs text-[var(--apps-text-muted)]">
                        {event.actor} · {formatRelativeDate(event.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </AppsCard>
          </div>
        </div>
      </div>

      {/* Decisions */}
      <div
        className="shrink-0 border-t border-[var(--apps-border)] bg-[var(--apps-surface)] px-4 pt-3 md:px-6"
        style={{ paddingBottom: "max(0.875rem, var(--sab))" }}
      >
        <div className="mx-auto flex w-full max-w-2xl gap-2.5">
          {canMarkHired(application.status) ? (
            <AppsButton fullWidth onClick={() => setSheet("hire")} icon={<CheckCircle2 className="h-4.5 w-4.5" strokeWidth={2} />}>
              Mark hired
            </AppsButton>
          ) : application.status === "hired" ? (
            <div className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-xl bg-[var(--apps-complete-soft)] px-5 text-[0.9375rem] font-semibold text-[#15803D]">
              <CheckCircle2 className="h-4.5 w-4.5" strokeWidth={2.2} />
              Onboarding complete
            </div>
          ) : (
            <>
              <AppsButton
                variant="secondary"
                fullWidth
                disabled={!canRequestInfo(application.status)}
                onClick={() => setRequestOpen(true)}
                icon={<MessageSquare className="h-4 w-4" strokeWidth={2} />}
              >
                Request info
              </AppsButton>
              <AppsButton
                fullWidth
                disabled={!canApprove(application.status)}
                onClick={() => setSheet("approve")}
                icon={<CheckCircle2 className="h-4.5 w-4.5" strokeWidth={2} />}
              >
                Approve
              </AppsButton>
            </>
          )}
        </div>
      </div>

      {/* Intro video preview and transcript */}
      <AppsSheet
        open={sheet === "video"}
        title="Intro video"
        description={videoReady ? `${application.video.fileName} · ${Math.floor((application.video.durationSeconds ?? 0) / 60)}:${String((application.video.durationSeconds ?? 0) % 60).padStart(2, "0")}` : "No video has been uploaded."}
        onClose={closeSheet}
      >
        {videoReady ? (
          <>
            {videoDownloadUrl ? (
              <>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={videoDownloadUrl}
                  className="aspect-video w-full rounded-2xl bg-[#0F172A]"
                />
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <a
                    href={videoDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="applications-tap inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] px-4 text-sm font-semibold text-[var(--apps-blue-strong)] hover:bg-[var(--apps-surface-2)]"
                  >
                    <ExternalLink className="h-4 w-4" strokeWidth={2} />
                    Open video
                  </a>
                  <AppsButton
                    variant="secondary"
                    size="md"
                    fullWidth
                    disabled={downloadingFile === "video"}
                    onClick={() => handleFileDownload("video", videoDownloadUrl, application.video.fileName ?? "intro-video")}
                    icon={<Download className="h-4 w-4" strokeWidth={2} />}
                  >
                    {downloadingFile === "video" ? "Downloading…" : "Download"}
                  </AppsButton>
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-3 text-[0.8125rem] leading-relaxed text-[#9F3030]">
                The video file is not available to play yet. Ask the candidate to upload it again.
              </p>
            )}
            <div className="mt-5">
              <SectionLabel className="mb-2 px-1">Transcript</SectionLabel>
              <p className="rounded-xl bg-[var(--apps-surface-2)] px-3.5 py-3 text-[0.8125rem] leading-relaxed text-[var(--apps-text)]">
                {application.video.transcript ?? "The transcript will appear here once video processing is connected."}
              </p>
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-[var(--apps-surface-2)] px-3.5 py-3 text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
            Request an intro video to unlock the video preview, transcript and AI summary.
          </p>
        )}
      </AppsSheet>

      {/* Documents detail */}
      <AppsSheet
        open={sheet === "documents"}
        title="Documents"
        description={documentsSection?.detail}
        onClose={closeSheet}
      >
        {fileActionError && (
          <p className="mb-3 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-3 text-[0.8125rem] font-medium text-[#C24141]">
            {fileActionError}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {application.documents.map((document) => {
            const presentation = documentPresentation(document)
            const documentUrl = documentDownloadUrls[document.id]
            const iconStyle =
              presentation.tone === "complete"
                ? "bg-[var(--apps-complete-soft)] text-[#15803D]"
                : presentation.tone === "missing"
                  ? "bg-[var(--apps-missing-soft)] text-[#DC5A5A]"
                  : "bg-[var(--apps-surface-2)] text-[var(--apps-text-muted)]"
            return (
              <li
                key={document.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-[var(--apps-border)] px-3.5 py-3",
                  documentUrl && "hover:border-[#BFDBFE]",
                )}
              >
                <span
                  className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconStyle)}
                >
                  {presentation.tone === "complete" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <FileText className="h-4 w-4" strokeWidth={2} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--apps-text)]">{document.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--apps-text-muted)]">{presentation.detail}</span>
                </span>
                {documentUrl ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="applications-tap flex h-9 items-center gap-1.5 rounded-full border border-[var(--apps-border)] px-3 text-xs font-semibold text-[var(--apps-blue-strong)] hover:bg-[var(--apps-blue-soft)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                      View
                    </a>
                    <button
                      type="button"
                      disabled={downloadingFile === document.id}
                      onClick={() => handleFileDownload(document.id, documentUrl, document.fileName ?? document.label)}
                      className="applications-tap flex h-9 w-9 items-center justify-center rounded-full border border-[var(--apps-border)] text-[var(--apps-blue-strong)] hover:bg-[var(--apps-blue-soft)] disabled:opacity-50"
                      aria-label={`Download ${document.label}`}
                    >
                      <Download className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </span>
                ) : (
                  <StatusPill label={presentation.label} tone={presentation.tone} />
                )}
              </li>
            )
          })}
        </ul>
      </AppsSheet>

      {/* Operating agreement */}
      <AppsSheet
        open={sheet === "agreement"}
        title="Operating agreement"
        description="The step after approval and before payroll."
        onClose={closeSheet}
      >
        <div className={cn("rounded-xl border p-3.5", TONE_STYLES[agreement.tone].pill)}>
          <p className="text-sm font-semibold">{agreement.label}</p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed opacity-90">{agreement.description}</p>
        </div>
        {(application.agreement.sentAt || application.agreement.signedAt) && (
          <p className="mt-3 px-1 text-xs text-[var(--apps-text-muted)]">
            {application.agreement.signedAt
              ? `Signed ${formatApplicationDate(application.agreement.signedAt)}`
              : application.agreement.status === "expired"
                ? `Expired ${formatApplicationDate(application.agreement.expiresAt)}`
                : `Sent ${formatApplicationDate(application.agreement.sentAt)}`}
          </p>
        )}
        {application.agreement.status !== "locked" && (
          <div className="mt-4 flex flex-col gap-2.5">
            {application.agreement.status !== "signed" && (
              <AppsButton
                variant="secondary"
                fullWidth
                icon={<Share2 className="h-4 w-4" strokeWidth={2} />}
                onClick={() => {
                  closeSheet()
                  shareLink.openFor({ applicationId: application.id, purpose: "agreement" })
                }}
              >
                {application.agreement.sentAt ? "Resend agreement link" : "Send agreement link"}
              </AppsButton>
            )}
            {application.agreement.status !== "signed" && (
              <AppsButton
                variant="ghost"
                fullWidth
                icon={<FileSignature className="h-4 w-4" strokeWidth={2} />}
                onClick={() => {
                  closeSheet()
                  // Issue a real link so the preview resolves the same way the
                  // candidate's would.
                  onPreviewCandidateFlow(
                    issueApplicationLink({ applicationId: application.id, purpose: "agreement" }).token,
                  )
                }}
              >
                Preview the signing screen
              </AppsButton>
            )}
            {application.agreement.status === "signed" && (
              <>
                <AppsButton
                  variant="secondary"
                  fullWidth
                  disabled={isOpeningAgreementPreview}
                  icon={<FileText className="h-4 w-4" strokeWidth={2} />}
                  onClick={handlePreviewSignedAgreement}
                >
                  {isOpeningAgreementPreview ? "Opening…" : "Preview signed agreement"}
                </AppsButton>
                <AppsButton
                  variant="ghost"
                  fullWidth
                  disabled={isDownloadingAgreement}
                  icon={<Download className="h-4 w-4" strokeWidth={2} />}
                  onClick={handleDownloadSignedAgreement}
                >
                  {isDownloadingAgreement ? "Preparing…" : "Download signed agreement"}
                </AppsButton>
              </>
            )}
          </div>
        )}
        {agreementDownloadError && (
          <p className="mt-3 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-2.5 text-[0.8125rem] font-medium text-[#DC5A5A]">
            {agreementDownloadError}
          </p>
        )}
        <p className="mt-4 rounded-xl bg-[var(--apps-surface-2)] px-3.5 py-3 text-xs leading-relaxed text-[var(--apps-text-muted)]">
          {application.agreement.status === "signed"
            ? "The signed PDF and audit evidence are sealed server-side. You can preview or download the sealed copy here."
            : "The signed PDF and audit evidence are sealed server-side when the candidate signs."}
        </p>
      </AppsSheet>

      <AppsSheet
        open={agreementPreview !== null}
        title="Signed operating agreement"
        description={agreementPreview?.fileName}
        onClose={() => setAgreementPreview(null)}
        className="md:max-w-4xl"
        footer={
          <AppsButton
            fullWidth
            variant="secondary"
            disabled={isDownloadingAgreement}
            icon={<Download className="h-4 w-4" strokeWidth={2} />}
            onClick={handleDownloadSignedAgreement}
          >
            {isDownloadingAgreement ? "Preparing…" : "Download PDF"}
          </AppsButton>
        }
      >
        {agreementPreview && (
          <iframe
            title="Signed operating agreement PDF"
            src={agreementPreview.url}
            className="h-[66vh] w-full rounded-xl border border-[var(--apps-border)] bg-white"
          />
        )}
      </AppsSheet>

      {/* Approve */}
      <AppsSheet
        open={sheet === "approve"}
        title={`Approve ${application.candidateName}?`}
        description="This unlocks the operating agreement, which is the next step before payroll."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2.5">
            <AppsButton variant="secondary" fullWidth onClick={closeSheet}>
              Cancel
            </AppsButton>
            <AppsButton
              fullWidth
              disabled={isApproving}
              onClick={handleApprove}
            >
              {isApproving ? "Approving…" : "Approve"}
            </AppsButton>
          </div>
        }
      >
        {progress.missingItems.length > 0 ? (
          <div className="rounded-xl border border-[#FDE68A] bg-[var(--apps-pending-soft)] p-3.5">
            <p className="text-[0.8125rem] font-semibold text-[#B45309]">
              {progress.missingItems.length} item{progress.missingItems.length === 1 ? " is" : "s are"} still missing
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#8A5A08]">
              You can approve anyway, but the candidate will still owe: {progress.missingItems.map((item) => item.label).join(", ")}.
            </p>
          </div>
        ) : (
          <p className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
            Everything required is in and verified. The candidate moves to Agreement pending.
          </p>
        )}
      </AppsSheet>

      {/* More actions */}
      <AppsSheet open={sheet === "menu"} title="Application actions" onClose={closeSheet}>
        {profilePdfError && (
          <p className="mb-3 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-3 text-[0.8125rem] font-medium text-[#C24141]">
            {profilePdfError}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          <li>
            <button
              type="button"
              disabled={isPreparingProfilePdf}
              onClick={handleProfilePdfDownload}
              className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-complete-soft)] text-[#15803D]">
                <Download className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--apps-text)]">
                  {isPreparingProfilePdf ? "Preparing application PDF…" : "Download application PDF"}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">
                  Includes profile, documents, video transcript and agreement.
                </span>
              </span>
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                closeSheet()
                shareLink.openFor({ applicationId: application.id, purpose: "application" })
              }}
              className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]">
                <Share2 className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--apps-text)]">Share application link</span>
                <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">
                  Opens wherever the candidate left off.
                </span>
              </span>
            </button>
          </li>
          {application.agreement.status !== "locked" && application.agreement.status !== "signed" && (
            <li>
              <button
                type="button"
                onClick={() => {
                  closeSheet()
                  shareLink.openFor({ applicationId: application.id, purpose: "agreement" })
                }}
                className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]">
                  <FileSignature className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--apps-text)]">Send agreement link</span>
                  <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Expires in 3 days.</span>
                </span>
              </button>
            </li>
          )}
          {canUnarchive(application.status) ? (
            <li>
              <button
                type="button"
                onClick={() => setSheet("unarchive")}
                className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)]"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-blue-soft)] text-[var(--apps-blue-strong)]">
                  <ArchiveRestore className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--apps-text)]">Unarchive application</span>
                  <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Puts it back in the active pipeline.</span>
                </span>
              </button>
            </li>
          ) : (
            <li>
              <button
                type="button"
                disabled={!canArchive(application.status)}
                onClick={() => setSheet("archive")}
                className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)] disabled:opacity-45"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-missing-soft)] text-[#DC5A5A]">
                  <Archive className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--apps-text)]">Archive application</span>
                  <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Closes it without hiring.</span>
                </span>
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={() => setSheet("delete")}
              className="applications-tap flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--apps-surface-2)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--apps-missing-soft)] text-[#DC5A5A]">
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--apps-text)]">Delete application</span>
                <span className="mt-0.5 block text-xs text-[var(--apps-text-muted)]">Permanently removes it. Cannot be undone.</span>
              </span>
            </button>
          </li>
        </ul>
      </AppsSheet>

      {/* Archive confirm */}
      <AppsSheet
        open={sheet === "archive"}
        title={`Archive ${application.candidateName}?`}
        description="The candidate stays searchable but leaves the active pipeline."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2.5">
            <AppsButton variant="secondary" fullWidth onClick={closeSheet}>
              Cancel
            </AppsButton>
            <AppsButton
              variant="danger"
              fullWidth
              disabled={isArchiving}
              onClick={handleArchive}
            >
              {isArchiving ? "Archiving…" : "Archive"}
            </AppsButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
          You can find archived applications again with the Status filter.
        </p>
      </AppsSheet>

      {/* Unarchive confirm */}
      <AppsSheet
        open={sheet === "unarchive"}
        title={`Unarchive ${application.candidateName}?`}
        description="Puts the candidate back in the active pipeline."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2.5">
            <AppsButton variant="secondary" fullWidth onClick={closeSheet}>
              Cancel
            </AppsButton>
            <AppsButton fullWidth disabled={isUnarchiving} onClick={handleUnarchive}>
              {isUnarchiving ? "Restoring…" : "Unarchive"}
            </AppsButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
          {application.previousStatus
            ? `Returns to ${APPLICATION_STATUS_META[application.previousStatus].label}.`
            : "Returns to the review pipeline."}
        </p>
      </AppsSheet>

      {/* Delete confirm — permanent, so it gets the strongest warning in this menu */}
      <AppsSheet
        open={sheet === "delete"}
        title={`Delete ${application.candidateName}?`}
        description="This permanently removes the application. It cannot be undone."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2.5">
            <AppsButton variant="secondary" fullWidth onClick={closeSheet}>
              Cancel
            </AppsButton>
            <AppsButton variant="danger" fullWidth disabled={isDeleting} onClick={handleDelete}>
              {isDeleting ? "Deleting…" : "Delete permanently"}
            </AppsButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
          Deletes the candidate&rsquo;s profile, uploaded documents, intro video and signed agreement, and revokes
          every secure link tied to it.
        </p>
      </AppsSheet>

      {/* Payroll complete → hired */}
      <AppsSheet
        open={sheet === "hire"}
        title={`Mark ${application.candidateName} as hired?`}
        description="Use this after payroll and internal onboarding are complete."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2.5">
            <AppsButton variant="secondary" fullWidth onClick={closeSheet}>
              Cancel
            </AppsButton>
            <AppsButton fullWidth disabled={isHiring} onClick={handleMarkHired}>
              {isHiring ? "Updating…" : "Mark hired"}
            </AppsButton>
          </div>
        }
      >
        <p className="text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">
          The operating agreement is signed. This finalizes the candidate’s application as fully onboarded.
        </p>
      </AppsSheet>

      <ShareLinkSheet
        open={shareLink.isOpen}
        link={shareLink.link}
        error={shareLink.error}
        candidateName={application.candidateName}
        jobName={application.job.name}
        mode={shareLink.request?.purpose === "agreement" ? "approval" : "default"}
        onMessageCopied={() => onRecordActivity?.("message_copied", "Copied the approval message")}
        onMessageShared={(method) =>
          onRecordActivity?.(
            "message_shared",
            method === "sms" ? "Shared the approval message by text" : "Shared the approval message",
          )
        }
        onClose={shareLink.close}
        onRegenerate={shareLink.regenerate}
        onRevoke={shareLink.revoke}
      />

      {/* Request information — full screen, not a sheet: it's a task, not a confirm */}
      {requestOpen && (
        <RequestInfoScreen
          application={application}
          reviewer={reviewer}
          onClose={() => setRequestOpen(false)}
          onSend={onRequestInfo}
        />
      )}
    </div>
  )
}
