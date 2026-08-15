import assert from "node:assert/strict"
import test from "node:test"
import { createEntityResolver, type EntityLookups, type ResolvedEntity } from "../lib/whatsapp-secretary/entity-resolver"
import { buildWhatsAppSecretarySystemPrompt } from "../lib/whatsapp-secretary/prompt"
import { directoryRecord, fixtureLookups } from "./secretary-test-resolver"

/**
 * Cross-turn continuity. Tool results were previously never persisted — only
 * the final assistant text — so a follow-up had to re-call tools, re-spend
 * budget, and risk re-resolving the same name onto a different record than the
 * answer being followed up on.
 */

const northRidge = directoryRecord({ name: "North Ridge", type: "job", sourceId: "ctx-nr", id: "job__nr" })

function countingLookups(counter: { calls: number }): EntityLookups {
  const base = fixtureLookups({ jobs: [northRidge], linkedJobs: { "ctx-nr": { id: "job-nr", name: "North Ridge" } } })
  return {
    ...base,
    directory: {
      async findByName(name, options) {
        counter.calls += 1
        return base.directory.findByName(name, options)
      },
    },
  }
}

test("a ref minted last turn still resolves this turn, with no new lookup", async () => {
  const first = { calls: 0 }
  const turnOne = createEntityResolver(countingLookups(first))
  const resolution = await turnOne.resolve("North Ridge", "job")
  assert.equal(resolution.status, "found")
  if (resolution.status !== "found") return
  assert.equal(first.calls, 1)

  const carried = turnOne.minted()
  assert.equal(carried.length, 1)

  const second = { calls: 0 }
  const turnTwo = createEntityResolver(countingLookups(second))
  turnTwo.hydrate(carried)

  const byRef = await turnTwo.resolveArg({ ref: resolution.entity.ref }, "job")
  assert.equal(byRef.status, "found")
  assert.equal(second.calls, 0, "a carried ref costs nothing on the next turn")
  // And it is the same record, ids intact — which is the correctness point.
  assert.equal(byRef.status === "found" ? byRef.entity.sourceIds.byeByeDprJobId : null, "job-nr")
})

test("re-asking by name on the next turn also reuses the carried entity", async () => {
  const first = { calls: 0 }
  const turnOne = createEntityResolver(countingLookups(first))
  await turnOne.resolve("North Ridge", "job")

  const second = { calls: 0 }
  const turnTwo = createEntityResolver(countingLookups(second))
  turnTwo.hydrate(turnOne.minted())

  const byName = await turnTwo.resolve("north ridge", "job")
  assert.equal(byName.status, "found")
  assert.equal(second.calls, 0)
})

test("a new entity next turn never collides with a carried ref", async () => {
  const turnOne = createEntityResolver(countingLookups({ calls: 0 }))
  const first = await turnOne.resolve("North Ridge", "job")
  assert.equal(first.status, "found")
  if (first.status !== "found") return

  const turnTwo = createEntityResolver(
    fixtureLookups({
      jobs: [northRidge, directoryRecord({ name: "Miami Beach", type: "job", sourceId: "ctx-mb", id: "job__mb" })],
    }),
  )
  turnTwo.hydrate(turnOne.minted())
  const fresh = await turnTwo.resolve("Miami Beach", "job")
  assert.equal(fresh.status, "found")
  if (fresh.status !== "found") return
  assert.notEqual(fresh.entity.ref, first.entity.ref, "ref minting continues past the carried handles")
})

test("hydrating twice is idempotent and never duplicates a handle", () => {
  const resolver = createEntityResolver(fixtureLookups())
  const carried: ResolvedEntity[] = [
    { ref: "e1", kind: "job", name: "North Ridge", sourceIds: { byeByeDprJobId: "job-nr" }, meta: {} },
  ]
  resolver.hydrate(carried)
  resolver.hydrate(carried)
  assert.equal(resolver.minted().length, 1)
  assert.equal(resolver.lookup("e1")?.name, "North Ridge")
})

test("the prompt carries prior refs and cursors forward, so a follow-up pages instead of restarting", () => {
  const prompt = buildWhatsAppSecretarySystemPrompt({
    senderIdentity: { personId: "contact-ben", userId: "user-ben", name: "Ben Acosta", role: "Site Supervisor" },
    companyKnowledge: [],
    accessLevel: "internal",
    priorEntities: [{ ref: "e1", kind: "job", name: "North Ridge" }],
    priorRetrievals: [{ toolName: "reports_search", summary: "3 Daily Report(s) for North Ridge.", nextCursor: "1755200000000" }],
  })

  assert.match(prompt, /e1: North Ridge \(job\)/)
  assert.match(prompt, /pass the ref to any tool instead of re-typing the name/)
  assert.match(prompt, /reports_search: 3 Daily Report\(s\) for North Ridge\./)
  assert.match(prompt, /nextCursor: 1755200000000/)
  assert.match(prompt, /do not re-fetch the same slice/)
})

test("with no prior turn the prompt carries no continuity block at all", () => {
  const prompt = buildWhatsAppSecretarySystemPrompt({
    senderIdentity: null,
    companyKnowledge: [],
    accessLevel: "public",
  })
  assert.doesNotMatch(prompt, /Records already resolved earlier/)
  assert.doesNotMatch(prompt, /Already retrieved earlier/)
})
