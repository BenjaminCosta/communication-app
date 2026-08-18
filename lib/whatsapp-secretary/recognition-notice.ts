import { firstName } from "@/lib/whatsapp-secretary/onboarding"
import { buildCapabilitySignature } from "@/lib/whatsapp-secretary/onboarding"
import { enabledSecretaryModules } from "@/lib/whatsapp-secretary/tool-registry"
import type { SecretaryModule } from "@/lib/whatsapp-secretary/tool-registry"
import { resolveWhatsAppAccessPolicy } from "@/lib/whatsapp-access-policy"
import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"
import {
  getRecognitionNoticeStatus,
  markRecognitionNoticePending,
  markRecognitionNoticeSent,
} from "@/lib/whatsapp-conversation-memory"

/**
 * The one-time "got you — I recognize you now" confirmation.
 *
 * It exists for a transition the rest of the onboarding machinery could not
 * see. `lib/whatsapp-secretary/onboarding.ts` decides introductions from
 * *conversation history*: a sender with no history is a `first-contact`, one
 * with history is a `refresher`. But someone who talked to the Secretary while
 * unrecognized and was linked to their SVC person afterwards has plenty of
 * history — so the first thing they would have heard after being recognized
 * was "Hi X — Courtney Roberts here. I *still* have you as…", about a person
 * the Secretary had never once acknowledged them as.
 *
 * So this fires exactly on the identity transition, exactly once, and stands
 * in for the ordinary introduction on that turn (see
 * {@link markRecognitionNoticeSent}) rather than being added on top of it.
 *
 * Delivery follows WhatsApp's 24-hour customer-service window: within it this
 * can be an ordinary free-form message, which is the normal case because
 * admins link people right after reading what they wrote. Outside it, nothing
 * is pushed — no template, no workaround — and the confirmation waits for the
 * sender's next message instead.
 */

/** Meta's free-form reply window, measured from the sender's last inbound message. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000

/**
 * Stop pushing a few minutes before the window really closes. The last inbound
 * timestamp available here is the one the Center recorded, not Meta's own, and
 * a send that lands microseconds late fails with an error that looks nothing
 * like "you were too slow".
 */
export const CUSTOMER_SERVICE_WINDOW_MARGIN_MS = 5 * 60 * 1_000

/** Short, human phrases — never internal module keys — for the "you can ask me about…" line. */
const MODULE_PHRASE: Record<SecretaryModule, string> = {
  directory: "people",
  questCoral: "Quest Coral projects",
  applications: "Applications and candidates",
  reports: "Daily Reports",
  outlooks: "3-Week Outlooks",
  clocking: "clock activity",
  messages: "Communications activity",
  knowledge: "how SVC works",
  svc: "any job",
  // Covered by the "personalize what I pull from SVC for you" clause already —
  // naming it again as a capability would say the same thing twice.
  me: "",
}

/**
 * Fixed, not role-tailored. The long introduction reorders capabilities per
 * audience because it has the room to be a real orientation; this message has
 * one clause, and the ordering that reads best there is simply the most
 * universally useful first.
 */
const PHRASE_ORDER: SecretaryModule[] = [
  "directory",
  "questCoral",
  "applications",
  "reports",
  "outlooks",
  "clocking",
  "messages",
  "svc",
  "knowledge",
]

const MAX_PHRASES = 4

/**
 * True for the kind of value people use as a login handle rather than a name —
 * "Jgordon2004", "jsmith", "svc_admin".
 *
 * Real SVC accounts are self-registered, and some carry a username where a
 * name belongs. Greeting Jeremy Gordon as "Hey Jgordon2004" in the one message
 * whose entire point is "I know who you are" would undercut it completely.
 */
export function looksLikeUsername(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return /\d/.test(trimmed) || /[._-]/.test(trimmed)
}

/**
 * Which name to greet with. The SVC account's own name wins by default — it is
 * what this person typed about themselves, and "Benja Costa" beats the
 * Directory's formal "Benjamin Costa Mihanovich" for a hello. The Directory
 * record only takes over when the account name is not usable as a name at all.
 */
export function recognitionGreetingName(input: { accountName?: string | null; directoryName?: string | null }): string {
  const account = input.accountName?.trim() ?? ""
  const directory = input.directoryName?.trim() ?? ""
  if (!account) return directory
  if (directory && looksLikeUsername(account)) return directory
  return account
}

/**
 * The message itself. Every capability named is one the sender's own access
 * policy really granted — the same rule the long introduction follows, for the
 * same reason: this is the first thing the Secretary says after claiming to
 * know who someone is, and it cannot be the place it oversells.
 */
export function buildRecognitionNotice(input: { name: string; modules: SecretaryModule[] }): string {
  const enabled = new Set(input.modules)
  const phrases = PHRASE_ORDER.filter((module) => enabled.has(module))
    .map((module) => MODULE_PHRASE[module])
    .filter(Boolean)

  const listed = phrases.slice(0, MAX_PHRASES)
  const capabilities =
    listed.length === 0
      ? "You can ask me about SVC and I'll look it up."
      : `You can ask me about ${listed.join(", ")}${phrases.length > listed.length ? ", and more" : ""}.`

  return `Hey ${firstName(input.name)} — got you. I recognize you now, so I can personalize what I pull from SVC for you. ${capabilities}`
}

