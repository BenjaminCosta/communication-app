import assert from "node:assert/strict"
import test from "node:test"
import { addFirstInteractionWelcome, createWhatsAppSecretaryPresentation } from "../lib/whatsapp-response-ux"

test("uses a native list only for multiple explicit Directory search matches", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Several records matched.",
    question: "Who is Alex?",
    executions: [
      {
        name: "directory_searchPeople",
        result: {
          summary: "2 people matched.",
          data: {
            records: [
              { id: "person__alex-1", name: "Alex Rivera", role: "Foreman", companyName: "SVC" },
              { id: "person__alex-2", name: "Alex Kim", role: "Project Manager", companyName: "North Ridge" },
            ],
          },
        },
      },
    ],
  })

  assert.equal(reply.presentation?.kind, "list")
  assert.match(reply.text, /2 possible people/)
  assert.deepEqual(reply.presentation?.kind === "list" ? reply.presentation.rows : [], [
    { id: "svc-choice-1", title: "Alex Rivera", description: "Foreman · SVC" },
    { id: "svc-choice-2", title: "Alex Kim", description: "Project Manager · North Ridge" },
  ])
})

test("uses a direct Project CTA from an already retrieved project id", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "The project is on track at 72%.",
    question: "What is the status of Customer Onboarding Redesign?",
    executions: [
      {
        name: "questCoral_getProject",
        result: {
          summary: "Details for the project.",
          data: { project: { name: "Customer Onboarding Redesign" } },
          presentation: { projectId: "proj-onboarding" },
        },
      },
    ],
  })

  assert.deepEqual(reply.presentation, {
    kind: "cta_url",
    body: "The project is on track at 72%.",
    buttonText: "Open Project",
    url: "https://communication-svc.vercel.app/?questCoral=proj-onboarding",
  })
})

test("prioritizes a resolved project CTA over a supporting Directory lookup", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "The project is on track.",
    question: "What is the project status?",
    executions: [
      {
        name: "directory_searchPeople",
        result: { summary: "1 person matched.", data: { records: [{ id: "person__maya", name: "Maya Lin" }] } },
      },
      {
        name: "questCoral_getProjectUpdates",
        result: { summary: "1 update.", data: { updates: [] }, presentation: { projectId: "proj-onboarding" } },
      },
    ],
  })

  assert.equal(reply.presentation?.kind, "cta_url")
  assert.equal(reply.presentation?.kind === "cta_url" ? reply.presentation.buttonText : "", "Open Project")
})

test("offers the correct module CTA for a supported continuation request", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Application approval is only available in SVC.",
    question: "Approve this application.",
    executions: [],
  })

  assert.equal(reply.presentation?.kind, "cta_url")
  assert.equal(reply.presentation?.kind === "cta_url" ? reply.presentation.buttonText : "", "Open Applications")
  assert.equal(reply.presentation?.kind === "cta_url" ? reply.presentation.url : "", "https://communication-svc.vercel.app/?module=applications")
})

test("welcomes a first-time employee without adding a tutorial to a substantive answer", () => {
  const reply = addFirstInteractionWelcome(
    { text: "Maya Lin is the project owner." },
    { name: "Ben Acosta", message: "Who owns Customer Onboarding Redesign?" },
  )
  assert.equal(reply.text, "Hi Ben — I’m the SVC AI Secretary.\n\nMaya Lin is the project owner.")
})

test("uses a short discovery greeting for a first hello", () => {
  const reply = addFirstInteractionWelcome({ text: "unused" }, { name: "Ben Acosta", message: "Hello" })
  assert.match(reply.text, /^Hi Ben — I’m the SVC AI Secretary\./)
  assert.match(reply.text, /Who manages North Ridge/)
  assert.doesNotMatch(reply.text, /unused/)
})
