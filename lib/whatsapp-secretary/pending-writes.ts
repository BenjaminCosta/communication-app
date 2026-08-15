import type { SecretaryTool, WriteCommitContext, WriteCommitResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * The generic preview → confirm → commit envelope for every WhatsApp write.
 *
 * The Daily Report draft flow proved this shape works and must not be
 * weakened: an explicit preview, a confirmation phrase that a bare "yes" does
 * not satisfy, and a transactional, idempotent write that a repeat
 * confirmation cannot duplicate. What it did *not* do was generalize — the
 * trigger was a regex on the raw inbound message ahead of the orchestrator, so
 * every future write would have meant another branch in the webhook, another
 * command string, another bespoke state document, and the model could never
 * compose a write with a read.
 *
 * This module owns only the envelope and the confirmation contract. The actual
 * write stays inside each write tool's own `commit()`, which is where a
 * module's real Firestore transaction and idempotency key belong — so
 * generalizing the trigger changed nothing about how a record is written.
 */

/** Persisted alongside the conversation transcript; one pending write per sender. */
export interface PendingWriteEnvelope {
  toolName: string
  /** Already Zod-validated by the tool that produced the preview. */
  args: unknown
  /** The preview text the sender was shown, kept so a re-confirmation can restate it. */
  summary: string
  /** Exact phrase required to commit. A bare "yes" must never satisfy it. */
  confirmPhrase: string
  cancelPhrase: string
  /** Seeds deterministic record ids in `commit`, so a retry cannot create a second record. */
  requestMessageId: string
  createdAtMs: number
}

/**
 * How long a preview stays confirmable. A stale envelope is a real hazard:
 * confirming a draft written days ago, against a job whose situation has since
 * moved on, is worse than being asked to restate it.
 */
export const PENDING_WRITE_TTL_MS = 24 * 60 * 60 * 1_000

export function isPendingWriteExpired(envelope: PendingWriteEnvelope, nowMs: number): boolean {
  return nowMs - envelope.createdAtMs >= PENDING_WRITE_TTL_MS
}

function normalize(value: string): string {
  return value.trim().toLocaleUpperCase().replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Deliberately an exact-phrase match, not intent detection. The whole safety
 * property of this flow is that the sender typed something unambiguous — a
 * model deciding "they probably meant yes" is exactly what must not happen
 * here, which is why this function never sees the model at all.
 */
export function matchesConfirmPhrase(text: string, envelope: PendingWriteEnvelope): boolean {
  return normalize(text) === normalize(envelope.confirmPhrase)
}

export function matchesCancelPhrase(text: string, envelope: PendingWriteEnvelope): boolean {
  return normalize(text) === normalize(envelope.cancelPhrase)
}

export type PendingWriteOutcome =
  | { kind: "none" }
  | { kind: "committed"; result: WriteCommitResult }
  | { kind: "cancelled"; reply: string }
  | { kind: "expired"; reply: string }
  | { kind: "unavailable"; reply: string }

/**
 * Resolves an inbound message against a stored pending write.
 *
 * Returns `{kind: "none"}` for anything that is not an exact confirmation or
 * cancellation, so the normal Secretary flow is completely unaffected — a
 * sender who ignores a preview and asks something else simply gets an answer,
 * and the preview stays pending until it expires.
 */
export async function resolvePendingWrite(input: {
  text: string
  envelope: PendingWriteEnvelope | null
  tools: Map<string, SecretaryTool>
  context: WriteCommitContext
  nowMs?: number
}): Promise<PendingWriteOutcome> {
  const { envelope } = input
  if (!envelope) return { kind: "none" }

  const isConfirm = matchesConfirmPhrase(input.text, envelope)
  const isCancel = matchesCancelPhrase(input.text, envelope)
  if (!isConfirm && !isCancel) return { kind: "none" }

  if (isCancel) {
    return { kind: "cancelled", reply: "Cancelled — nothing was created." }
  }

  if (isPendingWriteExpired(envelope, input.nowMs ?? Date.now())) {
    return {
      kind: "expired",
      reply: "That preview has expired, so nothing was created. Send the details again and I'll prepare a fresh one.",
    }
  }

  const tool = input.tools.get(envelope.toolName)
  if (!tool || typeof tool.commit !== "function") {
    // Can happen if a write tool is removed, renamed, or the sender's access
    // changed between preview and confirmation. Failing closed is correct.
    return {
      kind: "unavailable",
      reply: "That action isn't available anymore, so nothing was created. Send the details again if you still need it.",
    }
  }

  const result = await tool.commit(envelope.args as never, { ...input.context, requestMessageId: envelope.requestMessageId })
  return { kind: "committed", result }
}

/**
 * Builds the sender-facing preview reply.
 *
 * The confirmation contract is appended only when the tool's own preview text
 * doesn't already state it — the Daily Report preview, for one, has always
 * ended with its own "Reply exactly CONFIRM DRAFT…" line, and printing that
 * twice reads like a system stutter on a phone screen. Every write still ends
 * up stating the contract exactly once, whichever half supplies it.
 */
export function formatPendingWriteReply(envelope: PendingWriteEnvelope): string {
  const alreadyStated = envelope.summary.toLocaleUpperCase().includes(envelope.confirmPhrase.toLocaleUpperCase())
  return alreadyStated
    ? envelope.summary
    : `${envelope.summary}\n\nReply ${envelope.confirmPhrase} to create it, or ${envelope.cancelPhrase} to discard.`
}
