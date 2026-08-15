import assert from "node:assert/strict"
import test from "node:test"
import type { DirectoryDataProvider } from "../features/directory/ai/server/tools/types"
import type { DirectoryIndexRecord } from "../lib/ai/server/directory-data"
import { createFixtureProvider as createDirectoryFixtureProvider } from "./directory-fixture"
import {
  createMessagesTools,
  type HumanMessageSummary,
  type MessagesToolsProvider,
  type OperationalMessageSummary,
} from "../lib/whatsapp-secretary/tools/messages"
import type { SecretaryToolBudget } from "../lib/whatsapp-secretary/tool-registry"

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 24 }
}

function makeOperationalPost(overrides: Partial<OperationalMessageSummary> = {}): OperationalMessageSummary {
  return {
    category: "outlook",
    authorName: "Jordan Blake",
    jobName: "Appaloosa",
    text: "3-Week Outlook · Appaloosa\n2026-08-03 · Version 1\n\n5 scheduled tasks.",
    createdAt: "2026-08-03T00:00:00.000Z",
    imageUrl: null,
    fileUrl: null,
    fileName: null,
    ...overrides,
  }
}

function makeHumanMessage(overrides: Partial<HumanMessageSummary> = {}): HumanMessageSummary {
  return {
    authorName: "Sam Rivera",
    jobName: "Appaloosa",
    type: "progress",
    text: "Framing crew is on site today.",
    createdAt: "2026-08-04T00:00:00.000Z",
    imageUrl: null,
    fileUrl: null,
    fileName: null,
    ...overrides,
  }
}

function createFixtureProvider(overrides: Partial<MessagesToolsProvider> = {}): MessagesToolsProvider {
  return {
    async searchOperationalHistory() {
      return [makeOperationalPost()]
    },
    async searchMyCommunications() {
      return [makeHumanMessage()]
    },
    ...overrides,
  }
}

/** Minimal directory fixture for ambiguity/no-match cases the shared fixture doesn't cover. */
function ambiguousJobDirectoryProvider(): DirectoryDataProvider {
  const candidates: DirectoryIndexRecord[] = [
    { id: "job__a", type: "job", sourceCollection: "contexts", sourceId: "job-a", name: "North Ridge A", normalizedName: "north ridge a", companyName: "", location: "Site A", role: "", subtitle: "", description: "", status: "", askContext: null, sourceUpdatedAtMs: null },
    { id: "job__b", type: "job", sourceCollection: "contexts", sourceId: "job-b", name: "North Ridge B", normalizedName: "north ridge b", companyName: "", location: "Site B", role: "", subtitle: "", description: "", status: "", askContext: null, sourceUpdatedAtMs: null },
  ]
  return {
    async findByName() {
      return candidates
    },
    async getEntity() {
      return null
    },
    async getRelations() {
      return { relations: {}, edges: [] } as never
    },
    async getNotes() {
      return []
    },
  }
}

function noMatchDirectoryProvider(): DirectoryDataProvider {
  return {
    async findByName() {
      return []
    },
    async getEntity() {
      return null
    },
    async getRelations() {
      return { relations: {}, edges: [] } as never
    },
    async getNotes() {
      return []
    },
  }
}

test("Messages tools are namespaced", () => {
  const tools = createMessagesTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider(), actorUserId: "user-sender" })
  assert.deepEqual(tools.map((tool) => tool.name), ["messages_searchOperationalHistory", "messages_searchMyCommunications"])
  assert.ok(tools.every((tool) => tool.module === "messages"))
})

test("messages_searchMyCommunications' schema never accepts a target-user argument from the model", () => {
  const tools = createMessagesTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider(), actorUserId: "user-sender" })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  const properties = Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties)
  assert.deepEqual(properties.sort(), ["jobName", "limit", "since", "tag", "type", "until"].sort())
})

