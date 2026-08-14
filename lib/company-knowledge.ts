import type { CompanyKnowledgeAccessScope } from "@/lib/whatsapp-access-policy"
import type { WhatsAppSecretaryConversationMessage } from "@/lib/whatsapp-secretary/types"
import { KNOWLEDGE_PACK_SOURCE, searchKnowledgeChunks } from "@/lib/knowledge-pack"

/**
 * Baseline "Company Knowledge" grounding for the WhatsApp Secretary.
 *
 * This used to read a small, hand-curated set of entries from a Firestore
 * `companyKnowledge` collection (seeded by the now-retired
 * `scripts/seed-company-knowledge.ts`). It now reads from the same single
 * source of truth as the deeper `knowledge_search`/`knowledge_getSection`
 * tools (`lib/whatsapp-secretary/tools/knowledge.ts`) —
 * `SVC_AI_Secretary_Canonical_Knowledge_Pack.md`, parsed and scored by
 * `lib/knowledge-pack.ts` — so there is one coherent knowledge system instead
 * of two. This function still only returns a small, pre-scored slice (never
 * the whole document): it's the guaranteed baseline folded directly into the
 * system prompt before the tool loop even starts, matching Directory's own
 * "deterministic prefetch, then tool-calling for more" pattern. An internal
 * sender's model can always call `knowledge_search` for a different or
 * deeper section afterward; this function is not the only way in.
 */

const MAX_RETRIEVED_ENTRIES = 3
const MAX_QUERY_MESSAGES = 3
/** Matches `MAX_KNOWLEDGE_CHARACTERS_PER_ENTRY` in `whatsapp-secretary/prompt.ts`, which re-applies the same cap when folding this into the system prompt. */
const MAX_ENTRY_CHARACTERS = 1_800

export type CompanyKnowledgeContext = {
  id: string
  title: string
  content: string
  source: string
}

/**
 * The only knowledge a public/unrecognized WhatsApp sender ever receives —
 * always included regardless of what they ask, since it's the entirety of
 * what they're allowed to see. Deliberately safe: no live people, messages,
 * projects, candidates, jobs, or operational data.
 */
const PUBLIC_KNOWLEDGE_ENTRY: CompanyKnowledgeContext = {
  id: "svc-overview",
  title: "SVC overview and modules",
  content:
    "SVC is an internal, mobile-first web/PWA workspace connecting five modules: Communications (also called Stream), Directory, Applications, Quest Coral, and ByeByeDPR (field clocking and Daily Reports). This is product orientation only: it does not expose live people, messages, projects, candidates, jobs, or operational records.",
  source: `${KNOWLEDGE_PACK_SOURCE} § SVC company overview`,
}

function userMessagesFromConversation(recentMessages: WhatsAppSecretaryConversationMessage[]): string[] {
  return recentMessages
    .filter((message) => message.role === "user")
    .slice(-MAX_QUERY_MESSAGES)
    .map((message) => message.content)
}

/**
 * Retrieves a small, scored subset of curated SVC product knowledge. It
 * deliberately does not query Directory, contacts, messages, or other live
 * operational collections — see `lib/knowledge-pack.ts` for the corpus and
 * scoring, and the module doc above for how this fits with the deeper
 * on-demand knowledge tools.
 */
export async function findRelevantCompanyKnowledge(
  recentMessages: WhatsAppSecretaryConversationMessage[],
  accessScope: CompanyKnowledgeAccessScope = "internal",
): Promise<CompanyKnowledgeContext[]> {
  if (accessScope === "public") return [PUBLIC_KNOWLEDGE_ENTRY]

  const userMessages = userMessagesFromConversation(recentMessages)
  const currentQuery = userMessages.at(-1) ?? ""
  const conversationQuery = userMessages.join("\n")

  const currentResults = searchKnowledgeChunks(currentQuery, MAX_RETRIEVED_ENTRIES)
  const results = currentResults.length > 0 ? currentResults : searchKnowledgeChunks(conversationQuery, MAX_RETRIEVED_ENTRIES)

  return results.map(({ chunk }) => ({
    id: chunk.id,
    title: chunk.title,
    content: chunk.content.slice(0, MAX_ENTRY_CHARACTERS),
    source: `${KNOWLEDGE_PACK_SOURCE} § ${chunk.breadcrumb}`,
  }))
}