/** Whether a free-form message may still be sent to this sender. */
export function isWithinCustomerServiceWindow(lastInboundAtMs: number | null, nowMs: number): boolean {
  if (!lastInboundAtMs) return false
  return nowMs - lastInboundAtMs < CUSTOMER_SERVICE_WINDOW_MS - CUSTOMER_SERVICE_WINDOW_MARGIN_MS
}

/**
 * The person's Directory name, read only so the greeting never uses a login
 * handle — see {@link recognitionGreetingName}. Best-effort: without it the
 * greeting simply falls back to the SVC account's own name.
 */
async function directoryNameForIdentity(identity: WhatsAppSenderIdentity): Promise<string | null> {
  if (identity.personId.startsWith("user:")) return null
  try {
    const { getFirestore } = await import("firebase-admin/firestore")
    const { getFirebaseAdminApp } = await import("@/lib/ai/server/firebase-admin")
    const contact = (await getFirestore(await getFirebaseAdminApp()).collection("contacts").doc(identity.personId).get()).data()
    const master = contact?.masterData as Record<string, unknown> | undefined
    const name = master?.displayName ?? master?.canonicalName ?? contact?.name
    return typeof name === "string" && name.trim() ? name.trim() : null
  } catch {
    console.warn("Unable to read the Directory name for a WhatsApp recognition confirmation.")
    return null
  }
}

/** The message and the onboarding signature to record with it, for one identity. */
export async function resolveRecognitionNotice(identity: WhatsAppSenderIdentity): Promise<{
  text: string
  capabilitySignature: string
}> {
  return recognitionNoticeContext(identity, await directoryNameForIdentity(identity))
}

/** What the notice's copy needs, resolved from an identity. */
export function recognitionNoticeContext(identity: WhatsAppSenderIdentity, directoryName?: string | null): {
  text: string
  capabilitySignature: string
} {
  const accessPolicy = resolveWhatsAppAccessPolicy(identity)
  const modules = enabledSecretaryModules(accessPolicy)
  return {
    text: buildRecognitionNotice({
      name: recognitionGreetingName({ accountName: identity.name, directoryName }),
      modules,
    }),
    capabilitySignature: buildCapabilitySignature({
      level: accessPolicy.level,
      modules,
      role: identity.role ?? null,
      hasLinkedAccount: Boolean(identity.userId),
    }),
  }
}

export type RecognitionNoticeDelivery =
  /** Pushed as a normal WhatsApp message, inside the 24-hour window. */
  | { status: "sent"; text: string }
  /** Window closed or the push failed; it will ride on the sender's next reply. */
  | { status: "deferred"; reason: "window-closed" | "send-failed" }
  /** This person has already been told, once, and that is the whole contract. */
  | { status: "skipped"; reason: "already-notified" }

/**
 * Sends the confirmation to someone an admin just linked, or defers it.
 *
 * Deliberately fail-soft in both directions: a send failure never surfaces as
 * a failed link (the link itself succeeded and is what matters), and a
 * deferred notice is never silently dropped.
 */
export async function deliverRecognitionNotice(input: {
  senderPhoneNumber: string
  identity: WhatsAppSenderIdentity
  /** When this sender last wrote in, which is what opens Meta's window. */
  lastInboundAtMs: number | null
  nowMs?: number
  /** Injectable so the delivery rules can be tested without the Cloud API. */
  send?: (to: string, body: string) => Promise<unknown>
}): Promise<RecognitionNoticeDelivery> {
  const nowMs = input.nowMs ?? Date.now()
  const status = await getRecognitionNoticeStatus(input.senderPhoneNumber)
  if (status.noticedAtMs) return { status: "skipped", reason: "already-notified" }

  const { text, capabilitySignature } = await resolveRecognitionNotice(input.identity)

  if (!isWithinCustomerServiceWindow(input.lastInboundAtMs, nowMs)) {
    await markRecognitionNoticePending({ senderPhoneNumber: input.senderPhoneNumber, nowMs })
    return { status: "deferred", reason: "window-closed" }
  }

  try {
    const send = input.send ?? (await import("@/lib/whatsapp-cloud-api")).sendWhatsAppText
    await send(input.senderPhoneNumber, text)
  } catch {
    console.error("Unable to push the WhatsApp recognition confirmation; deferring it to the sender's next message.")
    await markRecognitionNoticePending({ senderPhoneNumber: input.senderPhoneNumber, nowMs })
    return { status: "deferred", reason: "send-failed" }
  }

  await markRecognitionNoticeSent({ senderPhoneNumber: input.senderPhoneNumber, capabilitySignature, nowMs })
  console.info("Sent a one-time WhatsApp recognition confirmation", { hasLinkedAccount: Boolean(input.identity.userId) })
  return { status: "sent", text }
}
