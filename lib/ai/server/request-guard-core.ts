import { randomUUID } from "node:crypto"
import { OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { AiError } from "@/lib/ai/errors"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

const ACTIVE_LEASE_MS = 2 * 60 * 1000
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000
const MAX_RECENT_REQUESTS = 32

interface ActiveRequest {
  leaseId: string
  operation: OutlookAiOperation
  requestHash: string
  keyHash: string
  expiresAtMs: number
}

interface RecentRequest extends ActiveRequest {
  status: "active" | "completed"
}

export interface OutlookAiGuardState {
  generationTimestamps: number[]
  transcriptionTimestamps: number[]
  active: ActiveRequest | null
  recentRequests: RecentRequest[]
}

export interface OutlookAiGuardLease extends ActiveRequest {
  remaining: number
}

export function emptyOutlookAiGuardState(): OutlookAiGuardState {
  return {
    generationTimestamps: [],
    transcriptionTimestamps: [],
    active: null,
    recentRequests: [],
  }
}

/** Treat Firestore data as untrusted and retain only the fields the guard owns. */
export function normalizeOutlookAiGuardState(value: unknown): OutlookAiGuardState {
  if (!value || typeof value !== "object") return emptyOutlookAiGuardState()
  const raw = value as Record<string, unknown>
  return {
    generationTimestamps: numberArray(raw.generationTimestamps),
    transcriptionTimestamps: numberArray(raw.transcriptionTimestamps),
    active: normalizeActive(raw.active),
    recentRequests: Array.isArray(raw.recentRequests)
      ? raw.recentRequests.map(normalizeRecent).filter((entry): entry is RecentRequest => entry !== null)
      : [],
  }
}

export function acquireOutlookAiGuardState(
  current: OutlookAiGuardState,
  input: {
    operation: OutlookAiOperation
    requestHash: string
    keyHash: string
    nowMs: number
    leaseId?: string
  },
): { state: OutlookAiGuardState; lease: OutlookAiGuardLease } {
  const { operation, requestHash, keyHash, nowMs } = input
  const leaseId = input.leaseId ?? randomUUID()
  const windowStart = nowMs - OUTLOOK_AI_LIMITS.requestWindowMs
  const generationTimestamps = current.generationTimestamps.filter((at) => at > windowStart)
  const transcriptionTimestamps = current.transcriptionTimestamps.filter((at) => at > windowStart)
  const recentRequests = current.recentRequests
    .filter((entry) => entry.expiresAtMs > nowMs)
    .slice(-MAX_RECENT_REQUESTS)
  const active = current.active && current.active.expiresAtMs > nowMs ? current.active : null

  const reusedKey = recentRequests.find((entry) => entry.keyHash === keyHash)
  if (reusedKey && reusedKey.requestHash !== requestHash) {
    throw new AiError("invalid-request", "This retry key was already used for a different request.")
  }

  const duplicate = recentRequests.find(
    (entry) => entry.operation === operation && entry.requestHash === requestHash,
  )
  if (duplicate?.status === "completed") {
    throw new AiError(
      "duplicate-request",
      "That exact request was just completed. Use the existing result or try again shortly.",
      { retryAfterSeconds: secondsUntil(duplicate.expiresAtMs, nowMs) },
    )
  }
  if (duplicate?.status === "active") {
    throw new AiError("request-in-progress", "That AI request is already processing.", {
      retryAfterSeconds: secondsUntil(duplicate.expiresAtMs, nowMs),
    })
  }
  if (active) {
    throw new AiError("request-in-progress", "Another AI request is already processing for your account.", {
      retryAfterSeconds: secondsUntil(active.expiresAtMs, nowMs),
    })
  }

  const timestamps = operation === "generation" ? generationTimestamps : transcriptionTimestamps
  const limit =
    operation === "generation"
      ? OUTLOOK_AI_LIMITS.generationRequestsPerWindow
      : OUTLOOK_AI_LIMITS.transcriptionRequestsPerWindow
  if (timestamps.length >= limit) {
    const retryAtMs = Math.min(...timestamps) + OUTLOOK_AI_LIMITS.requestWindowMs
    throw new AiError(
      "rate-limited",
      operation === "generation"
        ? "You reached the task-generation limit. Try again when the countdown ends."
        : "You reached the voice-transcription limit. Try again when the countdown ends.",
      { retryAfterSeconds: secondsUntil(retryAtMs, nowMs) },
    )
  }

  const lease: OutlookAiGuardLease = {
    leaseId,
    operation,
    requestHash,
    keyHash,
    expiresAtMs: nowMs + ACTIVE_LEASE_MS,
    remaining: limit - timestamps.length - 1,
  }
  const { remaining: _remaining, ...activeRequest } = lease
  const recent: RecentRequest = { ...activeRequest, status: "active" }

  return {
    state: {
      generationTimestamps:
        operation === "generation" ? [...generationTimestamps, nowMs] : generationTimestamps,
      transcriptionTimestamps:
        operation === "transcription" ? [...transcriptionTimestamps, nowMs] : transcriptionTimestamps,
      active: activeRequest,
      recentRequests: [...recentRequests, recent].slice(-MAX_RECENT_REQUESTS),
    },
    lease,
  }
}

export function completeOutlookAiGuardState(
  current: OutlookAiGuardState,
  lease: OutlookAiGuardLease,
  nowMs: number,
): OutlookAiGuardState {
  return {
    ...current,
    active: current.active?.leaseId === lease.leaseId ? null : current.active,
    recentRequests: current.recentRequests.map((entry) =>
      entry.leaseId === lease.leaseId
        ? { ...entry, status: "completed", expiresAtMs: nowMs + DUPLICATE_WINDOW_MS }
        : entry,
    ),
  }
}

export function failOutlookAiGuardState(
  current: OutlookAiGuardState,
  lease: OutlookAiGuardLease,
): OutlookAiGuardState {
  return {
    ...current,
    active: current.active?.leaseId === lease.leaseId ? null : current.active,
    // Provider/processing failures may be retried intentionally. The rolling
    // rate timestamp remains, but the idempotency fingerprint is released.
    recentRequests: current.recentRequests.filter((entry) => entry.leaseId !== lease.leaseId),
  }
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    : []
}

function normalizeActive(value: unknown): ActiveRequest | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.leaseId !== "string" ||
    (raw.operation !== "generation" && raw.operation !== "transcription") ||
    typeof raw.requestHash !== "string" ||
    typeof raw.keyHash !== "string" ||
    typeof raw.expiresAtMs !== "number"
  ) return null
  return {
    leaseId: raw.leaseId,
    operation: raw.operation,
    requestHash: raw.requestHash,
    keyHash: raw.keyHash,
    expiresAtMs: raw.expiresAtMs,
  }
}

function normalizeRecent(value: unknown): RecentRequest | null {
  const active = normalizeActive(value)
  if (!active || !value || typeof value !== "object") return null
  const status = (value as Record<string, unknown>).status
  if (status !== "active" && status !== "completed") return null
  return { ...active, status }
}

function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 1000))
}
