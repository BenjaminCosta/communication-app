import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"
import {
  assertOnlyAllowedMessagesTools,
  buildToolRegistry,
  runSecretaryTool,
  toolSpecs,
  type SecretaryModule,
  type SecretaryTool,
  type SecretaryToolBudget,
  type SecretaryToolFactory,
} from "../lib/whatsapp-secretary/tool-registry"
import { resolveWhatsAppAccessPolicy } from "../lib/whatsapp-access-policy"

const identifiedIdentity = { personId: "person__sender", userId: "user-sender", name: "Sandbox Sender", role: "Staff" }

function budget(): SecretaryToolBudget {
  return { maxRecordsPerTool: 12, maxNotesPerTool: 0, maxNoteChars: 0, remainingRecords: 10 }
}

function fakeTool(name: string, module: SecretaryModule, recordsReturned: number): SecretaryTool<{ query: string }> {
  return {
    name,
    module,
    description: "A fake tool for registry tests.",
    parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
    schema: z.object({ query: z.string().min(1) }),
    async run(_args, sharedBudget) {
      const allowed = Math.min(recordsReturned, sharedBudget.remainingRecords)
      sharedBudget.remainingRecords -= allowed
      return { summary: `${name} ran`, data: { count: allowed } }
    },
  }
}

const fakeFactories: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
  directory: () => [fakeTool("directory_fakeSearch", "directory", 3)],
  questCoral: () => [fakeTool("questCoral_fakeSearch", "questCoral", 3)],
  applications: () => [fakeTool("applications_fakeSearch", "applications", 3)],
}

test("public/unidentified access yields an empty tool list", () => {
  const access = resolveWhatsAppAccessPolicy(null)
  const tools = buildToolRegistry(access, fakeFactories)
  assert.equal(tools.size, 0)
})

test("internal access aggregates every enabled module's tools", () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const tools = buildToolRegistry(access, fakeFactories)
  assert.deepEqual(
    [...tools.keys()].sort(),
    ["applications_fakeSearch", "directory_fakeSearch", "questCoral_fakeSearch"].sort(),
  )
})

test("toolSpecs produces OpenAI-shaped function specs", () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const tools = buildToolRegistry(access, fakeFactories)
  const specs = toolSpecs(tools)
  assert.equal(specs.length, 3)
  assert.ok(specs.every((spec) => spec.type === "function" && typeof spec.function.name === "string"))
})

test("an unreviewed Messages/Communications-shaped tool name is still structurally rejected", () => {
  assert.throws(() => {
    assertOnlyAllowedMessagesTools([fakeTool("messages_search", "directory", 1)])
  }, /Messages\/Communications/)
  assert.throws(() => {
    assertOnlyAllowedMessagesTools([fakeTool("comms_summarize", "directory", 1)])
  })
  // A real module name must not accidentally match the guard.
  assert.doesNotThrow(() => {
    assertOnlyAllowedMessagesTools([fakeTool("directory_searchCompanies", "directory", 1)])
  })
})

test("the two reviewed Messages tools are explicitly allowed through the same guard", () => {
  assert.doesNotThrow(() => {
    assertOnlyAllowedMessagesTools([
      fakeTool("messages_searchOperationalHistory", "messages", 1),
      fakeTool("messages_searchMyCommunications", "messages", 1),
    ])
  })
})

test("the messages module is gated by canReadMessages, like every other per-module flag", () => {
  const internalAccess = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const publicAccess = resolveWhatsAppAccessPolicy(null)
  const factoriesWithMessages: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    messages: () => [fakeTool("messages_searchOperationalHistory", "messages", 1)],
  }

  assert.ok(buildToolRegistry(internalAccess, factoriesWithMessages).has("messages_searchOperationalHistory"))
  assert.equal(buildToolRegistry(publicAccess, factoriesWithMessages).size, 0)
})

test("the shared budget is decremented consistently across calls into different modules", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const tools = buildToolRegistry(access, fakeFactories)
  const sharedBudget = budget()

  await runSecretaryTool(tools, "directory_fakeSearch", { query: "a" }, sharedBudget)
  await runSecretaryTool(tools, "questCoral_fakeSearch", { query: "b" }, sharedBudget)
  await runSecretaryTool(tools, "applications_fakeSearch", { query: "c" }, sharedBudget)

  // 10 - 3 - 3 - 3 = 1, never allowed to go negative or ignore prior calls.
  assert.equal(sharedBudget.remainingRecords, 1)
})

test("runSecretaryTool returns a structured error for an unknown tool name instead of throwing", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const tools = buildToolRegistry(access, fakeFactories)
  const result = await runSecretaryTool(tools, "does_not_exist", {}, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /Unknown tool/)
})

test("runSecretaryTool returns a structured error for invalid arguments instead of throwing", async () => {
  const access = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const tools = buildToolRegistry(access, fakeFactories)
  const result = await runSecretaryTool(tools, "directory_fakeSearch", { query: 123 }, budget())
  assert.equal(result.empty, true)
  assert.match(result.summary, /Invalid arguments/)
})

test("the knowledge module is gated by companyKnowledgeScope, not a canRead* flag", () => {
  const internalAccess = resolveWhatsAppAccessPolicy(identifiedIdentity)
  const publicAccess = resolveWhatsAppAccessPolicy(null)
  const factoriesWithKnowledge: Partial<Record<SecretaryModule, SecretaryToolFactory>> = {
    knowledge: () => [fakeTool("knowledge_fakeSearch", "knowledge", 1)],
  }

  assert.ok(buildToolRegistry(internalAccess, factoriesWithKnowledge).has("knowledge_fakeSearch"))
  assert.equal(buildToolRegistry(publicAccess, factoriesWithKnowledge).size, 0)
})
