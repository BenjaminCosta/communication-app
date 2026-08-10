import assert from "node:assert/strict"
import test from "node:test"
import {
  questCoralCommunicationsContextDescription,
  questCoralCommunicationsContextId,
  questCoralFeedbackAudienceCandidates,
  questCoralFeedbackMessageId,
  questCoralFeedbackReplyMessageId,
  questCoralFeedbackMessageText,
  mergeQuestCoralFeedbackVisibility,
  registeredQuestCoralFeedbackRecipients,
} from "@/lib/quest-coral-communications"

test("Quest Coral Communications ids are stable and keep one context/message per source record", () => {
  assert.equal(questCoralCommunicationsContextId("project-123"), "quest-coral-project-123")
  assert.equal(questCoralFeedbackMessageId("feedback-456"), "quest-coral-feedback-feedback-456")
  assert.equal(questCoralFeedbackReplyMessageId("reply-789"), "quest-coral-feedback-reply-reply-789")
})

test("adding a person to a project expands previous Feedback visibility without revoking recipients", () => {
  assert.deepEqual(
    mergeQuestCoralFeedbackVisibility({
      existingRecipientIds: ["owner", "previous-person"],
      existingPeopleIds: ["owner", "previous-person"],
      existingParticipantIds: ["author", "owner", "previous-person"],
      existingVisibleToUserIds: ["author", "owner", "previous-person"],
      currentRecipientIds: ["owner", "new-person"],
      authorId: "author",
    }),
    {
      recipientIds: ["owner", "previous-person", "new-person"],
      peopleIds: ["owner", "previous-person", "new-person"],
      participants: ["author", "owner", "previous-person", "new-person"],
      visibleToUserIds: ["author", "owner", "previous-person", "new-person"],
    },
  )
})

test("Quest Coral feedback context and message copy are meaningful without exposing internal ids", () => {
  assert.equal(questCoralCommunicationsContextDescription("Keep the crew aligned."), "Quest Coral project: Keep the crew aligned.")
  assert.equal(questCoralCommunicationsContextDescription(""), "This context is linked to a Quest Coral project.")
  assert.equal(
    questCoralFeedbackMessageText("Field rollout", "Workers need a clearer clock-out confirmation."),
    "Feedback on Field rollout\n\nWorkers need a clearer clock-out confirmation.",
  )
})

test("Quest Coral feedback is addressed only to registered project participants, including its registered author", () => {
  const candidates = questCoralFeedbackAudienceCandidates({
    ownerId: "owner",
    people: [{ id: "owner" }, { id: "author" }, { id: "registered-person" }, { id: "imported-contact" }],
  })
  assert.deepEqual(candidates, ["owner", "author", "registered-person", "imported-contact"])
  assert.deepEqual(
    registeredQuestCoralFeedbackRecipients(candidates, ["owner", "author", "registered-person"]),
    ["owner", "author", "registered-person"],
  )
})
