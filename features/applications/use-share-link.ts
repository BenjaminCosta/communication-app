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
  blankApplication,
  createApplicationLink,
  type ApplicationLink,
  type ApplicationSectionId,
  type InviteDetails,
  type LinkPurpose,
} from "@/lib/applications-core"
import { APPLICATIONS_BACKEND_ENABLED } from "@/lib/applications-flags"
import {
  generateLinkToken,
  issueApplicationLink,
  NEW_APPLICATION_MARKER,
  revokeApplicationLink,
  updateMockApplication,
} from "@/features/applications/candidate-links"
import {
  createApplication,
  recordApplicationActivity,
  revokeApplicationLinkDoc,
  saveApplicationLink,
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
      if (!reviewer?.uid) return
      recordApplicationActivity(link.applicationId, "link_generated", message, reviewer).catch(() => {})
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

      // A new invite needs an application to point at first.
      let applicationId = input.applicationId
      // The application record and its first share link must use the same
      // token. Otherwise the link shown later in candidate detail would point
      // at an unresolvable token even though the original share sheet worked.
      let token: string | undefined
      if (applicationId === NEW_APPLICATION_MARKER) {
        token = generateLinkToken()
        const draft = blankApplication(`app-${token}`, token, input.invite)
        await createApplication(draft, reviewer ?? { uid: "", name: "You" })
        applicationId = draft.id
      }

      const created = createApplicationLink({
        applicationId,
        purpose: input.purpose,
        step: input.step ?? null,
        token: token ?? generateLinkToken(),
      })
      await saveApplicationLink(created)
      recordGeneratedLink(created)
      return created
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
        .catch(() => setError("The link couldn't be created. Please try again."))
        .finally(() => setIsIssuing(false))
    },
    [issue],
  )

  /** A fresh token invalidates nothing by itself — revoke first if it matters. */
  const regenerate = useCallback(() => {
    if (!request) return
    setIsIssuing(true)
    setError(null)
    issue(request)
      .then((created) => setLink(created))
      .catch(() => setError("The link couldn't be regenerated. Please try again."))
      .finally(() => setIsIssuing(false))
  }, [issue, request])

  const revoke = useCallback(() => {
    if (!link) return
    const revokedAt = new Date().toISOString()
    setLink({ ...link, revokedAt })
    if (!live) {
      revokeApplicationLink(link.token)
      return
    }
    revokeApplicationLinkDoc(link.token).catch(() => setError("The link couldn't be revoked."))
  }, [link, live])

  const close = useCallback(() => setIsOpen(false), [])

  return { link, request, isOpen, isIssuing, error, openFor, regenerate, revoke, close }
}