test("messages_searchOperationalHistory resolves a job name via Directory and returns automatic posts", async () => {
  const captured: { contextId?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory(options) {
        captured.contextId = options.contextId
        return [makeOperationalPost()]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)

  const result = await tool.run({ jobName: "Appaloosa" }, budget())
  assert.equal(captured.contextId, "appaloosa")
  const data = result.data as { posts: OperationalMessageSummary[] }
  assert.equal(data.posts[0]?.category, "outlook")
  assert.match(result.summary, /Appaloosa/)
})

test("messages_searchOperationalHistory is available with no actorUserId — it is not actor-scoped", async () => {
  const tools = createMessagesTools({ provider: createFixtureProvider(), directoryProvider: createDirectoryFixtureProvider() })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({}, budget())
  assert.equal(result.empty, undefined)
})

test("messages_searchOperationalHistory reports ambiguity across matching jobs without guessing", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchOperationalHistory: async () => {
        throw new Error("must not be called when the job name is ambiguous")
      },
    }),
    directoryProvider: ambiguousJobDirectoryProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({ jobName: "North Ridge" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

test("messages_searchOperationalHistory returns an explained empty result when no job matches", async () => {
  const tools = createMessagesTools({ provider: createFixtureProvider(), directoryProvider: noMatchDirectoryProvider() })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({ jobName: "Nowhere" }, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /No job matches/)
})

test("messages_searchOperationalHistory passes category and date filters through to the provider", async () => {
  const captured: { category?: string; since?: string; until?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory(options) {
        captured.category = options.category
        captured.since = options.since
        captured.until = options.until
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  await tool.run({ category: "clocking", since: "2026-08-01", until: "2026-08-10" }, budget())
  assert.equal(captured.category, "clocking")
  assert.equal(captured.since, "2026-08-01")
  assert.equal(captured.until, "2026-08-10")
})

test("messages_searchOperationalHistory decrements the shared budget by what was actually returned", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory() {
        return [makeOperationalPost(), makeOperationalPost({ category: "clocking" })]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const sharedBudget = budget()
  await tool.run({}, sharedBudget)
  assert.equal(sharedBudget.remainingRecords, 22)
})

test("messages_searchOperationalHistory refuses to call the provider when the shared budget is exhausted", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchOperationalHistory: async () => {
        throw new Error("must not be called when the budget is exhausted")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const exhausted: SecretaryToolBudget = { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 0 }
  const result = await tool.run({}, exhausted)
  assert.equal(result.empty, true)
  assert.match(result.summary, /budget/)
})

test("messages_searchMyCommunications returns a graceful empty result and never queries when there is no linked actorUserId", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchMyCommunications: async () => {
        throw new Error("must not be called without an actorUserId")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    // actorUserId intentionally omitted — an identified-but-unlinked WhatsApp sender.
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  const result = await tool.run({}, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /isn't linked/)
})

test("messages_searchMyCommunications scopes the query to the resolved actorUserId, never a model-supplied one", async () => {
  const captured: { actorUserId?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchMyCommunications(options) {
        captured.actorUserId = options.actorUserId
        return [makeHumanMessage()]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    actorUserId: "user-sender-42",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  const result = await tool.run({}, budget())
  assert.equal(captured.actorUserId, "user-sender-42")
  const data = result.data as { messages: HumanMessageSummary[] }
  assert.equal(data.messages[0]?.authorName, "Sam Rivera")
  assert.equal(result.empty, undefined)
})

test("messages_searchMyCommunications resolves a job name via Directory the same way the operational tool does", async () => {
  const captured: { contextId?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchMyCommunications(options) {
        captured.contextId = options.contextId
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    actorUserId: "user-sender",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  await tool.run({ jobName: "Appaloosa" }, budget())
  assert.equal(captured.contextId, "appaloosa")
})

test("messages_searchMyCommunications passes the type filter through to the provider", async () => {
  const captured: { type?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchMyCommunications(options) {
        captured.type = options.type
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    actorUserId: "user-sender",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  await tool.run({ type: "problem" }, budget())
  assert.equal(captured.type, "problem")
})

test("messages_searchMyCommunications reports ambiguity across matching jobs without guessing", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchMyCommunications: async () => {
        throw new Error("must not be called when the job name is ambiguous")
      },
    }),
    directoryProvider: ambiguousJobDirectoryProvider(),
    actorUserId: "user-sender",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  const result = await tool.run({ jobName: "North Ridge" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

// --- Attachments (2026-08-14): imageUrl/fileUrl/fileName never reach the
// model's data, only the deterministic presentation layer. ---

test("messages_searchOperationalHistory: an Outlook post with a PDF produces a presentation attachment, and fileUrl never reaches data", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory() {
        return [makeOperationalPost({ fileUrl: "https://firebasestorage.googleapis.com/outlook.pdf", fileName: "Outlook.pdf" })]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)

  const result = await tool.run({}, budget())
  const data = result.data as { posts: Array<Record<string, unknown>> }
  assert.equal(data.posts[0]?.fileUrl, undefined)

  const presentation = result.presentation as { attachments: Array<{ kind: string; url: string; filename?: string }> } | undefined
  assert.equal(presentation?.attachments?.length, 1)
  assert.equal(presentation.attachments[0]?.kind, "document")
  assert.equal(presentation.attachments[0]?.url, "https://firebasestorage.googleapis.com/outlook.pdf")
})

test("messages_searchOperationalHistory: a post with no attachment fields produces no presentation", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory() {
        return [makeOperationalPost()]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({}, budget())
  assert.equal(result.presentation, undefined)
})

test("messages_searchMyCommunications: a human message with an image produces a presentation attachment, and imageUrl never reaches data", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchMyCommunications() {
        return [makeHumanMessage({ imageUrl: "https://firebasestorage.googleapis.com/photo.jpg" })]
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    actorUserId: "user-sender",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)

  const result = await tool.run({}, budget())
  const data = result.data as { messages: Array<Record<string, unknown>> }
  assert.equal(data.messages[0]?.imageUrl, undefined)

  const presentation = result.presentation as { attachments: Array<{ kind: string; url: string; caption?: string }> } | undefined
  assert.equal(presentation?.attachments?.length, 1)
  assert.equal(presentation.attachments[0]?.kind, "image")
  assert.match(presentation.attachments[0]?.caption ?? "", /Sam Rivera/)
})

// --- Tag search/filter (2026-08-14): Communications tags are backed by
// /projects; resolveTag is an injectable seam (like directoryProvider for
// job names) so tests never touch real Firestore. ---

function fixtureTagResolver(tagId: string, tagName: string): (name: string) => Promise<{ tagId: string; tagName: string } | { ambiguous: true; candidates: Array<{ name: string }> } | null> {
  return async (name) => (name === tagName ? { tagId, tagName } : null)
}

test("messages_searchOperationalHistory resolves a tag name and passes the tagId through to the provider", async () => {
  const captured: { tagId?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchOperationalHistory(options) {
        captured.tagId = options.tagId
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    resolveTag: fixtureTagResolver("tag-time-tracking", "Time Tracking"),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  await tool.run({ tag: "Time Tracking" }, budget())
  assert.equal(captured.tagId, "tag-time-tracking")
})

test("messages_searchOperationalHistory returns an explained empty result when no tag matches", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchOperationalHistory: async () => {
        throw new Error("must not be called when the tag doesn't resolve")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    resolveTag: async () => null,
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({ tag: "Nonexistent Tag" }, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /No Communications tag matches/)
})

test("messages_searchOperationalHistory reports ambiguity across matching tags without guessing", async () => {
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      searchOperationalHistory: async () => {
        throw new Error("must not be called when the tag name is ambiguous")
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    resolveTag: async () => ({ ambiguous: true, candidates: [{ name: "Daily Report" }, { name: "Daily Report " }] }),
  })
  const tool = tools.find((entry) => entry.name === "messages_searchOperationalHistory")
  assert.ok(tool)
  const result = await tool.run({ tag: "Daily Report" }, budget())
  const data = result.data as { candidates?: Array<{ name: string }> }
  assert.equal(data.candidates?.length, 2)
})

test("messages_searchMyCommunications resolves a tag name and passes the tagId through to the provider", async () => {
  const captured: { tagId?: string } = {}
  const tools = createMessagesTools({
    provider: createFixtureProvider({
      async searchMyCommunications(options) {
        captured.tagId = options.tagId
        return []
      },
    }),
    directoryProvider: createDirectoryFixtureProvider(),
    resolveTag: fixtureTagResolver("tag-important", "Important"),
    actorUserId: "user-sender",
  })
  const tool = tools.find((entry) => entry.name === "messages_searchMyCommunications")
  assert.ok(tool)
  await tool.run({ tag: "Important" }, budget())
  assert.equal(captured.tagId, "tag-important")
})
