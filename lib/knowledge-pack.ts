import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Parses the SVC knowledge documents into searchable chunks and provides
 * lexical retrieval over them — one shared pool drawn from two files, not two
 * separate knowledge systems:
 *
 *  - `SVC_AI_Secretary_Canonical_Knowledge_Pack.md` — code-audited
 *    product/module knowledge (how the SVC app works).
 *  - `SVC_Company_Mission_Operating_Framework_Knowledge.md` — company/
 *    organizational knowledge (what SVC is, Site Supervision, the Vision →
 *    Mission → Operation → Objective → Goal → Task → Action framework, Cool
 *    Breeze, Operation Major Kong, the Adventure Map). Each of its chunk ids
 *    is prefixed `mission-` (see `parseKnowledgePackMarkdown`'s `idPrefix`)
 *    since both files independently number their sections `# 0.`, `# 1.`, …
 *    and would otherwise collide.
 *
 * Every chunk carries a `source` field (which file it came from), consumed by
 * `lib/company-knowledge.ts` and `lib/whatsapp-secretary/tools/knowledge.ts`
 * for citation — nothing else about retrieval treats the two files
 * differently. This is the single source of stable SVC knowledge for the
 * WhatsApp Secretary (`lib/company-knowledge.ts`'s always-injected baseline
 * grounding) and, deeper on demand, the `knowledge_search`/`knowledge_getSection`
 * tools (`lib/whatsapp-secretary/tools/knowledge.ts`). It deliberately does
 * NOT call an embedding/LLM provider — the corpus is small and a WhatsApp
 * reply has to stay fast, so plain keyword scoring (the same approach the
 * codebase already uses for Directory's derived `keywords` search and the old
 * curated company-knowledge entries) is enough.
 *
 * Chunking is two-level, matching each document's own `# N. Title` /
 * `## Subtitle` structure:
 *  - one "broad" chunk per top-level `# N. Title` section (its full text,
 *    including every nested `##` subsection) — good for "what is X" questions;
 *  - one "narrow" chunk per `## Subtitle` inside it — good for a specific
 *    detail ("what fields does an Outlook task have").
 * Both are indexed together; search naturally returns whichever is the
 * better match. `###`-level headers (used only for the CONFIRMED / PRODUCT
 * DIRECTION / NEEDS VERIFICATION labels in the canonical pack's §1) are not
 * separate chunks — they stay as plain text inside whichever `##`/`#` chunk
 * contains them, which is exactly what preserves the status-label wording
 * verbatim in what a tool returns.
 */

const KNOWLEDGE_PACK_FILENAME = "SVC_AI_Secretary_Canonical_Knowledge_Pack.md"
export const KNOWLEDGE_PACK_SOURCE = KNOWLEDGE_PACK_FILENAME

const COMPANY_MISSION_FILENAME = "SVC_Company_Mission_Operating_Framework_Knowledge.md"
export const COMPANY_MISSION_KNOWLEDGE_SOURCE = COMPANY_MISSION_FILENAME

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
  /** Which source markdown file this chunk was parsed from — see the module doc comment above. */
  source: string
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

export interface ParseKnowledgePackOptions {
  /** Prepended to every chunk id from this parse (e.g. `"mission"` ->
   * `mission-sec-7`), so two source files that each number their own
   * sections `# 0.`, `# 1.`, … don't collide once merged into one pool.
   * Omit for the default/primary source (unprefixed, matching every
   * existing chunk id). */
  idPrefix?: string
  /** Recorded on every chunk as `KnowledgeChunk.source`. Defaults to the
   * canonical pack's filename. */
  source?: string
}

export function parseKnowledgePackMarkdown(raw: string, options: ParseKnowledgePackOptions = {}): KnowledgeChunk[] {
  const idPrefix = options.idPrefix ? `${options.idPrefix}-` : ""
  const source = options.source ?? KNOWLEDGE_PACK_FILENAME
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
        source,
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
        source,
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
      sectionId = uniqueId(`${idPrefix}sec-${sectionNumber}`)
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
 * Reads and parses both knowledge documents once per warm server instance.
 * `path.join(process.cwd(), ...)` with a static literal is the pattern
 * Next.js's output file tracing recognizes, so each markdown file is
 * included in the deployed serverless function bundle automatically — each
 * `readFileSync` call site below must keep a literal filename constant
 * directly in the `path.join(...)` call, not passed through a shared helper
 * function parameter, or Next's tracer may not pick it up.
 *
 * The two files are read independently, each with its own try/catch: if one
 * is missing or malformed, the other's knowledge still loads rather than the
 * whole corpus going empty.
 */
export function getKnowledgeChunks(): KnowledgeChunk[] {
  if (cachedChunks) return cachedChunks
  const chunks: KnowledgeChunk[] = []

  try {
    const raw = readFileSync(path.join(process.cwd(), KNOWLEDGE_PACK_FILENAME), "utf8")
    chunks.push(...parseKnowledgePackMarkdown(raw))
  } catch (error) {
    console.error("Unable to read/parse the SVC canonical knowledge pack.", error)
  }

  try {
    const raw = readFileSync(path.join(process.cwd(), COMPANY_MISSION_FILENAME), "utf8")
    chunks.push(...parseKnowledgePackMarkdown(raw, { idPrefix: "mission", source: COMPANY_MISSION_KNOWLEDGE_SOURCE }))
  } catch (error) {
    console.error("Unable to read/parse the SVC company mission knowledge.", error)
  }

  cachedChunks = chunks
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
  // on its own it isn't a useful discriminator once the query has other real
  // terms alongside it — dropping it there keeps a query like "svc clocking"
  // behaving the same as a plain "clocking" query. But when "svc" and at most
  // one other word are all that's left (e.g. "what does SVC stand for?" ->
  // "svc", "stand"), "svc" usually *is* the actual subject of the question,
  // not noise to discard — keep it in that case.
  return tokens.length > 2 ? tokens.filter((token) => token !== "svc") : tokens
}

function tokenSet(value: string): Set<string> {
  return new Set(tokenizeKnowledgeQuery(value))
}

/**
 * Cheap singular/plural tolerance without a stemming library or dictionary:
 * also try the token with a trailing "s" added or removed (e.g. "stand" /
 * "stands", "report" / "reports"). Long-enough tokens only, to avoid
 * nonsense variants on short words. This is what lets a natural phrasing
 * like "what does SVC stand for" find content written as "SVC stands for...".
 */
function tokenVariants(token: string): string[] {
  if (token.length < 4) return [token]
  return token.endsWith("s") ? [token, token.slice(0, -1)] : [token, `${token}s`]
}

function hasTokenOrVariant(haystackTokens: Set<string>, token: string): boolean {
  return tokenVariants(token).some((variant) => haystackTokens.has(variant))
}

/**
 * True if any two adjacent tokens from `queryTokens` (in the order the user
 * asked them, singular/plural-tolerant) also appear adjacent to each other in
 * `contentTokens`. Catches an exact multi-word named term or fact — e.g.
 * "Cool Breeze", "Operation Major Kong", "SVC stands for" — that only ever
 * appears in body prose, never in any chunk's title or breadcrumb. Without
 * this, a two-token query like "Cool Breeze" can never clear
 * `MIN_RELEVANCE_SCORE`: each token alone only earns the flat 1-point content
 * weight, capping the total at 2 regardless of how squarely the phrase is the
 * actual subject of the match.
 */
function hasAdjacentPhraseMatch(queryTokens: string[], contentTokens: string[]): boolean {
  if (queryTokens.length < 2 || contentTokens.length < 2) return false
  const contentBigrams = new Set<string>()
  for (let i = 0; i < contentTokens.length - 1; i += 1) {
    contentBigrams.add(`${contentTokens[i]} ${contentTokens[i + 1]}`)
  }
  for (let i = 0; i < queryTokens.length - 1; i += 1) {
    for (const first of tokenVariants(queryTokens[i])) {
      for (const second of tokenVariants(queryTokens[i + 1])) {
        if (contentBigrams.has(`${first} ${second}`)) return true
      }
    }
  }
  return false
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
    const contentTokenList = tokenizeKnowledgeQuery(chunk.content)
    const contentTokens = new Set(contentTokenList)
    let score = 0
    for (const token of queryTokens) {
      if (hasTokenOrVariant(titleTokens, token)) score += 6
      if (hasTokenOrVariant(breadcrumbTokens, token)) score += 3
      if (hasTokenOrVariant(contentTokens, token)) score += 1
    }
    // Reward an exact adjacent phrase in the content as strongly as a title
    // hit — see hasAdjacentPhraseMatch's doc comment for why this matters.
    if (hasAdjacentPhraseMatch(queryTokens, contentTokenList)) score += 6
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
