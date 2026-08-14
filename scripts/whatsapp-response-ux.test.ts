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

// --- Attachments (2026-08-14): only attached when the question actually asks
// for the file, built from presentation data a tool already authorized —
// never from what the model saw. ---

function reportExecutionWithAttachment(overrides: Partial<{ kind: string; url: string; filename: string; caption: string }> = {}) {
  return {
    name: "reports_searchDailyReportsForJob",
    result: {
      summary: "1 Daily Report for North Ridge.",
      data: { reports: [{ jobName: "North Ridge" }] },
      presentation: {
        attachments: [{ kind: "document", url: "https://signed.example/report.pdf", filename: "Daily Report.pdf", caption: "Daily Report — North Ridge", ...overrides }],
      },
    },
  }
}

test("attaches a file when the question explicitly asks for it", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Here's Courtney's Daily Report for North Ridge.",
    question: "Can you give me the link of the daily report from Courtney Roberts",
    executions: [reportExecutionWithAttachment()],
  })
  assert.equal(reply.attachments?.length, 1)
  assert.equal(reply.attachments?.[0]?.kind, "document")
  assert.equal(reply.attachments?.[0]?.url, "https://signed.example/report.pdf")
})

test("does not attach a file for an ordinary question that never asked for one", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "The latest Daily Report for North Ridge covers framing progress.",
    question: "What's the latest report for North Ridge?",
    executions: [reportExecutionWithAttachment()],
  })
  assert.equal(reply.attachments, undefined)
})

test("does not attach anything when no qualifying tool execution has attachment data", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "The project is on track.",
    question: "Can you send me the file?",
    executions: [{ name: "questCoral_getProject", result: { summary: "ok", data: { project: { name: "Onboarding" } } } }],
  })
  assert.equal(reply.attachments, undefined)
})

test("caps attachments at 3 even if a tool returned more", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Here are today's photos.",
    question: "Show me the photos from today",
    executions: [
      {
        name: "messages_searchMyCommunications",
        result: {
          summary: "4 messages",
          data: { messages: [] },
          presentation: {
            attachments: [
              { kind: "image", url: "https://x/1.jpg" },
              { kind: "image", url: "https://x/2.jpg" },
              { kind: "image", url: "https://x/3.jpg" },
              { kind: "image", url: "https://x/4.jpg" },
            ],
          },
        },
      },
    ],
  })
  assert.equal(reply.attachments?.length, 3)
})

test("picks the most recent qualifying tool execution when several ran in one turn", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Here's the file.",
    question: "Send me the file",
    executions: [
      reportExecutionWithAttachment({ url: "https://signed.example/older.pdf" }),
      {
        name: "messages_searchMyCommunications",
        result: {
          summary: "1 message",
          data: { messages: [] },
          presentation: { attachments: [{ kind: "image", url: "https://x/newer.jpg" }] },
        },
      },
    ],
  })
  assert.equal(reply.attachments?.length, 1)
  assert.equal(reply.attachments?.[0]?.url, "https://x/newer.jpg")
})

test("an ambiguous-candidate list never also carries attachments", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Several records matched.",
    question: "Send me the file",
    executions: [
      {
        name: "directory_searchPeople",
        result: {
          summary: "2 people matched.",
          data: { records: [{ id: "p1", name: "Alex Rivera" }, { id: "p2", name: "Alex Kim" }] },
        },
      },
      reportExecutionWithAttachment(),
    ],
  })
  assert.equal(reply.presentation?.kind, "list")
  assert.equal(reply.attachments, undefined)
})
