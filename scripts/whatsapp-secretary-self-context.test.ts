import assert from "node:assert/strict"
import test from "node:test"
import {
  buildSelfContextSnapshot,
  clearSelfContextSnapshotCache,
  contactIdFromPersonId,
  getSelfContextSnapshot,
  selfContextActorFromIdentity,
  snapshotHasLiveData,
  type SelfContextActor,
  type SelfContextProvider,
} from "../lib/whatsapp-secretary/self-context"

const TODAY = "2026-08-14"

const linkedActor: SelfContextActor = {
  personId: "contact-ben",
  userId: "user-ben",
  name: "Ben Acosta",
  role: "Site Supervisor",
}

/** Every source returns real data — the "recognized employee with a full record" case. */
function richProvider(overrides: Partial<SelfContextProvider> = {}): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return {
        profile: {
          phone: "+1 555 0100",
          email: "ben@svc.example",
          companyName: "SVC",
          location: "Miami, FL",
          directoryRole: "Site Supervisor",
        },
        jobs: [
          { name: "North Ridge", relationship: "Supervisor", contextId: "ctx-north-ridge" },
          { name: "Miami Beach Project", relationship: null, contextId: "ctx-miami-beach" },
        ],
        companies: [{ name: "Turner", relationship: "Client" }],
      }
    },
    async getQuestCoralInvolvement() {
      return [
        { name: "Cool Breeze Rollout", status: "in_progress", involvement: "owner", nextStep: "Draft the plan", updatedAt: "2026-08-12T10:00:00.000Z" },
      ]
    },
    async getRecentReports() {
      return [{ jobName: "North Ridge", status: "submitted", createdAt: "2026-08-13T18:00:00.000Z" }]
    },
    async getActiveClock() {
      return { jobName: "North Ridge", clockInAt: "2026-08-14T12:00:00.000Z" }
    },
    async getOutlooksForJobs(jobs, onDate) {
      return jobs
        .filter((job) => job.contextId)
        .map((job) => ({
          jobName: job.name,
          windowStart: "2026-08-10",
          windowEnd: "2026-08-31",
          taskCount: 4,
          activeToday: onDate >= "2026-08-10" && onDate <= "2026-08-31",
        }))
    },
    async getVisibleMessageActivity() {
      return { visibleRecentCount: 6, latestAt: "2026-08-14T09:00:00.000Z" }
    },
    async findOwnApplication() {
      return null
    },
    async getRecentJobActivity() {
      return []
    },
    ...overrides,
  }
}

/** Nothing on file anywhere — the "recognized number, empty record" case. */
function emptyProvider(overrides: Partial<SelfContextProvider> = {}): SelfContextProvider {
  return {
    async getDirectoryProfile() {
      return null
    },
    async getQuestCoralInvolvement() {
      return []
    },
    async getRecentReports() {
      return []
    },
    async getActiveClock() {
      return null
    },
    async getOutlooksForJobs() {
      return []
    },
    async getVisibleMessageActivity() {
      return null
    },
    async findOwnApplication() {
      return null
    },
    async getRecentJobActivity() {
      return []
    },
    ...overrides,
  }
}

test("assembles every section for a fully linked employee", async () => {
  const snapshot = await buildSelfContextSnapshot(linkedActor, { provider: richProvider(), today: TODAY })

  assert.equal(snapshot.identity.name, "Ben Acosta")
  assert.equal(snapshot.identity.role, "Site Supervisor")
  assert.equal(snapshot.identity.hasLinkedAccount, true)
  assert.equal(snapshot.identity.recognizedVia, "directory-contact")
  assert.equal(snapshot.profile?.email, "ben@svc.example")
  assert.deepEqual(snapshot.jobs.map((job) => job.name), ["North Ridge", "Miami Beach Project"])
  assert.equal(snapshot.projects[0]?.involvement, "owner")
  assert.equal(snapshot.reports[0]?.jobName, "North Ridge")
  assert.equal(snapshot.clock?.jobName, "North Ridge")
  assert.equal(snapshot.outlooks[0]?.activeToday, true)
  assert.equal(snapshot.messages?.visibleRecentCount, 6)
  assert.equal(snapshotHasLiveData(snapshot), true)
  assert.deepEqual(snapshot.gaps, [])
})

