"use client"

/**
 * State for the candidate application flow.
 *
 * Two modes behind one surface, chosen by NEXT_PUBLIC_APPLICATIONS_BACKEND:
 *  - mock: everything is local (no fake data — a blank draft). The preview/dev
 *    path; opens instantly, nothing is persisted.
 *  - live: the browser opens a session (custom token) and reads/writes the real
 *    /applications doc. Edits are optimistic locally and persisted with a
 *    debounced autosave; documents and the intro video upload to Storage.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  computeApplicationProgress,
  emptyIntroVideo,
  emptySignatureDraft,
  nextCandidateStep,
  previousCandidateStep,
  OPERATING_AGREEMENT_TEMPLATE,
  resumeStep,
  type ApplicationLink,
  type ApplicationSectionId,
  type CandidateApplication,
  type CandidateStepId,
  type GeneralFieldId,
  type LinkPurpose,
  type SignatureDraft,
} from "@/lib/applications-core"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import { applicationById, applicationByToken, linkForToken, saveMockApplication } from "@/features/applications/candidate-links"
import {
  openCandidateSession,
  signCandidateAgreement,
  CandidateSessionError,
} from "@/features/applications/candidate-session"
import { saveCandidateDraft, submitCandidateApplication, subscribeApplication } from "@/lib/applications-writes"
import {
  deleteApplicationFile,
  readVideoDurationSeconds,
  uploadApplicationDocument,
  uploadApplicationVideo,
  validateDocumentFile,
  validateVideoFile,
} from "@/lib/applications-storage"

export type SaveState = "idle" | "saving" | "saved"
export type SessionState = "connecting" | "ready" | "error"

const SECTION_STEP: Record<ApplicationSectionId, CandidateStepId> = {
  general: "general",
  video: "video",
  documents: "documents",
}

const SAVE_DEBOUNCE_MS = 700

function nowIso(): string {
  return new Date().toISOString()
}

/** Where a session lands the candidate — the link decides, not the URL. */
function initialStepFor(
  purpose: LinkPurpose,
  step: ApplicationSectionId | null,
  application: CandidateApplication,
): CandidateStepId {
  if (purpose === "agreement") {
    return application.agreement.status === "signed" ? "agreement-signed" : "agreement"
  }
  if (purpose === "step" && step) return step
  // The original application link remains a convenient resume link. Once a
  // reviewer approves the candidate, it advances to the agreement instead of
  // returning them to the submitted confirmation screen.
  if (
    application.status === "approved" ||
    application.status === "agreement_pending" ||
    application.agreement.status === "awaiting_signature" ||
    application.agreement.status === "expired"
  ) {
    return application.agreement.status === "signed" ? "agreement-signed" : "agreement"
  }
  return "welcome"
}

function initialStepForLink(link: ApplicationLink, application: CandidateApplication): CandidateStepId {
  return initialStepFor(link.purpose, link.step, application)
}

export interface CandidateApplicationOptions {
  /**
   * Internal users previewing the flow from the dashboard. A preview must stay
   * on mock data: opening a real session would sign the reviewer OUT and sign
   * in as the candidate on the shared Firebase auth instance.
   */
  preview?: boolean
}

