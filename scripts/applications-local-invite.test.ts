import assert from "node:assert/strict"
import test from "node:test"
import {
  applicationByToken,
  issueApplicationLink,
  NEW_APPLICATION_MARKER,
  saveMockApplication,
  subscribeMockApplications,
} from "../features/applications/candidate-links"

test("a real local invite stays personalized and reaches the mock dashboard on submit", () => {
  const link = issueApplicationLink({
    applicationId: NEW_APPLICATION_MARKER,
    purpose: "application",
    invite: { candidateName: "Dana Price", trade: "Painter", jobName: "Lakeview Build" },
  })

  const invited = applicationByToken(link.token)
  assert.equal(invited.id, link.applicationId)
  assert.equal(invited.linkToken, link.token)
  assert.equal(invited.candidateName, "Dana Price")
  assert.equal(invited.general.fullName, "Dana Price")
  assert.equal(invited.trade, "Painter")
  assert.equal(invited.general.primaryTrade, "Painter")
  assert.equal(invited.job.name, "Lakeview Build")

  saveMockApplication({
    ...invited,
    status: "submitted",
    submittedAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  })

  let dashboard: Array<typeof invited> = []
  const unsubscribe = subscribeMockApplications((applications) => {
    dashboard = applications
  })
  unsubscribe()

  const submitted = dashboard.find((application) => application.id === invited.id)
  assert.equal(submitted?.status, "submitted")
  assert.equal(submitted?.candidateName, "Dana Price")
  assert.equal(submitted?.job.name, "Lakeview Build")
})
