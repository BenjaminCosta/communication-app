import assert from "node:assert/strict"
import test from "node:test"
import { findRelevantCompanyKnowledge } from "../lib/company-knowledge"
import type { WhatsAppSecretaryConversationMessage } from "../lib/whatsapp-secretary/types"

function userMessage(content: string): WhatsAppSecretaryConversationMessage {
  return { role: "user", content }
}
function assistantMessage(content: string): WhatsAppSecretaryConversationMessage {
  return { role: "assistant", content }
}

test("public scope always returns exactly the one safe overview entry, regardless of the question", async () => {
  const forQuestCoral = await findRelevantCompanyKnowledge([userMessage("what is quest coral")], "public")
  const forGibberish = await findRelevantCompanyKnowledge([userMessage("zzz totally unrelated")], "public")

  assert.equal(forQuestCoral.length, 1)
  assert.equal(forQuestCoral[0]!.id, "svc-overview")
  assert.deepEqual(forQuestCoral, forGibberish)
  // Safe means no live-data specifics (a name, a phone number, a job), not
  // the absence of the word "people" — the entry legitimately says it does
  // NOT expose live people/messages/jobs.
  assert.doesNotMatch(forQuestCoral[0]!.content, /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/)
})

test("internal scope: a relevant question returns knowledge-pack sections about that topic", async () => {
  const results = await findRelevantCompanyKnowledge([userMessage("how does clocking in and out work")], "internal")
  assert.ok(results.length > 0)
  assert.ok(results.some((entry) => /clock/i.test(entry.title) || /clock/i.test(entry.content)))
  assert.ok(results.every((entry) => entry.source.startsWith("SVC_AI_Secretary_Canonical_Knowledge_Pack.md")))
})

test("internal scope: falls back to the wider conversation when the latest message alone doesn't match anything", async () => {
  const conversation: WhatsAppSecretaryConversationMessage[] = [
    userMessage("tell me about quest coral's mission fit field"),
    assistantMessage("Mission fit is a 1-5 score."),
    userMessage("yes"),
  ]
  const results = await findRelevantCompanyKnowledge(conversation, "internal")
  assert.ok(results.length > 0)
  assert.ok(results.some((entry) => entry.id === "sec-7"))
})

test("internal scope: an irrelevant conversation returns no knowledge rather than a weak guess", async () => {
  const results = await findRelevantCompanyKnowledge([userMessage("zzyxx nonexistent gibberish term")], "internal")
  assert.equal(results.length, 0)
})

test("internal scope: entries never exceed the per-entry character cap", async () => {
  const results = await findRelevantCompanyKnowledge([userMessage("explain the whole applications candidate lifecycle")], "internal")
  assert.ok(results.length > 0)
  assert.ok(results.every((entry) => entry.content.length <= 1_800))
})
