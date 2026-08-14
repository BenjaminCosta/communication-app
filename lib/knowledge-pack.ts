import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Parses `SVC_AI_Secretary_Canonical_Knowledge_Pack.md` into searchable
 * chunks and provides lexical retrieval over them.
 *
 * This is the single source of stable SVC company/product knowledge for the
 * WhatsApp Secretary (`lib/company-knowledge.ts`'s always-injected baseline
 * grounding) and, deeper on demand, the `knowledge_search`/`knowledge_getSection`
 * tools (`lib/whatsapp-secretary/tools/knowledge.ts`). It deliberately does
 * NOT call an embedding/LLM provider — the corpus is small (~40 chunks) and a
 * WhatsApp reply has to stay fast, so plain keyword scoring (the same
 * approach the codebase already uses for Directory's derived `keywords`
 * search and the old curated company-knowledge entries) is enough.
 *
 * Chunking is two-level, matching the document's own `# N. Title` /
 * `## Subtitle` structure:
 *  - one "broad" chunk per top-level `# N. Title` section (its full text,
 *    including every nested `##` subsection) — good for "what is X" questions;
 *  - one "narrow" chunk per `## Subtitle` inside it — good for a specific
 *    detail ("what fields does an Outlook task have").
 * Both are indexed together; search naturally returns whichever is the
 * better match. `###`-level headers (used only for the CONFIRMED / PRODUCT
 * DIRECTION / NEEDS VERIFICATION labels in §1) are not separate chunks — they
 * stay as plain text inside whichever `##`/`#` chunk contains them, which is
 * exactly what preserves the status-label wording verbatim in what a tool
 * returns.
 */

const KNOWLEDGE_PACK_FILENAME = "SVC_AI_Secretary_Canonical_Knowledge_Pack.md"
export const KNOWLEDGE_PACK_SOURCE = KNOWLEDGE_PACK_FILENAME

const LEVEL1_HEADING = /^#\s+(\d+)\.\s+(.+?)\s*$/
const LEVEL2_HEADING = /^##(?!#)\s+(.+?)\s*$/

export interface KnowledgeChunk {
  id: string
  title: string
  /** "Title" for a level-1 chunk, "Parent title — Title" for a level-2 chunk. */
  breadcrumb: string
  level: 1 | 2
  /** The level-1 chunk this belongs to (its own id for a level-1 chunk). */
  parentId: string
  content: string
  /** First ~280 characters of `content`, for search-result previews. */
  excerpt: string
}

function slugify(value: string, maxLength = 60): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (slug.length <= maxLength) return slug
  const cut = slug.slice(0, maxLength)
  const lastDash = cut.lastIndexOf("-")
  return (lastDash > maxLength * 0.5 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "")
}

function buildExcerpt(content: string, maxLength = 280): string {
  const flat = content.replace(/\s+/g, " ").trim()
  if (flat.length <= maxLength) return flat
  const cut = flat.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(" ")
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

/** Drops the leading YAML frontmatter block (`---\n...\n---`), if present.
 * Matches the closing fence as its own whole line, not a `---` substring
 * anywhere in the raw text — a folded scalar value (e.g. `audit_note: >`)
 * could otherwise contain a `---` that isn't the real closing fence. */
function stripFrontmatter(raw: string): string {
  const lines = raw.split("\n")
  if (lines[0]?.trim() !== "---") return raw
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closeIndex === -1) return raw
  return lines.slice(closeIndex + 1).join("\n")
}

/** Trims a chunk's own trailing `---` horizontal-rule separator and blank lines. */
function trimChunkBody(lines: string[]): string {
  const body = [...lines]
  while (body.length > 0 && /^\s*$/.test(body[body.length - 1]!)) body.pop()
  while (body.length > 0 && /^---+\s*$/.test(body[body.length - 1]!)) {
    body.pop()
    while (body.length > 0 && /^\s*$/.test(body[body.length - 1]!)) body.pop()
  }
  while (body.length > 0 && /^\s*$/.test(body[0]!)) body.shift()
  return body.join("\n")
}