test("an identified sender with no linked app account gets no account-keyed data, and is told why", async () => {
  const contactOnly: SelfContextActor = { personId: "contact-ben", userId: null, name: "Ben Acosta", role: null }
  let questCoralCalls = 0
  const provider = richProvider({
    async getQuestCoralInvolvement() {
      questCoralCalls += 1
      return []
    },
  })

  const snapshot = await buildSelfContextSnapshot(contactOnly, { provider, today: TODAY })

  // Account-keyed sources must not even be queried — there is no uid to query with.
  assert.equal(questCoralCalls, 0)
  assert.deepEqual(snapshot.projects, [])
  assert.deepEqual(snapshot.reports, [])
  assert.equal(snapshot.clock, null)
  assert.equal(snapshot.messages, null)
  // Directory-side context still resolves.
  assert.equal(snapshot.jobs.length, 2)
  assert.ok(snapshot.gaps.some((gap) => gap.includes("no linked SVC app account")))
  // The role gap is stated rather than filled in from the Directory job label.
  assert.equal(snapshot.identity.role, "Site Supervisor", "falls back to the Directory profile's own role, not an inferred one")
})

test("falls back to the Directory profile's role only when the identity has none, and never invents one", async () => {
  const roleless: SelfContextActor = { ...linkedActor, role: null }
  const withoutDirectoryRole = richProvider({
    async getDirectoryProfile() {
      return {
        profile: { phone: null, email: null, companyName: "SVC", location: null, directoryRole: null },
        jobs: [{ name: "North Ridge", relationship: "Supervisor", contextId: "ctx-north-ridge" }],
        companies: [],
      }
    },
  })

  const snapshot = await buildSelfContextSnapshot(roleless, { provider: withoutDirectoryRole, today: TODAY })
  assert.equal(snapshot.identity.role, null, "a job relationship label must never become a role")
  assert.ok(snapshot.gaps.some((gap) => gap.includes("No role/title is on file")))
})

test("a contact-only identity (user:<uid>) skips the Directory read instead of guessing a contact id", async () => {
  const appAccountOnly: SelfContextActor = { personId: "user:user-ben", userId: "user-ben", name: "Ben Acosta", role: null }
  let directoryCalls = 0
  const provider = richProvider({
    async getDirectoryProfile() {
      directoryCalls += 1
      return null
    },
  })

  const snapshot = await buildSelfContextSnapshot(appAccountOnly, { provider, today: TODAY })
  assert.equal(directoryCalls, 0)
  assert.equal(snapshot.identity.recognizedVia, "app-account")
  assert.equal(snapshot.profile, null)
  assert.deepEqual(snapshot.jobs, [])
  assert.ok(snapshot.gaps.some((gap) => gap.includes("no SVC Directory profile")))
  // Account-keyed sections still work — this person does have a uid.
  assert.equal(snapshot.projects.length, 1)
  assert.equal(contactIdFromPersonId(appAccountOnly.personId), null)
})

test("one failing source never blanks the rest of the snapshot", async () => {
  const provider = richProvider({
    async getQuestCoralInvolvement() {
      throw new Error("Firestore is unavailable")
    },
    async getDirectoryProfile() {
      throw new Error("directoryIndex read failed")
    },
  })

  const snapshot = await buildSelfContextSnapshot(linkedActor, { provider, today: TODAY })
  assert.deepEqual(snapshot.projects, [])
  assert.equal(snapshot.profile, null)
  // Everything else survived.
  assert.equal(snapshot.reports.length, 1)
  assert.equal(snapshot.clock?.jobName, "North Ridge")
})

