import assert from "node:assert/strict"
import test from "node:test"
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  RECOGNITION_NOTICE_MESSAGE_ID,
  buildRecognitionNotice,
  isWithinCustomerServiceWindow,
  looksLikeUsername,
  recognitionGreetingName,
  recognitionNoticeContext,
} from "../lib/whatsapp-secretary/recognition-notice"
import type { WhatsAppSenderIdentity } from "../lib/whatsapp-svc-identity"

test("the notice greets by first name and names capabilities, capped", () => {
  const text = buildRecognitionNotice({
    name: "Jeremy Gordon",
    modules: ["directory", "questCoral", "applications", "reports", "outlooks", "clocking", "me"],
  })

  assert.match(text, /^Hey Jeremy — got you\. I recognize you now/)
  assert.match(text, /You can ask me about people, Quest Coral projects, Applications and candidates, Daily Reports, and more\.$/)
  // `me` is covered by the "personalize what I pull from SVC" clause already.
  assert.ok(!text.includes("your own SVC context"))
})

test("the notice never names a capability the sender cannot reach", () => {
  const text = buildRecognitionNotice({ name: "Jeremy Gordon", modules: ["directory", "reports"] })

  assert.equal(text.includes("Applications"), false)
  assert.equal(text.includes("3-Week Outlooks"), false)
  assert.match(text, /You can ask me about people, Daily Reports\.$/)
  assert.equal(text.includes("and more"), false)
})

test("the notice degrades to a true, generic line when no module is enabled", () => {
  const text = buildRecognitionNotice({ name: "Jeremy", modules: [] })
  assert.match(text, /You can ask me about SVC and I'll look it up\.$/)
})

test("a login handle never becomes the greeting when a Directory name exists", () => {
  assert.equal(looksLikeUsername("Jgordon2004"), true)
  assert.equal(looksLikeUsername("j.smith"), true)
  assert.equal(looksLikeUsername("Benja Costa"), false)
  assert.equal(looksLikeUsername("Courtney"), false)

  assert.equal(recognitionGreetingName({ accountName: "Jgordon2004", directoryName: "Jeremy Gordon" }), "Jeremy Gordon")
  // The account's own name is what the person calls themselves; a fuller
  // Directory name does not override it.
  assert.equal(
    recognitionGreetingName({ accountName: "Benja Costa", directoryName: "Benjamin Costa Mihanovich" }),
    "Benja Costa",
  )
  assert.equal(recognitionGreetingName({ accountName: "Jgordon2004", directoryName: null }), "Jgordon2004")
  assert.equal(recognitionGreetingName({ accountName: "", directoryName: "Jeremy Gordon" }), "Jeremy Gordon")
})

test("the 24-hour customer-service window closes early, and a sender who never wrote is never pushed to", () => {
  const now = 1_800_000_000_000
  assert.equal(isWithinCustomerServiceWindow(now - 60_000, now), true)
  assert.equal(isWithinCustomerServiceWindow(now - CUSTOMER_SERVICE_WINDOW_MS - 1, now), false)
  // Inside 24h, but too close to the edge to trust a timestamp we recorded ourselves.
  assert.equal(isWithinCustomerServiceWindow(now - (CUSTOMER_SERVICE_WINDOW_MS - 60_000), now), false)
  assert.equal(isWithinCustomerServiceWindow(null, now), false)
})

test("the notice and the onboarding signature are built from the identity's real access", () => {
  const identity: WhatsAppSenderIdentity = {
    personId: "contact_1",
    userId: "user_1",
    name: "Jgordon2004",
    role: "Super",
  }

  const { text, capabilitySignature } = recognitionNoticeContext(identity, "Jeremy Gordon")
  assert.match(text, /^Hey Jeremy — got you\./)
  // Recording it as an introduction is what keeps the ordinary intro quiet
  // afterwards, so the signature has to be the real one.
  assert.match(capabilitySignature, /\|internal\|/)
  assert.match(capabilitySignature, /role=super/)
  assert.match(capabilitySignature, /account=linked/)
})

test("a Directory-only person with no SVC account is still recognized and greeted", () => {
  const identity: WhatsAppSenderIdentity = { personId: "contact_2", name: "Flavia Rotta" }
  const { text, capabilitySignature } = recognitionNoticeContext(identity, "Flavia Rotta")

  assert.match(text, /^Hey Flavia — got you\./)
  assert.match(capabilitySignature, /account=unlinked/)
})

test("the pushed confirmation has a fixed transcript id, so a retry cannot duplicate it", () => {
  // The Center stores assistant messages as `assistant:{replyToMessageId}`.
  // A timestamp or random id here would let one retried push become two
  // messages in the transcript and two in `messageCount`.
  assert.equal(RECOGNITION_NOTICE_MESSAGE_ID, "recognition-notice")
})
