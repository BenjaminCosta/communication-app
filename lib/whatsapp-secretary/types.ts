/**
 * Shared conversation message shape for the WhatsApp Secretary. Kept in its
 * own file (rather than inside the orchestrator or the old single-shot
 * `lib/ai/whatsapp-secretary.ts`, which this replaces) so every module that
 * needs the type — conversation memory, company knowledge, the Daily Report
 * draft flow, and the orchestrator itself — can import it without pulling in
 * OpenAI client code.
 */
export type WhatsAppSecretaryConversationMessage = {
  role: "user" | "assistant"
  content: string
}
