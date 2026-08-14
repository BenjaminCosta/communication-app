import assert from "node:assert/strict"
import test from "node:test"
import {
  getKnowledgeChunkById,
  getKnowledgeChunks,
  parseKnowledgePackMarkdown,
  resetKnowledgeChunksCacheForTests,
  searchKnowledgeChunks,
  tokenizeKnowledgeQuery,
} from "../lib/knowledge-pack"

const FIXTURE = `---
title: "Fixture"
status: "test"
---

# Fixture Title

# 0. Purpose of this document

Some intro text.

# 1. Alpha Module

Alpha's own top-level text.

## Alpha sub one

Sub one body, mentions widgets and gadgets.

### CONFIRMED

A nested level-3 label that must not become its own chunk.

## Alpha sub two

Sub two body, mentions gizmos.

---

# 2. Beta Module

Beta top-level text, mentions widgets too.

## Empty subsection

## Beta sub with content

Beta sub body.

## !!!

First symbol-only-titled subsection.

## ???

Second symbol-only-titled subsection (also slugifies to empty).
`

test("parseKnowledgePackMarkdown: skips the banner title and frontmatter", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  assert.ok(!chunks.some((chunk) => chunk.title.includes("Fixture Title")))
  assert.ok(!chunks.some((chunk) => chunk.content.includes("status:")))
})

test("parseKnowledgePackMarkdown: produces one full-text chunk per level-1 section", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  const alpha = chunks.find((chunk) => chunk.id === "sec-1" && chunk.level === 1)
  assert.ok(alpha, "expected a level-1 chunk for section 1")
  assert.equal(alpha!.title, "Alpha Module")
  assert.equal(alpha!.breadcrumb, "Alpha Module")
  // The level-1 chunk includes its own text AND every nested ## section's text.
  assert.match(alpha!.content, /Alpha's own top-level text/)
  assert.match(alpha!.content, /Sub one body, mentions widgets and gadgets/)
  assert.match(alpha!.content, /Sub two body, mentions gizmos/)
})

test("parseKnowledgePackMarkdown: produces one narrow chunk per level-2 subsection", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  const subOne = chunks.find((chunk) => chunk.id === "sec-1-alpha-sub-one")
  assert.ok(subOne, "expected a level-2 chunk for 'Alpha sub one'")
  assert.equal(subOne!.level, 2)
  assert.equal(subOne!.parentId, "sec-1")
  assert.equal(subOne!.breadcrumb, "Alpha Module — Alpha sub one")
  assert.match(subOne!.content, /Sub one body/)
  // Must not leak Alpha's other subsection's text into this narrow chunk.
  assert.doesNotMatch(subOne!.content, /gizmos/)
})

test("parseKnowledgePackMarkdown: a level-3 heading stays embedded in its parent chunk, not its own chunk", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  assert.ok(!chunks.some((chunk) => chunk.title === "CONFIRMED"))
  const subOne = chunks.find((chunk) => chunk.id === "sec-1-alpha-sub-one")
  assert.match(subOne!.content, /### CONFIRMED/)
  assert.match(subOne!.content, /nested level-3 label/)
})

test("parseKnowledgePackMarkdown: an empty subsection (heading with no body) is dropped, not returned as a blank chunk", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  assert.ok(!chunks.some((chunk) => chunk.title === "Empty subsection"))
})

test("parseKnowledgePackMarkdown: trailing --- separators are trimmed from chunk content", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  const subTwo = chunks.find((chunk) => chunk.id === "sec-1-alpha-sub-two")
  assert.ok(subTwo)
  assert.doesNotMatch(subTwo!.content.trim(), /---\s*$/)
})

test("parseKnowledgePackMarkdown: ids are stable and namespaced by section number", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  assert.ok(chunks.some((chunk) => chunk.id === "sec-0"))
  assert.ok(chunks.some((chunk) => chunk.id === "sec-2"))
  assert.ok(chunks.some((chunk) => chunk.id === "sec-2-beta-sub-with-content"))
})

test("parseKnowledgePackMarkdown: two subsections that both slugify to empty/the same string still get distinct, stable ids", () => {
  const chunks = parseKnowledgePackMarkdown(FIXTURE)
  const symbolChunks = chunks.filter((chunk) => chunk.parentId === "sec-2" && chunk.title.match(/^[!?]+$/))
  assert.equal(symbolChunks.length, 2)
  const ids = symbolChunks.map((chunk) => chunk.id)
  assert.equal(new Set(ids).size, 2, `expected two distinct ids, got ${ids.join(", ")}`)
})

test("tokenizeKnowledgeQuery: drops the near-universal 'svc' token once the query has at least two other real terms, but keeps it alone or paired with just one", () => {
  // Three or more meaningful tokens: "svc" is noise ("svc" appears in nearly
  // every chunk), so drop it and let the more specific terms discriminate.
  assert.deepEqual(tokenizeKnowledgeQuery("svc clocking hours today"), ["clocking", "hours", "today"])
  // Exactly one other token: "svc" is very often the actual subject of a
  // short self-referential question ("what does SVC stand for", "what is
  // SVC"), not noise to discard — keep it. (Regression coverage for a real
  // production incident: this query used to tokenize to just ["stand"],
  // which — combined with "stands" vs "stand" never matching without the
  // singular/plural tolerance below — meant "What does SVC stand for?"
  // silently found nothing.)
  assert.deepEqual(tokenizeKnowledgeQuery("svc clocking"), ["svc", "clocking"])
  assert.deepEqual(tokenizeKnowledgeQuery("what does svc stand for"), ["svc", "stand"])
  assert.deepEqual(tokenizeKnowledgeQuery("svc"), ["svc"])
})

