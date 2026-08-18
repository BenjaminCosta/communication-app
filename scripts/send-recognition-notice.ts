#!/usr/bin/env tsx
/**
 * Sends the one-time "got you — I recognize you now" confirmation to people
 * who were already linked to their SVC person before that confirmation
 * existed.
 *
 * DRY RUN BY DEFAULT: prints exactly who would be messaged and the exact text,
 * and writes nothing. Delivery needs both `--send` and
 * `CONFIRM_RECOGNITION_SEND=true`, because this is the one script in this
 * repository that puts a message in a real person's WhatsApp.
 *
 * Who qualifies, deliberately narrowly:
 *   1. the conversation resolves to an SVC identity today, and
 *   2. that person has never been told anything by the Secretary AS a
 *      recognized person — no onboarding state at all.
 *
 * Rule 2 is what keeps this from spamming. Someone who already received the
 * full personalized introduction knows perfectly well they are recognized;
 * telling them again would be noise. It leaves exactly the people the
 * introduction machinery could never reach: those recognized by an admin link
 * after the fact.
 *
 * Delivery itself goes through the same `deliverRecognitionNotice` production
 * uses, so the 24-hour window rule and the once-only marker are identical.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json pnpm tsx scripts/send-recognition-notice.ts
 *   ... --send                       (plus CONFIRM_RECOGNITION_SEND=true, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)
 *   ... --only <conversationId|phone digits>
 */
import { getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { CRC_CONVERSATIONS_COLLECTION } from "@/lib/courtney-roberts-center/history-store"
import { resolveWhatsAppSenderIdentityDetailed } from "@/lib/whatsapp-svc-identity"
import { getRecognitionNoticeStatus } from "@/lib/whatsapp-conversation-memory"
import {
  deliverRecognitionNotice,
  isWithinCustomerServiceWindow,
  resolveRecognitionNotice,
} from "@/lib/whatsapp-secretary/recognition-notice"

function mask(phone: string): string {
  return phone.length >= 5 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : "***"
}

function hoursSince(atMs: number | null, nowMs: number): string {
  return atMs ? `${((nowMs - atMs) / 3_600_000).toFixed(1)}h ago` : "never"
}

async function main(): Promise<void> {
  const shouldSend = process.argv.includes("--send")
  const only = process.argv[process.argv.indexOf("--only") + 1]
  const filter = process.argv.includes("--only") && only && !only.startsWith("--") ? only : null
  if (shouldSend && process.env.CONFIRM_RECOGNITION_SEND !== "true") {
    throw new Error("Refusing to message real people without CONFIRM_RECOGNITION_SEND=true.")
  }

  const nowMs = Date.now()
  const db = getFirestore(await getFirebaseAdminApp())
  const conversations = await db.collection(CRC_CONVERSATIONS_COLLECTION).get()
  console.info(`${shouldSend ? "SENDING" : "DRY RUN"} — ${conversations.size} conversation(s) on record\n`)

  for (const document of conversations.docs) {
    const data = document.data() as Record<string, unknown>
    const phoneNumber = typeof data.phoneNumber === "string" ? data.phoneNumber : ""
    if (!phoneNumber) continue
    if (filter && !document.id.startsWith(filter) && !phoneNumber.includes(filter)) continue

    const label = `${String(data.displayName ?? "?")} (${mask(phoneNumber)})`
    const resolution = await resolveWhatsAppSenderIdentityDetailed(phoneNumber)
    if (resolution.status !== "resolved") {
      console.info(`skip  ${label}: not recognized today (${resolution.status})`)
      continue
    }

    // The Secretary's own memory doc is the source of truth for what this
    // person has already been told — the Center's conversation doc knows the
    // transcript, not the onboarding history.
    const memory = await db.collection("whatsappConversations").doc(document.id).get()
    if (memory.data()?.onboarding) {
      console.info(`skip  ${label}: already introduced as a recognized person`)
      continue
    }
    const status = await getRecognitionNoticeStatus(phoneNumber)
    if (status.noticedAtMs) {
      console.info(`skip  ${label}: already confirmed ${hoursSince(status.noticedAtMs, nowMs)}`)
      continue
    }

    const lastInboundAtMs =
      typeof data.lastInboundAtMs === "number"
        ? data.lastInboundAtMs
        : typeof data.lastMessageAtMs === "number"
          ? data.lastMessageAtMs
          : null
    const withinWindow = isWithinCustomerServiceWindow(lastInboundAtMs, nowMs)
    const { text } = await resolveRecognitionNotice(resolution.identity)
    console.info(`${withinWindow ? "SEND " : "defer"} ${label}: last inbound ${hoursSince(lastInboundAtMs, nowMs)}`)
    console.info(`      "${text}"`)

    if (!shouldSend) continue
    const delivery = await deliverRecognitionNotice({
      senderPhoneNumber: phoneNumber,
      identity: resolution.identity,
      lastInboundAtMs,
      nowMs,
    })
    console.info(`      -> ${delivery.status}${"reason" in delivery ? ` (${delivery.reason})` : ""}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
