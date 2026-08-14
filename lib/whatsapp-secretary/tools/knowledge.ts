import { z } from "zod"
import { getKnowledgeChunkById, KNOWLEDGE_PACK_SOURCE, searchKnowledgeChunks } from "@/lib/knowledge-pack"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * Company Knowledge tools for the WhatsApp Secretary orchestrator — the
 * "how SVC works" counterpart to the live-data tools in every other file
 * under `tools/`. Backed by the same parsed, scored corpus
 * (`lib/knowledge-pack.ts`) as `lib/company-knowledge.ts`'s always-injected
 * baseline grounding, so there is exactly one knowledge system, just two ways
 * to reach it: a small guaranteed prefetch before the tool loop starts, and
 * these two tools for when the model needs a different section than the
 * prefetch guessed, or the full text of one it only saw an excerpt of.
 *
 * Deliberately two tools, not one, mirroring Directory's own search-then-
 * getEntityDetails shape: `knowledge_search` returns several short excerpts
 * cheaply so the model can judge relevance before spending budget on the
 * full text; `knowledge_getSection` returns one section's complete content
 * (including any CONFIRMED / PRODUCT DIRECTION / NEEDS VERIFICATION or
 * in-progress/WIP wording it carries) so the model can answer a detailed
 * "how do I..." tutorial question precisely instead of from a truncated
 * preview.
 */

const MAX_SEARCH_RESULTS = 5
const MAX_SECTION_CHARACTERS = 3_000

export interface KnowledgeSearchResult {
  id: string
  title: string
  breadcrumb: string
  excerpt: string
}

export interface KnowledgeSection {
  id: string
  title: string
  breadcrumb: string
  content: string
}

export interface KnowledgeToolsProvider {
  search(query: string, limit: number): KnowledgeSearchResult[]
  getSection(id: string): KnowledgeSection | null
}

function createServerKnowledgeToolsProvider(): KnowledgeToolsProvider {
  return {
    search(query, limit) {
      return searchKnowledgeChunks(query, limit).map(({ chunk }) => ({
        id: chunk.id,
        title: chunk.title,
        breadcrumb: chunk.breadcrumb,
        excerpt: chunk.excerpt,
      }))
    },
    getSection(id) {
      const chunk = getKnowledgeChunkById(id)
      if (!chunk) return null
      return {
        id: chunk.id,
        title: chunk.title,
        breadcrumb: chunk.breadcrumb,
        content: chunk.content.slice(0, MAX_SECTION_CHARACTERS),
      }
    },
  }
}

export function createKnowledgeTools(deps: { provider?: KnowledgeToolsProvider } = {}): SecretaryTool[] {
  const provider = deps.provider ?? createServerKnowledgeToolsProvider()

  const search: SecretaryTool<{ query: string }> = {
    name: "knowledge_search",
    module: "knowledge",
    description:
      "Search SVC's stable company/product knowledge (what SVC and each app/module is for, tutorials, terminology, how modules relate) — NOT live operational data like a specific person, job, or report. Use this for 'how do I...', 'what is...', 'difference between X and Y' questions, and combine it with live-data tools when a question needs both. Returns short excerpts with section ids; call knowledge_getSection on a promising id for the full text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "What you want to know, e.g. 'how does clocking work' or 'difference between Quest Coral and a 3-Week Outlook'.",
        },
      },
    },
    schema: z.object({ query: z.string().min(1).max(300) }),
    async run(args, budget): Promise<SecretaryToolResult> {
      const limit = Math.max(0, Math.min(MAX_SEARCH_RESULTS, budget.maxRecordsPerTool, budget.remainingRecords))
      if (limit <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const results = provider.search(args.query, limit)
      if (results.length === 0) return { summary: `No SVC knowledge sections matched "${args.query}".`, empty: true }

      budget.remainingRecords -= results.length
      return {
        summary: `${results.length} knowledge section(s) matched "${args.query}". Call knowledge_getSection for the full text of a relevant one.`,
        data: { sections: results, source: KNOWLEDGE_PACK_SOURCE },
      }
    },
  }

  const getSection: SecretaryTool<{ id: string }> = {
    name: "knowledge_getSection",
    module: "knowledge",
    description:
      "Read the full text of one SVC knowledge section by the id returned from knowledge_search. Use this before giving a detailed tutorial/step-by-step answer, and relay any CONFIRMED / PRODUCT DIRECTION / NEEDS VERIFICATION or in-progress/unshipped wording in it faithfully — never present unverified or work-in-progress content as settled current behavior.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string", description: "A section id returned by knowledge_search." } },
    },
    schema: z.object({ id: z.string().min(1).max(120) }),
    async run(args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }

      const section = provider.getSection(args.id)
      if (!section) return { summary: `No knowledge section with id "${args.id}". Call knowledge_search first to find a valid id.`, empty: true }

      budget.remainingRecords -= 1
      return { summary: `Full text of "${section.title}".`, data: { section, source: KNOWLEDGE_PACK_SOURCE } }
    },
  }

  return [search, getSection]
}