export function parseKnowledgePackMarkdown(raw: string): KnowledgeChunk[] {
  const lines = stripFrontmatter(raw).split("\n")
  const chunks: KnowledgeChunk[] = []
  const usedIds = new Set<string>()

  /** Guarantees a unique id even when two subsection titles slugify to the
   * same (or an empty) string — `slug || fallback` alone can't do this
   * because the fallback is only reachable when the whole templated string
   * is falsy, which it never is. */
  function uniqueId(base: string): string {
    if (!usedIds.has(base)) {
      usedIds.add(base)
      return base
    }
    let suffix = 2
    while (usedIds.has(`${base}-${suffix}`)) suffix += 1
    const id = `${base}-${suffix}`
    usedIds.add(id)
    return id
  }

  let sectionNumber: string | null = null
  let sectionTitle = ""
  let sectionId = ""
  let sectionLines: string[] = []
  let subTitle: string | null = null
  let subId = ""
  let subLines: string[] = []

  const flushSub = () => {
    if (subTitle === null) return
    const content = trimChunkBody(subLines)
    if (content) {
      chunks.push({
        id: subId,
        title: subTitle,
        breadcrumb: `${sectionTitle} — ${subTitle}`,
        level: 2,
        parentId: sectionId,
        content,
        excerpt: buildExcerpt(content),
      })
    }
    subTitle = null
    subLines = []
  }

  const flushSection = () => {
    flushSub()
    if (sectionNumber === null) return
    const content = trimChunkBody(sectionLines)
    if (content) {
      chunks.push({
        id: sectionId,
        title: sectionTitle,
        breadcrumb: sectionTitle,
        level: 1,
        parentId: sectionId,
        content,
        excerpt: buildExcerpt(content),
      })
    }
    sectionLines = []
  }

  for (const line of lines) {
    const level1Match = LEVEL1_HEADING.exec(line)
    if (level1Match) {
      flushSection()
      sectionNumber = level1Match[1]!
      sectionTitle = level1Match[2]!
      sectionId = uniqueId(`sec-${sectionNumber}`)
      sectionLines = []
      continue
    }

    const level2Match = sectionNumber !== null ? LEVEL2_HEADING.exec(line) : null
    if (level2Match) {
      flushSub()
      subTitle = level2Match[1]!
      const slug = slugify(subTitle)
      subId = uniqueId(slug ? `${sectionId}-${slug}` : `${sectionId}-section`)
      subLines = []
      continue
    }

    if (sectionNumber === null) continue // banner/title lines before the first "# N. Title"
    sectionLines.push(line)
    if (subTitle !== null) subLines.push(line)
  }
  flushSection()

  return chunks
}

let cachedChunks: KnowledgeChunk[] | null = null

/**
 * Reads and parses the knowledge pack once per warm server instance.
 * `path.join(process.cwd(), ...)` with a static literal is the pattern
 * Next.js's output file tracing recognizes, so the markdown file is included
 * in the deployed serverless function bundle automatically.
 */
export function getKnowledgeChunks(): KnowledgeChunk[] {
  if (cachedChunks) return cachedChunks
  try {
    const raw = readFileSync(path.join(process.cwd(), KNOWLEDGE_PACK_FILENAME), "utf8")
    cachedChunks = parseKnowledgePackMarkdown(raw)
  } catch (error) {
    console.error("Unable to read/parse the SVC knowledge pack.", error)
    cachedChunks = []
  }
  return cachedChunks
}

/** Test-only: force the next `getKnowledgeChunks()` call to re-read the file. */
export function resetKnowledgeChunksCacheForTests(): void {
  cachedChunks = null
}

export function getKnowledgeChunkById(id: string): KnowledgeChunk | null {
  return getKnowledgeChunks().find((chunk) => chunk.id === id) ?? null
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "how", "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
  "was", "what", "when", "where", "who", "why", "with", "you", "your",
])

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

export function tokenizeKnowledgeQuery(value: string): string[] {
  const tokens = normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  // "svc" appears in almost every chunk's content (it's the company name), so
  // on its own it isn't a useful discriminator once the query has any other
  // real term — dropping it here matches the old company-knowledge.ts scorer
  // this module replaced, and keeps a query like "svc clocking" behaving the
  // same as a plain "clocking" query instead of diluting scores toward
  // whichever chunks merely happen to say "SVC" more often.
  return tokens.length > 1 ? tokens.filter((token) => token !== "svc") : tokens
}

function hasToken(haystackTokens: Set<string>, token: string): boolean {
  return haystackTokens.has(token)
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenizeKnowledgeQuery(value))
}

const MIN_RELEVANCE_SCORE = 3

export interface ScoredKnowledgeChunk {
  chunk: KnowledgeChunk
  score: number
}

/**
 * Presence-based keyword scoring (a token either matches a field or it
 * doesn't — no frequency weighting), the same style `lib/company-knowledge.ts`
 * used before this module replaced its data source. Title/breadcrumb matches
 * outweigh a content match so a section whose whole subject is the query
 * ranks above one that merely mentions the words in passing.
 */
export function searchKnowledgeChunks(query: string, limit: number): ScoredKnowledgeChunk[] {
  const queryTokens = tokenizeKnowledgeQuery(query)
  if (queryTokens.length === 0) return []

  const scored = getKnowledgeChunks().map((chunk) => {
    const titleTokens = tokenSet(chunk.title)
    const breadcrumbTokens = tokenSet(chunk.breadcrumb)
    const contentTokens = tokenSet(chunk.content)
    let score = 0
    for (const token of queryTokens) {
      if (hasToken(titleTokens, token)) score += 6
      if (hasToken(breadcrumbTokens, token)) score += 3
      if (hasToken(contentTokens, token)) score += 1
    }
    return { chunk, score }
  })

  const ranked = scored.sort(
    (first, second) => second.score - first.score || first.chunk.title.localeCompare(second.chunk.title),
  )
  // A flat absolute floor alone lets a chunk that only weakly matches (one
  // content-only hit) ride along in the same result set as a chunk that's
  // clearly what the question is about. Requiring every result to also be
  // within 60% of the top score — mirroring the relative threshold
  // `lib/company-knowledge.ts` used before this module replaced its data
  // source — keeps a strong single match from being diluted by unrelated
  // filler once a limit > 1 is requested.
  const relevanceThreshold = Math.max(MIN_RELEVANCE_SCORE, (ranked[0]?.score ?? 0) * 0.6)
  return ranked.filter((entry) => entry.score >= relevanceThreshold).slice(0, Math.max(0, limit))
}
