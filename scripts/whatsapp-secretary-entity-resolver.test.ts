import assert from "node:assert/strict"
import test from "node:test"
import { createEntityResolver, describeUnresolved, toModelEntity, type EntityLookups } from "../lib/whatsapp-secretary/entity-resolver"
import { directoryRecord, fixtureLookups } from "./secretary-test-resolver"

const northRidge = directoryRecord({ name: "North Ridge", type: "job", sourceId: "ctx-north-ridge", id: "job__north-ridge" })
const northRidgeTower = directoryRecord({ name: "North Ridge Tower", type: "job", sourceId: "ctx-nrt", id: "job__nrt" })
const person = directoryRecord({
  name: "Courtney Roberts",
  type: "person",
  sourceCollection: "contacts",
  sourceId: "contact-courtney",
  id: "person__courtney",
  role: "Foreman",
})

function countingLookups(base: EntityLookups, counter: { calls: number }): EntityLookups {
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

test("resolves a job to every id at once — Directory context and ByeByeDPR job together", async () => {
  const resolver = createEntityResolver(
    fixtureLookups({ jobs: [northRidge], linkedJobs: { "ctx-north-ridge": { id: "job-nr", name: "North Ridge" } } }),
  )
  const resolution = await resolver.resolve("North Ridge", "job")
  assert.equal(resolution.status, "found")
  if (resolution.status !== "found") return

  // The whole point: one lookup produces the ids every module needs, so no
  // module has to re-derive the other half and risk landing elsewhere.
  assert.equal(resolution.entity.sourceIds.contextId, "ctx-north-ridge")
  assert.equal(resolution.entity.sourceIds.byeByeDprJobId, "job-nr")
  assert.equal(resolution.entity.sourceIds.directoryId, "job__north-ridge")
})

test("resolves the same name only once, no matter how many modules ask", async () => {
  const counter = { calls: 0 }
  const resolver = createEntityResolver(countingLookups(fixtureLookups({ jobs: [northRidge] }), counter))

  const [a, b, c] = await Promise.all([
    resolver.resolve("North Ridge", "job"),
    resolver.resolve("north ridge", "job"),
    resolver.resolve("  North Ridge  ", "job"),
  ])

  assert.equal(counter.calls, 1, "concurrent callers share one in-flight lookup")
  assert.equal(a.status, "found")
  // Identical entity object, so two modules can never be talking about different jobs.
  assert.equal(a.status === "found" && b.status === "found" ? a.entity.ref === b.entity.ref : false, true)
  assert.equal(a.status === "found" && c.status === "found" ? a.entity === c.entity : false, true)
})

test("a ref resolves with no lookup at all, and never falls back onto a different record", async () => {
  const counter = { calls: 0 }
  const resolver = createEntityResolver(countingLookups(fixtureLookups({ jobs: [northRidge] }), counter))
  const first = await resolver.resolve("North Ridge", "job")
  assert.equal(first.status, "found")
  if (first.status !== "found") return
  assert.equal(counter.calls, 1)

  const byRef = await resolver.resolveArg({ ref: first.entity.ref }, "job")
  assert.equal(counter.calls, 1, "a known ref costs nothing")
  assert.equal(byRef.status === "found" ? byRef.entity.ref : "", first.entity.ref)

  // A stale/unknown ref must not silently resolve to something else.
  const stale = await resolver.resolveArg({ ref: "e999" }, "job")
  assert.equal(stale.status, "not-found")
  assert.equal(counter.calls, 1)

  // A ref of the wrong kind is likewise not honored.
  const wrongKind = await resolver.resolveArg({ ref: first.entity.ref }, "person")
  assert.equal(wrongKind.status, "not-found")
})

test("reports ambiguity once, in one shape, instead of each module inventing its own", async () => {
  const resolver = createEntityResolver(fixtureLookups({ jobs: [northRidge, northRidgeTower] }))
  const resolution = await resolver.resolve("North Ridge", "job")
  assert.equal(resolution.status, "ambiguous")
  if (resolution.status !== "ambiguous") return
  assert.deepEqual(resolution.candidates.map((entity) => entity.name), ["North Ridge", "North Ridge Tower"])

  const described = describeUnresolved(resolution, "job", "North Ridge")
  assert.match(described.summary, /More than one job matches/)
  const candidates = (described.data as { candidates: Array<{ name: string; ref: string }> }).candidates
  assert.equal(candidates.length, 2)
  assert.ok(candidates.every((candidate) => typeof candidate.ref === "string"))
})

test("falls back to the ByeByeDPR job collection when Directory cannot place a job", async () => {
  const resolver = createEntityResolver(
    fixtureLookups({ jobs: [], byeByeDprJobs: [{ id: "job-legacy", name: "LDS Outdoor Pavilions", directoryContextId: "ctx-lds" }] }),
  )
  const resolution = await resolver.resolve("LDS Outdoor Pavilions", "job")
  assert.equal(resolution.status, "found")
  if (resolution.status !== "found") return
  assert.equal(resolution.entity.sourceIds.byeByeDprJobId, "job-legacy")
  assert.equal(resolution.entity.sourceIds.contextId, "ctx-lds")
})

test("attaches a person's linked SVC account id, so author-scoped lookups work off the same entity", async () => {
  const resolver = createEntityResolver(
    fixtureLookups({ people: [person], linkedUserIds: { "contact-courtney": "user-courtney" } }),
  )
  const resolution = await resolver.resolve("Courtney Roberts", "person")
  assert.equal(resolution.status === "found" ? resolution.entity.sourceIds.linkedUserId : null, "user-courtney")
})

test("resolves Quest Coral projects and Applications candidates through the same interface", async () => {
  const resolver = createEntityResolver(
    fixtureLookups({
      projects: [{ id: "proj-1", name: "Cool Breeze Rollout", status: "in_progress" }],
      candidates: [{ id: "app-1", candidateName: "Dana Reyes", jobName: "North Ridge", status: "submitted" }],
    }),
  )
  const project = await resolver.resolve("Cool Breeze Rollout", "project")
  assert.equal(project.status === "found" ? project.entity.sourceIds.questCoralProjectId : null, "proj-1")

  const candidate = await resolver.resolve("Dana Reyes", "candidate")
  assert.equal(candidate.status === "found" ? candidate.entity.sourceIds.applicationId : null, "app-1")
})

test("the model never sees an internal id — only an opaque ref and safe descriptors", async () => {
  const resolver = createEntityResolver(fixtureLookups({ people: [person] }))
  const resolution = await resolver.resolve("Courtney Roberts", "person")
  assert.equal(resolution.status, "found")
  if (resolution.status !== "found") return

  const projected = toModelEntity(resolution.entity)
  assert.deepEqual(Object.keys(projected).sort(), ["kind", "name", "ref", "role"].sort())
  const serialized = JSON.stringify(projected)
  assert.ok(!serialized.includes("contact-courtney"))
  assert.ok(!serialized.includes("person__courtney"))
})

test("an empty query is not-found rather than an unbounded lookup", async () => {
  let called = false
  const resolver = createEntityResolver({
    ...fixtureLookups(),
    directory: {
      async findByName() {
        called = true
        return []
      },
    },
  })
  assert.equal((await resolver.resolve("   ", "job")).status, "not-found")
  assert.equal(called, false)
})

test("a failed lookup is not cached, so a retry can still succeed", async () => {
  let attempt = 0
  const resolver = createEntityResolver({
    ...fixtureLookups({ jobs: [northRidge] }),
    directory: {
      async findByName(name, options) {
        attempt += 1
        if (attempt === 1) throw new Error("Firestore unavailable")
        return fixtureLookups({ jobs: [northRidge] }).directory.findByName(name, options)
      },
    },
  })

  await assert.rejects(resolver.resolve("North Ridge", "job"))
  const retry = await resolver.resolve("North Ridge", "job")
  assert.equal(retry.status, "found")
})
