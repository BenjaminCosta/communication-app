"use client"

/**
 * Secure-link state for the dashboard.
 *
 * Mock mode keeps everything in an in-memory registry. Live mode persists to
 * `/applicationLinks` so the session endpoint can resolve the token, and an
 * invite for a brand-new candidate first creates a blank application to point
 * at (a link must reference a real application doc).
 */

import { useCallback, useState } from "react"
import {
  type ApplicationLink,
  type ApplicationSectionId,
  type InviteDetails,
  type LinkPurpose,
} from "@/lib/applications-core"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import {
  issueApplicationLink,
  NEW_APPLICATION_MARKER,
  revokeApplicationLink,
  updateMockApplication,
} from "@/features/applications/candidate-links"
import {
  createAgreementSigningLink,
  createReviewerApplicationLink,
  revokeApplicationLinkDoc,
  type ReviewerIdentity,
} from "@/lib/applications-writes"

/** Passed as `applicationId` to invite a brand-new candidate. */
export { NEW_APPLICATION_MARKER }

export interface IssueLinkInput {
  applicationId: string
  purpose: LinkPurpose
  step?: ApplicationSectionId | null
  /** For a NEW_APPLICATION_MARKER invite: the reviewer's up-front details. */
  invite?: InviteDetails
}

export function useShareLink(reviewer?: ReviewerIdentity) {
  const live = APPLICATIONS_BACKEND_ENABLED
  const [link, setLink] = useState<ApplicationLink | null>(null)
  const [request, setRequest] = useState<IssueLinkInput | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isIssuing, setIsIssuing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recordGeneratedLink = useCallback(
    (link: ApplicationLink) => {
      const message = `Generated a secure ${link.purpose === "agreement" ? "operating agreement" : link.purpose === "step" ? "direct application" : "application"} link`
      if (!live) {
        updateMockApplication(link.applicationId, (application) => ({
          ...application,
          updatedAt: new Date().toISOString(),
          activity: [
            ...application.activity,
            {
              id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: "link_generated",
              actor: reviewer?.name || "Reviewer",
              message,
              at: new Date().toISOString(),
            },
          ],
        }))
        return
      }
      // Live link issuance is an Admin SDK transaction, which writes this
      // activity entry alongside the credential. Do not append a duplicate
      // event from the browser.
    },
    [live, reviewer],
  )

  const issue = useCallback(
    async (input: IssueLinkInput): Promise<ApplicationLink> => {
      if (!live) {
        const created = issueApplicationLink(input)
        recordGeneratedLink(created)
        return created
      }

      // Agreement links also determine whether the candidate can sign. The
      // server refreshes the agreement window and persists its digest in the
      // same transaction, rather than leaving a browser-created link behind.
      if (input.purpose === "agreement") {
        if (!reviewer?.uid) throw new Error("A reviewer session is required to create an agreement link.")
        return createAgreementSigningLink(input.applicationId, reviewer)
      }

      if (!reviewer?.uid) throw new Error("A reviewer session is required to create a secure link.")
      return createReviewerApplicationLink({
        applicationId: input.applicationId,
        purpose: input.purpose,
        step: input.step ?? null,
        invite: input.invite,
      }, reviewer)
    },
    [live, recordGeneratedLink, reviewer],
  )

  const openFor = useCallback(
    (input: IssueLinkInput) => {
      setRequest(input)
      setIsOpen(true)
      setError(null)
      setLink(null)
      setIsIssuing(true)
      issue(input)
        .then((created) => setLink(created))
        .catch((error) => setError(error instanceof Error ? error.message : "The link couldn't be created. Please try again."))
        .finally(() => setIsIssuing(false))
    },
    [issue],
  )

  /** Open the share sheet for a link the approval transaction already issued. */
  const openExisting = useCallback((input: IssueLinkInput, existingLink: ApplicationLink) => {
    setRequest(input)
    setLink(existingLink)
    setError(null)
    setIsIssuing(false)
    setIsOpen(true)
  }, [])

  /** A fresh token invalidates nothing by itself — revoke first if it matters. */
  const regenerate = useCallback(() => {
    if (!request) return
    setIsIssuing(true)
    setError(null)
    issue(request)
      .then((created) => setLink(created))
      .catch((error) => setError(error instanceof Error ? error.message : "The link couldn't be regenerated. Please try again."))
      .finally(() => setIsIssuing(false))
  }, [issue, request])

  const revoke = useCallback(() => {
    if (!link) return
    if (!live) {
      revokeApplicationLink(link.token)
      setLink({ ...link, revokedAt: new Date().toISOString() })
      return
    }
    if (!reviewer?.uid) {
      setError("Your reviewer session ended. Please sign in again.")
      return
    }
    revokeApplicationLinkDoc(link.token, reviewer)
      .then(() => setLink({ ...link, revokedAt: new Date().toISOString() }))
      .catch((error) => setError(error instanceof Error ? error.message : "The link couldn't be revoked."))
  }, [link, live, reviewer])

  const close = useCallback(() => setIsOpen(false), [])

  return { link, request, isOpen, isIssuing, error, openFor, openExisting, regenerate, revoke, close }
}