test("reports emptiness honestly for a recognized sender with nothing on file", async () => {
  const snapshot = await buildSelfContextSnapshot(linkedActor, { provider: emptyProvider(), today: TODAY })
  assert.equal(snapshotHasLiveData(snapshot), false)
  assert.ok(snapshot.gaps.some((gap) => gap.includes("No jobs are linked")))
  assert.ok(snapshot.gaps.some((gap) => gap.includes("no Quest Coral projects") || gap.includes("Quest Coral projects")))
  assert.ok(snapshot.gaps.some((gap) => gap.includes("Daily Reports")))
})

test("an outlook window that does not cover today is retained but not marked active", async () => {
  const provider = richProvider({
    async getOutlooksForJobs(jobs) {
      return [{ jobName: jobs[0].name, windowStart: "2026-06-01", windowEnd: "2026-06-21", taskCount: 2, activeToday: false }]
    },
  })
  const snapshot = await buildSelfContextSnapshot(linkedActor, { provider, today: TODAY })
  assert.equal(snapshot.outlooks[0]?.activeToday, false)
})

test("surfaces the sender's own Applications record only when their contact details match one", async () => {
  const provider = richProvider({
    async getRecentJobActivity() {
      return []
    },
    async findOwnApplication(input) {
      assert.equal(input.email, "ben@svc.example")
      return { candidateName: "Ben Acosta", jobName: "North Ridge", status: "submitted", updatedAt: "2026-08-01T00:00:00.000Z" }
    },
  })
  const snapshot = await buildSelfContextSnapshot(linkedActor, { provider, today: TODAY })
  assert.equal(snapshot.application?.status, "submitted")

  // No email and no phone on file → the lookup is never attempted.
  let attempted = false
  const noContactDetails = richProvider({
    async getDirectoryProfile() {
      return { profile: { phone: null, email: null, companyName: null, location: null, directoryRole: null }, jobs: [], companies: [] }
    },
    async findOwnApplication() {
      attempted = true
      return null
    },
  })
  const second = await buildSelfContextSnapshot(linkedActor, { provider: noContactDetails, today: TODAY })
  assert.equal(attempted, false)
  assert.equal(second.application, null)
})

test("the snapshot is memoized per actor within its TTL, then rebuilt", async () => {
  clearSelfContextSnapshotCache()
  let builds = 0
  const provider = emptyProvider({
    async getDirectoryProfile() {
      builds += 1
      return null
    },
  })

  await getSelfContextSnapshot(linkedActor, { provider, today: TODAY, nowMs: 1_000 })
  await getSelfContextSnapshot(linkedActor, { provider, today: TODAY, nowMs: 2_000 })
  assert.equal(builds, 1, "a second read inside the TTL reuses the first fan-out")

  await getSelfContextSnapshot(linkedActor, { provider, today: TODAY, nowMs: 1_000 + 61_000 })
  assert.equal(builds, 2, "past the TTL it rebuilds")

  // A different actor must never read another actor's cached snapshot.
  await getSelfContextSnapshot({ ...linkedActor, personId: "contact-other", userId: "user-other" }, { provider, today: TODAY, nowMs: 2_000 })
  assert.equal(builds, 3)
  clearSelfContextSnapshotCache()
})

test("maps a resolved WhatsApp identity into a self-context actor without inventing fields", () => {
  assert.deepEqual(selfContextActorFromIdentity({ personId: "contact-ben", name: "Ben Acosta" }), {
    personId: "contact-ben",
    userId: null,
    name: "Ben Acosta",
    role: null,
  })
  assert.deepEqual(selfContextActorFromIdentity({ personId: "contact-ben", userId: "user-ben", name: "Ben Acosta", role: "Supervisor" }), {
    personId: "contact-ben",
    userId: "user-ben",
    name: "Ben Acosta",
    role: "Supervisor",
  })
})
