import assert from "node:assert/strict"
import test from "node:test"
import { countUnreadProjectActivities, type ProjectUpdate } from "@/lib/quest-coral-core"

const updates: ProjectUpdate[] = [
  {
    id: "own-update",
    projectId: "project-a",
    type: "update",
    authorId: "user-a",
    authorName: "Author A",
    body: "My own activity",
    isBlocker: false,
    createdAt: "2026-07-31T09:00:00.000Z",
  },
  {
    id: "teammate-feedback",
    projectId: "project-a",
    type: "feedback",
    authorId: "user-b",
    authorName: "Author B",
    body: "New feedback",
    isBlocker: false,
    createdAt: "2026-07-31T10:00:00.000Z",
  },
  {
    id: "teammate-blocker",
    projectId: "project-a",
    type: "blocker",
    authorId: "user-c",
    authorName: "Author C",
    body: "New blocker",
    isBlocker: true,
    createdAt: "2026-07-31T11:00:00.000Z",
  },
  {
    id: "another-project",
    projectId: "project-b",
    type: "red_team_review",
    authorId: "user-b",
    authorName: "Author B",
    body: "Other project",
    isBlocker: false,
    createdAt: "2026-07-31T12:00:00.000Z",
  },
]

test("Quest Coral unread counts only other users' activity in the project", () => {
  assert.equal(countUnreadProjectActivities(updates, "project-a", "user-a", null), 2)
})

test("Quest Coral unread excludes activity at or before the read marker", () => {
  assert.equal(countUnreadProjectActivities(updates, "project-a", "user-a", "2026-07-31T10:00:00.000Z"), 1)
  assert.equal(countUnreadProjectActivities(updates, "project-a", "user-a", "2026-07-31T11:00:00.000Z"), 0)
})

test("Quest Coral unread remains zero when activity timestamps are invalid", () => {
  const malformed: ProjectUpdate[] = [{ ...updates[1]!, id: "invalid", createdAt: "not-a-date" }]
  assert.equal(countUnreadProjectActivities(malformed, "project-a", "user-a", null), 0)
})