export function useCandidateApplication(token: string, options: CandidateApplicationOptions = {}) {
  const live = APPLICATIONS_BACKEND_ENABLED && !options.preview

  // Mock resolves synchronously; live starts empty and fills in after the
  // session opens.
  const [mockEntry] = useState(() => {
    if (live) return null
    const link = linkForToken(token)
    const application = applicationById(link.applicationId) ?? applicationByToken(token)
    return { link, application, step: initialStepForLink(link, application) }
  })

  const [application, setApplication] = useState<CandidateApplication | null>(mockEntry ? mockEntry.application : null)
  const [step, setStep] = useState<CandidateStepId>(mockEntry ? mockEntry.step : "welcome")
  const [signature, setSignature] = useState<SignatureDraft>(emptySignatureDraft)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [sessionState, setSessionState] = useState<SessionState>(live ? "connecting" : "ready")
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [videoUpload, setVideoUpload] = useState<{ percent: number | null; error: string | null }>({
    percent: null,
    error: null,
  })
  const [docUpload, setDocUpload] = useState<{ id: string; error: string | null } | null>(null)
  const [signState, setSignState] = useState<{ signing: boolean; error: string | null }>({
    signing: false,
    error: null,
  })

  const applicationIdRef = useRef<string | null>(mockEntry ? mockEntry.application.id : null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // In live mode the doc is authoritative; a local edit must not be clobbered
  // by a snapshot that arrives mid-typing.
  const dirtyRef = useRef(false)
  const bootstrappedStepRef = useRef(false)

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (videoTimer.current) clearTimeout(videoTimer.current)
    },
    [],
  )

  // ── Live session bootstrap ──────────────────────────────────────────────
  useEffect(() => {
    if (!live) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    ;(async () => {
      try {
        const session = await openCandidateSession(token)
        if (cancelled) return
        applicationIdRef.current = session.applicationId
        unsubscribe = subscribeApplication(
          session.applicationId,
          (next) => {
            if (cancelled || !next) return
            // Reconcile from the server unless the candidate is mid-edit.
            if (!dirtyRef.current) setApplication(next)
            if (!bootstrappedStepRef.current) {
              bootstrappedStepRef.current = true
              setStep(initialStepFor(session.purpose, session.step, next))
            }
            setSessionState("ready")
          },
          () => {
            if (cancelled) return
            setSessionError("We couldn't load your application. Please try the link again.")
            setSessionState("error")
          },
        )
      } catch (error) {
        if (cancelled) return
        setSessionError(error instanceof CandidateSessionError ? error.message : "This link cannot be opened.")
        setSessionState("error")
      }
    })()

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
    }
  }, [live, token])

  /** Debounced persistence. Mock fakes the round-trip; live writes Firestore. */
  const scheduleSave = useCallback(
    (snapshot: CandidateApplication) => {
      setSaveState("saving")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        if (!live) {
          saveMockApplication(snapshot)
          setSaveState("saved")
          return
        }
        const id = applicationIdRef.current
        if (!id) return
        saveCandidateDraft(id, {
          general: snapshot.general,
          video: snapshot.video,
          documents: snapshot.documents,
        })
          .then(() => {
            dirtyRef.current = false
            setSaveState("saved")
          })
          .catch(() => setSaveState("idle"))
      }, live ? SAVE_DEBOUNCE_MS : 420)
    },
    [live],
  )

  const mutate = useCallback(
    (patch: (application: CandidateApplication) => CandidateApplication) => {
      dirtyRef.current = true
      setApplication((current) => {
        if (!current) return current
        const next = { ...patch(current), updatedAt: nowIso() }
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const setGeneralField = useCallback(
    (field: GeneralFieldId, value: string) => {
      mutate((current) => ({ ...current, general: { ...current.general, [field]: value } }))
    },
    [mutate],
  )

  const attachResume = useCallback(
    (fileName: string) => setGeneralField("resumeFileName", fileName),
    [setGeneralField],
  )

  /**
   * Real capture. Live mode uploads the file to Storage (resumable, with
   * progress) and stores its path + URL; mock fakes the round-trip so the
   * preview/dev path still demonstrates the flow.
   */
  const captureVideo = useCallback(
    async (source: "record" | "upload", file: File) => {
      const validationError = validateVideoFile(file)
      if (validationError) {
        setVideoUpload({ percent: null, error: validationError })
        return
      }
      const capturedAt = nowIso()
      const durationSeconds = await readVideoDurationSeconds(file)
      // In mock mode there is no Storage upload. Keep a local object URL so
      // the dashboard preview can still play the file the candidate selected.
      const localVideoUrl = !live && typeof URL !== "undefined" ? URL.createObjectURL(file) : null
      mutate((current) => ({
        ...current,
        video: {
          ...current.video,
          state: "processing",
          source,
          fileName: file.name,
          durationSeconds,
          capturedAt,
          downloadUrl: localVideoUrl,
        },
      }))

      if (!live || !applicationIdRef.current) {
        setVideoUpload({ percent: null, error: null })
        if (videoTimer.current) clearTimeout(videoTimer.current)
        videoTimer.current = setTimeout(() => {
          mutate((current) => ({ ...current, video: { ...current.video, state: "ready" } }))
        }, 900)
        return
      }

      setVideoUpload({ percent: 0, error: null })
      try {
        const stored = await uploadApplicationVideo(applicationIdRef.current, file, (percent) =>
          setVideoUpload({ percent, error: null }),
        )
        setVideoUpload({ percent: 100, error: null })
        mutate((current) => ({
          ...current,
          video: {
            ...current.video,
            state: "ready",
            storagePath: stored.storagePath,
            downloadUrl: stored.downloadUrl,
            fileName: stored.fileName,
          },
        }))
      } catch {
        setVideoUpload({ percent: null, error: "The video didn't upload. Check your connection and try again." })
        mutate((current) => ({ ...current, video: { ...current.video, state: "not_started" } }))
      }
    },
    [live, mutate],
  )

  const removeVideo = useCallback(() => {
    if (videoTimer.current) clearTimeout(videoTimer.current)
    setVideoUpload({ percent: null, error: null })
    const path = application?.video.storagePath
    if (live && path) deleteApplicationFile(path)
    mutate((current) => ({ ...current, video: emptyIntroVideo() }))
  }, [application?.video.storagePath, live, mutate])

  const uploadDocument = useCallback(
    async (documentId: string, file: File) => {
      const validationError = validateDocumentFile(file)
      if (validationError) {
        setDocUpload({ id: documentId, error: validationError })
        return
      }

      if (!live || !applicationIdRef.current) {
        mutate((current) => ({
          ...current,
          documents: current.documents.map((document) =>
            document.id === documentId
              ? { ...document, status: "uploaded", fileName: file.name, uploadedAt: nowIso() }
              : document,
          ),
        }))
        return
      }

      setDocUpload({ id: documentId, error: null })
      try {
        const stored = await uploadApplicationDocument(applicationIdRef.current, documentId, file)
        mutate((current) => ({
          ...current,
          documents: current.documents.map((document) =>
            document.id === documentId
              ? {
                  ...document,
                  status: "uploaded",
                  fileName: stored.fileName,
                  storagePath: stored.storagePath,
                  downloadUrl: stored.downloadUrl,
                  uploadedAt: nowIso(),
                }
              : document,
          ),
        }))
        setDocUpload((current) => (current?.id === documentId ? null : current))
      } catch {
        setDocUpload({ id: documentId, error: "That file didn't upload. Please try again." })
      }
    },
    [live, mutate],
  )

  const removeDocument = useCallback(
    (documentId: string) => {
      const path = application?.documents.find((document) => document.id === documentId)?.storagePath
      if (live && path) deleteApplicationFile(path)
      mutate((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === documentId
            ? { ...document, status: "missing", fileName: null, storagePath: null, downloadUrl: null, uploadedAt: null }
            : document,
        ),
      }))
    },
    [application?.documents, live, mutate],
  )

  const submit = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!application) return
    const name = application.general.fullName || application.candidateName
    const submittedAt = nowIso()
    const next: CandidateApplication = {
      ...application,
      status: "submitted",
      submittedAt,
      updatedAt: submittedAt,
      candidateName: name,
      trade: application.general.primaryTrade || application.trade,
      activity: [
        ...application.activity,
        { id: `evt-${Date.now()}`, kind: "submitted", actor: "Candidate", message: "Submitted the application", at: submittedAt },
      ],
    }
    setApplication(next)

    if (live && applicationIdRef.current) {
      dirtyRef.current = false
      // Persist the latest draft, then flip to submitted. The snapshot
      // listener will reconcile the authoritative doc.
      saveCandidateDraft(applicationIdRef.current, {
        general: application.general,
        video: application.video,
        documents: application.documents,
      })
        .then(() => submitCandidateApplication(applicationIdRef.current as string, name))
        .catch(() => setSaveState("idle"))
    } else {
      // The local dashboard listens to this registry, so a real mock invite
      // immediately moves from Draft to Submitted instead of disappearing.
      saveMockApplication(next)
    }
    setStep("submitted")
  }, [application, live])

  const updateSignature = useCallback((patch: Partial<SignatureDraft>) => {
    setSignature((current) => ({ ...current, ...patch }))
  }, [])

  /**
   * Sign the agreement. Writing `agreement.status = "signed"` and sealing the
   * PDF are server-only (the rules forbid the candidate touching `agreement`),
   * so live mode posts the signature image to the sign endpoint, which seals
   * the PDF, stores the evidence and flips the status with the Admin SDK. Mock
   * mode flips locally so preview/dev still demonstrates the flow.
   *
   * `signatureDataUrl` is the PNG from the signature pad.
   */
  const signAgreement = useCallback(
    async (signatureDataUrl: string) => {
      const name = signature.typedName.trim()

      if (live && applicationIdRef.current) {
        setSignState({ signing: true, error: null })
        try {
          await signCandidateAgreement({ signatureDataUrl, typedName: name, consent: signature.consent })
          setSignState({ signing: false, error: null })
          // The snapshot listener will bring back the authoritative signed doc.
          setStep("agreement-signed")
        } catch (error) {
          setSignState({
            signing: false,
            error:
              error instanceof CandidateSessionError
                ? error.message
                : "We couldn't record your signature. Please try again.",
          })
        }
        return
      }

      if (!application) return
      const signedAt = nowIso()
      const next: CandidateApplication = {
        ...application,
        status: "payroll_in_progress",
        updatedAt: signedAt,
        agreement: {
          ...application.agreement,
          status: "signed",
          signedAt,
          signedVersion: OPERATING_AGREEMENT_TEMPLATE.version,
          signedName: name,
        },
        activity: [
          ...application.activity,
          {
            id: `evt-${Date.now()}`,
            kind: "agreement_signed",
            actor: "Candidate",
            message: `Signed the operating agreement (v${OPERATING_AGREEMENT_TEMPLATE.version})`,
            at: signedAt,
          },
        ],
      }
      // The mock dashboard subscribes to this same registry. Without this
      // write it could not see the signature or its payroll status.
      setApplication(next)
      saveMockApplication(next)
      setStep("agreement-signed")
    },
    [application, live, signature.consent, signature.typedName],
  )

  const goTo = useCallback((next: CandidateStepId) => setStep(next), [])
  const goToSection = useCallback((section: ApplicationSectionId) => setStep(SECTION_STEP[section]), [])
  const goNext = useCallback(() => setStep((current) => nextCandidateStep(current) ?? current), [])
  const goBack = useCallback(() => setStep((current) => previousCandidateStep(current) ?? current), [])

  /** "Continue application" — jumps to the first thing still missing. */
  const resume = useCallback(() => {
    if (application) setStep(resumeStep(application))
  }, [application])

  const progress = application
    ? computeApplicationProgress(application)
    : { percent: 0, sections: [], missingItems: [], isComplete: false }

  return {
    application,
    progress,
    step,
    saveState,
    sessionState,
    sessionError,
    signature,
    signState,
    videoUpload,
    docUpload,
    updateSignature,
    signAgreement,
    goTo,
    goToSection,
    goNext,
    goBack,
    resume,
    setGeneralField,
    attachResume,
    captureVideo,
    removeVideo,
    uploadDocument,
    removeDocument,
    submit,
  }
}

export type CandidateApplicationController = ReturnType<typeof useCandidateApplication>
