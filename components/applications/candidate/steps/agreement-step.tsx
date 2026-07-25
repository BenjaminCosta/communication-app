"use client"

/**
 * Operating agreement — read, consent, name, sign.
 *
 * The signing button stays out of reach until the candidate has actually
 * scrolled through the text: that "read to the end" gate is part of the
 * evidence trail, not decoration.
 */

import { useCallback, useRef, useState } from "react"
import { Check, FileSignature, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { AppsButton, AppsCard, StatusPill } from "@/components/applications/ui/apps-primitives"
import { SignaturePad, type SignaturePadHandle } from "@/components/applications/ui/signature-pad"
import {
  OPERATING_AGREEMENT_TEMPLATE,
  signatureReadiness,
  type CandidateApplication,
  type SignatureDraft,
} from "@/lib/applications-core"

interface AgreementStepProps {
  application: CandidateApplication
  signature: SignatureDraft
  /** Server signing state, so the button reflects the round-trip. */
  signState?: { signing: boolean; error: string | null }
  onSignatureChange: (patch: Partial<SignatureDraft>) => void
  onSign: (signatureDataUrl: string) => void
}

export function AgreementStep({ application, signature, signState, onSignatureChange, onSign }: AgreementStepProps) {
  const template = OPERATING_AGREEMENT_TEMPLATE
  const expectedName = application.general.fullName || application.candidateName
  const readiness = signatureReadiness(signature, expectedName)
  const scrollRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<SignaturePadHandle>(null)
  const [showPending, setShowPending] = useState(false)

  const handleScroll = useCallback(() => {
    const node = scrollRef.current
    if (!node || signature.reachedEnd) return
    // 24px of slack: nobody lands exactly on the last pixel.
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 24) {
      onSignatureChange({ reachedEnd: true })
    }
  }, [onSignatureChange, signature.reachedEnd])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="applications-step-enter mx-auto w-full max-w-xl px-5 pb-8 pt-5 md:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[var(--apps-text)]">
                {template.title}
              </h1>
              <p className="mt-1 text-xs font-medium text-[var(--apps-text-muted)]">
                Version {template.version} · {application.job.name}
              </p>
            </div>
            <StatusPill label="Approved" tone="complete" />
          </div>

          <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--apps-text-muted)]">{template.intro}</p>

          <AppsCard className="mt-4 p-5">
            <div className="flex flex-col gap-4">
              {template.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-[0.8125rem] font-bold text-[var(--apps-text)]">{section.heading}</h2>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--apps-text-muted)]">{section.body}</p>
                </section>
              ))}
            </div>
          </AppsCard>

          {!signature.reachedEnd ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-[var(--apps-text-muted)]">
              <Lock className="h-3.5 w-3.5" strokeWidth={2} />
              Keep scrolling to reach the signature
            </p>
          ) : (
            <div className="applications-step-enter mt-5">
              {/* Consent */}
              <button
                type="button"
                onClick={() => onSignatureChange({ consent: !signature.consent })}
                aria-pressed={signature.consent}
                className={cn(
                  "applications-tap flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left",
                  signature.consent
                    ? "border-[#BFDBFE] bg-[var(--apps-blue-soft)]/45"
                    : "border-[var(--apps-border)] bg-[var(--apps-surface)]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.375rem] border",
                    signature.consent
                      ? "border-transparent bg-[var(--apps-blue)] text-white"
                      : "border-[#C3D4E6] bg-[var(--apps-surface)]",
                  )}
                >
                  {signature.consent && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                <span className="text-[0.8125rem] leading-relaxed text-[var(--apps-text)]">
                  I have read this agreement and I agree to sign it electronically.
                </span>
              </button>

              {/* Typed name */}
              <div className="mt-3">
                <label
                  htmlFor="agreement-name"
                  className="mb-1.5 block px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]"
                >
                  Type your full name
                </label>
                <input
                  id="agreement-name"
                  value={signature.typedName}
                  onChange={(event) => onSignatureChange({ typedName: event.target.value })}
                  placeholder={expectedName || "Full name"}
                  autoComplete="name"
                  className="h-12 w-full rounded-xl border border-[var(--apps-border)] bg-[var(--apps-surface)] px-3.5 text-base text-[var(--apps-text)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#94A3B8] focus:border-[var(--apps-blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
                />
              </div>

              {/* Signature */}
              <div className="mt-4">
                <p className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-[var(--apps-text)]">Signature</p>
                <SignaturePad ref={padRef} onChange={(hasInk) => onSignatureChange({ hasSignature: hasInk })} />
              </div>

              {showPending && !readiness.ready && (
                <ul className="mt-4 flex flex-col gap-1.5 rounded-xl border border-[#FDE68A] bg-[var(--apps-pending-soft)] px-3.5 py-3">
                  {readiness.pending.map((item) => (
                    <li key={item} className="text-[0.8125rem] font-medium text-[#8A5A08]">
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {signState?.error && (
                <p className="mt-4 rounded-xl border border-[#FBD0D0] bg-[var(--apps-missing-soft)] px-3.5 py-3 text-[0.8125rem] font-medium text-[#DC5A5A]">
                  {signState.error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div
        className="shrink-0 border-t border-[var(--apps-border)] bg-[var(--apps-surface)] px-5 pt-3.5 md:px-6"
        style={{ paddingBottom: "max(1rem, var(--sab))" }}
      >
        <div className="mx-auto w-full max-w-xl">
          <AppsButton
            fullWidth
            disabled={!signature.reachedEnd || signState?.signing}
            icon={<FileSignature className="h-4.5 w-4.5" strokeWidth={2} />}
            onClick={() => {
              if (!readiness.ready) {
                setShowPending(true)
                return
              }
              const dataUrl = padRef.current?.toDataUrl()
              if (!dataUrl) {
                setShowPending(true)
                return
              }
              onSign(dataUrl)
            }}
          >
            {signState?.signing
              ? "Signing…"
              : signature.reachedEnd
                ? "Sign and submit"
                : "Read the agreement to continue"}
          </AppsButton>
          <p className="mt-2 text-center text-xs text-[var(--apps-text-muted)]">
            We keep a copy of this agreement with the date and time you signed it.
          </p>
        </div>
      </div>
    </div>
  )
}