test("tokenizeKnowledgeQuery: strips stopwords, case, and diacritics; keeps short meaningful tokens", () => {
  assert.deepEqual(tokenizeKnowledgeQuery("What is the Outlook AI?"), ["outlook", "ai"])
  assert.deepEqual(tokenizeKnowledgeQuery("Clocking"), ["clocking"])
  assert.deepEqual(tokenizeKnowledgeQuery("¿Cómo funciona?"), ["como", "funciona"])
})

test("getKnowledgeChunks: caches the parsed result across calls, and resets on demand", () => {
  const first = getKnowledgeChunks()
  const second = getKnowledgeChunks()
  assert.equal(first, second, "expected the same cached array reference")
  resetKnowledgeChunksCacheForTests()
  const third = getKnowledgeChunks()
  assert.notEqual(first, third, "expected a fresh array reference after a cache reset")
  assert.deepEqual(first.map((chunk) => chunk.id), third.map((chunk) => chunk.id))
})

// --- Integration coverage against the real knowledge pack file ---

test("real knowledge pack: parses into a substantial number of chunks covering both levels", () => {
  resetKnowledgeChunksCacheForTests()
  const chunks = getKnowledgeChunks()
  assert.ok(chunks.length > 40, `expected 40+ chunks from the real pack, got ${chunks.length}`)
  assert.ok(chunks.some((chunk) => chunk.level === 1))
  assert.ok(chunks.some((chunk) => chunk.level === 2))
})

test("real knowledge pack: a 'what is Quest Coral' style query finds the Quest Coral section first", () => {
  const results = searchKnowledgeChunks("what is Quest Coral", 3)
  assert.ok(results.length > 0)
  assert.equal(results[0]!.chunk.id, "sec-7")
})

test("real knowledge pack: a clocking question surfaces clocking content, not an unrelated module", () => {
  const results = searchKnowledgeChunks("how does clocking in and out work", 3)
  assert.ok(results.length > 0)
  assert.ok(results.some((entry) => entry.chunk.id.startsWith("sec-11")))
})

test("real knowledge pack: every returned result stays within 60% of the top score, even with a generous limit", () => {
  const results = searchKnowledgeChunks("what is a 3-week outlook and how do I create one", 10)
  assert.ok(results.length > 0)
  const topScore = results[0]!.score
  for (const entry of results) {
    assert.ok(entry.score >= topScore * 0.6, `chunk "${entry.chunk.id}" scored ${entry.score}, below 60% of top score ${topScore}`)
  }
})

test("real knowledge pack: an irrelevant query returns nothing rather than a weak guess", () => {
  const results = searchKnowledgeChunks("zzyxx nonexistent gibberish term", 3)
  assert.equal(results.length, 0)
})

test("real knowledge pack: the Outlook work-in-progress callout is retrievable and preserves its wording verbatim", () => {
  const chunk = getKnowledgeChunks().find((entry) => entry.id.startsWith("sec-8") && /uncommitted/i.test(entry.content))
  assert.ok(chunk, "expected to find the Outlook WIP callout chunk under section 8")
  assert.equal(getKnowledgeChunkById(chunk!.id)?.id, chunk!.id)
  assert.match(chunk!.content, /uncommitted/i)
  assert.match(chunk!.content, /should not describe.*shipped/i)
})

test("real knowledge pack: getKnowledgeChunkById returns null for an unknown id instead of throwing", () => {
  assert.equal(getKnowledgeChunkById("sec-does-not-exist"), null)
})

// --- Regression coverage for a real incident (2026-08-14): "Cool Breeze" and
// "Operation Major Kong" only ever appear in body prose, never in a chunk
// title/breadcrumb, so a two-token query for either originally scored below
// MIN_RELEVANCE_SCORE and returned nothing — even though the exact phrase is
// right there in the document. ---

test("real knowledge pack: a named-term query that only appears in body prose ('Cool Breeze') still surfaces the section that defines it", () => {
  const results = searchKnowledgeChunks("Cool Breeze", 5)
  assert.ok(results.length > 0, "expected at least one result for 'Cool Breeze'")
  assert.ok(
    results.some((entry) => entry.chunk.id === "sec-2-organizational-language"),
    `expected sec-2-organizational-language among results, got: ${results.map((r) => r.chunk.id).join(", ")}`,
  )
})

test("real knowledge pack: 'Operation Major Kong' (body-prose-only phrase) is findable", () => {
  const results = searchKnowledgeChunks("Operation Major Kong", 8)
  assert.ok(results.length > 0, "expected at least one result for 'Operation Major Kong'")
})

test("real knowledge pack: a natural self-referential question ('what does SVC stand for') finds the company-identity section", () => {
  for (const query of ["What does SVC stand for?", "what is SVC", "SVC stand for"]) {
    const results = searchKnowledgeChunks(query, 5)
    assert.ok(results.length > 0, `expected at least one result for "${query}"`)
    assert.ok(
      results.some((entry) => entry.chunk.id === "sec-2-what-svc-is"),
      `expected sec-2-what-svc-is among results for "${query}", got: ${results.map((r) => r.chunk.id).join(", ")}`,
    )
  }
})
