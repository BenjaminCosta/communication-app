import assert from "node:assert/strict"
import test from "node:test"
import type { Message } from "../lib/store"
import { mapMessageDocument, mergeMessageFeed } from "../features/communications/messages/message-feed-model"

function message(id: string, timestamp: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    senderId: "sender",
    participants: ["sender"],
    projectId: null,
    text: id,
    type: "none",
    timestamp: new Date(timestamp),
    ...overrides,
  }
}

test("maps legacy message fields into the current UI contract", () => {
  const mapped = mapMessageDocument("m1", {
    authorId: "author-1",
    content: "Legacy body",
    project_id: "project-1",
    recipientIds: ["user-2"],
    timestamp: "2026-07-01T10:00:00.000Z",
  })

  assert.equal(mapped.senderId, "author-1")
  assert.equal(mapped.text, "Legacy body")
  assert.equal(mapped.projectId, "project-1")
  assert.deepEqual(mapped.projectIds, ["project-1"])
  assert.deepEqual(mapped.peopleIds, ["user-2"])
  assert.deepEqual(mapped.participants, ["author-1"])
})
test("deduplicates sources with visible messages retaining precedence", () => {
  const base = message("same", "2026-07-01T10:00:00.000Z", { text: "participant" })
  const visible = { ...base, text: "visible", visibleToUserIds: ["current-user"] }
  const merged = mergeMessageFeed({
    participantMessages: [base],
    projectMessages: [{ ...base, text: "project" }],
    visibleMessages: [visible],
  }, "current-user")

  assert.equal(merged.length, 1)
  assert.equal(merged[0].text, "visible")
})

test("excludes documents whose materialized visibility omits the current user", () => {
  const merged = mergeMessageFeed({
    participantMessages: [message("hidden", "2026-07-01T10:00:00.000Z", { visibleToUserIds: ["someone-else"] })],
    projectMessages: [],
    visibleMessages: [],
  }, "current-user")

  assert.deepEqual(merged, [])
})

test("keeps legacy documents without visibleToUserIds and sorts chronologically", () => {
  const merged = mergeMessageFeed({
    participantMessages: [
      message("newer", "2026-07-02T10:00:00.000Z"),
      message("older", "2026-07-01T10:00:00.000Z"),
    ],
    projectMessages: [],
    visibleMessages: [],
  }, "current-user")

  assert.deepEqual(merged.map((entry) => entry.id), ["older", "newer"])
})
