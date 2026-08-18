import assert from "node:assert/strict"
import test from "node:test"
import { addSecretaryIntroduction, isDiscoveryMessage, createWhatsAppSecretaryPresentation } from "../lib/whatsapp-response-ux"

test("uses a native list for an explicit ambiguity, from the resolver's one shared shape", () => {
  const reply = createWhatsAppSecretaryPresentation({
    answer: "Several records matched.",
    question: "Who is Alex?",
    executions: [
      {
        name: "directory_getEntity",
        result: {
          summary: 'More than one person matches "Alex". Ask which one.',
          data: {
            candidates: [
              { ref: "e1", kind: "person", name: "Alex Rivera", role: "Foreman", companyName: "SVC" },
              { ref: "e2", kind: "person", name: "Alex Kim", role: "Project Manager", companyName: "North Ridge" },
            ],
          },
        },
      },
    ],
  })

  assert.equal(reply.presentation?.kind, "list")
  assert.match(reply.text, /2 possible persons/)
  assert.deepEqual(reply.presentation?.kind === "list" ? reply.presentation.rows : [], [
    { id: "svc-choice-1", title: "Alex Rivera", description: "Foreman · SVC" },
    { id: "svc-choice-2", title: "Alex Kim", description: "Project Manager · North Ridge" },
  ])
})

test("a search returning several records is data for the model, NOT a question for the user", () => {
  // Regression guard from a live eval: treating any multi-record search as a
  // disambiguation prompt hijacked broad questions — the model ran one
  // exploratory Directory search and the user got "I found 10 possible
  // records" instead of an answer.
  const reply = createWhatsAppSecretaryPresentation({
    answer: "North Ridge has an active Outlook and two reports this week.",
    question: "What's going on with North Ridge?",
    executions: [
      {
        name: "directory_search",
        result: {
          summary: "10 Directory record(s) matched.",
          data: { records: [{ id: "job__a", name: "North Ridge" }, { id: "job__b", name: "North Ridge Tower" }] },
        },
      },
    ],
  })
  assert.notEqual(reply.presentation?.kind, "list")
  assert.match(reply.text, /North Ridge has an active Outlook/)
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
        name: "directory_search",
        result: { summary: "1 person matched.", data: { records: [{ id: "person__maya", name: "Maya Lin" }] } },
      },
      {
        name: "questCoral_getProject",
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

const introductionCopy = {
  standalone: "Hi Ben — I'm Courtney Roberts, your SVC assistant.\nI know you as Ben Acosta, Site Supervisor.\nTry:\n• What's happening on North Ridge?",
  prefix: "Hi Ben — I'm Courtney Roberts, your SVC assistant. I know you as Ben Acosta, Site Supervisor. Ask “what can you do?” any time.",
}

test("prefixes the introduction to a substantive answer instead of replacing it", () => {
  const reply = addSecretaryIntroduction(
    { text: "Maya Lin is the project owner." },
    { ...introductionCopy, message: "Who owns Customer Onboarding Redesign?" },
  )
  assert.equal(reply.text, `${introductionCopy.prefix}\n\nMaya Lin is the project owner.`)
})

test("replaces the answer with the full introduction card for a bare greeting", () => {
  const reply = addSecretaryIntroduction({ text: "unused" }, { ...introductionCopy, message: "Hello" })
  assert.match(reply.text, /^Hi Ben — I'm Courtney Roberts, your SVC assistant\./)
  assert.match(reply.text, /What's happening on North Ridge\?/)
  assert.doesNotMatch(reply.text, /unused/)
})

test("treats a capability question as discovery, but an ordinary request as a real question", () => {
  assert.equal(isDiscoveryMessage("what can you do?"), true)
  assert.equal(isDiscoveryMessage("How can you help me"), true)
  assert.equal(isDiscoveryMessage("Hey"), true)
  assert.equal(isDiscoveryMessage("What can you tell me about North Ridge?"), false)
  assert.equal(isDiscoveryMessage("Who owns Customer Onboarding Redesign?"), false)
})

test("keeps the introduction card's line breaks so WhatsApp renders the example bullets", () => {
  const reply = addSecretaryIntroduction({ text: "unused" }, { ...introductionCopy, message: "hi" })
  assert.ok(reply.text.includes("\n• What's happening on North Ridge?"))
})

test("keeps a disambiguation list intact and only re-bodies it with the introduction", () => {
  const listReply = {
    text: "I found 2 possible people. Select the right one to continue.",
    presentation: {
      kind: "list" as const,
      body: "I found 2 possible people. Select the right one to continue.",
      buttonText: "Select one",
      sectionTitle: "Matches",
      rows: [{ id: "svc-choice-1", title: "Alex Rivera" }],
    },
  }
  const reply = addSecretaryIntroduction(listReply, { ...introductionCopy, message: "Who is Alex?" })
  assert.equal(reply.presentation?.kind, "list")
  assert.equal(reply.presentation?.body, reply.text)
  assert.match(reply.text, /Select the right one to continue/)
})

// --- Attachments (2026-08-14): only attached when the question actually asks
// for the file, built from presentation data a tool already authorized —
// never from what the model saw. ---

function reportExecutionWithAttachment(overrides: Partial<{ kind: string; url: string; filename: string; caption: string }> = {}) {
  return {
    name: "reports_search",
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
        name: "directory_getEntity",
        result: {
          summary: 'More than one person matches "Alex". Ask which one.',
          data: { candidates: [{ ref: "e1", kind: "person", name: "Alex Rivera" }, { ref: "e2", kind: "person", name: "Alex Kim" }] },
        },
      },
      reportExecutionWithAttachment(),
    ],
  })
  assert.equal(reply.presentation?.kind, "list")
  assert.equal(reply.attachments, undefined)
})
