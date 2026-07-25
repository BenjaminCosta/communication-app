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
import { generateLinkToken, issueApplicationLink, revokeApplicationLink } from "@/features/applications/mock-applications"
import {
  createApplication,
  revokeApplicationLinkDoc,
  saveApplicationLink,
  type ReviewerIdentity,
} from "@/lib/applications-writes"

/** Passed as `applicationId` to invite a brand-new candidate. */
export const NEW_APPLICATION_MARKER = "new-application"

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

  const issue = useCallback(
    async (input: IssueLinkInput): Promise<ApplicationLink> => {
      if (!live) return issueApplicationLink(input)

      // A new invite needs an application to point at first.
      let applicationId = input.applicationId
      if (applicationId === NEW_APPLICATION_MARKER) {
        const token = generateLinkToken()
        const draft = blankApplication(`app-${token}`, token, input.invite)
        await createApplication(draft, reviewer ?? { uid: "", name: "You" })
        applicationId = draft.id
      }

      const created = createApplicationLink({
        applicationId,
        purpose: input.purpose,
        step: input.step ?? null,
        token: generateLinkToken(),
      })
      await saveApplicationLink(created)
      return created
    },
    [live, reviewer],
  )

  const openFor = useCallback(
    (input: IssueLinkInput) => {
      setRequest(input)
      setIsOpen(true)
      setError(null)
      if (!live) {
        setLink(issueApplicationLink(input))
        return
      }
      setLink(null)
      setIsIssuing(true)
      issue(input)
        .then((created) => setLink(created))
        .catch(() => setError("The link couldn't be created. Please try again."))
        .finally(() => setIsIssuing(false))
    },
    [issue, live],
  )

  /** A fresh token invalidates nothing by itself — revoke first if it matters. */
  const regenerate = useCallback(() => {
    if (!request) return
    if (!live) {
      setLink(issueApplicationLink(request))
      return
    }
    setIsIssuing(true)
    setError(null)
    issue(request)
      .then((created) => setLink(created))
      .catch(() => setError("The link couldn't be regenerated. Please try again."))
      .finally(() => setIsIssuing(false))
  }, [issue, live, request])

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

  return { link, isOpen, isIssuing, error, openFor, regenerate, revoke, close }
}
