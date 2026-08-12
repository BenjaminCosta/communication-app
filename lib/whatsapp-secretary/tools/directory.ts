import { DIRECTORY_TOOLS, runDirectoryTool } from "@/features/directory/ai/server/tools/definitions"
import { createServerDirectoryProvider } from "@/features/directory/ai/server/tools/provider"
import type { DirectoryDataProvider, DirectoryTool } from "@/features/directory/ai/server/tools/types"
import type { DirectoryAskRecord } from "@/features/directory/ai/directory-ask-contract"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import type { SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"

/**
 * Directory adapter — pure reuse of the "Ask SVC Directory" tool stack, plus
 * WhatsApp-only contact-detail enrichment (phone/email) for person records.
 *
 * `searchRelevantNotes` stays excluded: Messages and free-text notes are not
 * part of the WhatsApp scope (matches the old `lib/whatsapp-directory.ts`
 * whitelist). Directory's own `extractEntities`/`buildQueryPlan` deterministic
 * prefetch optimizer is deliberately NOT reused here — that machinery exists
 * to save a model round-trip for Directory's single-domain ask endpoint; in
 * the cross-module orchestrator the model itself extracts names/ids as tool
 * arguments when it chooses to call `directory_searchPeople` etc., exactly as
 * it already does today for every other Directory tool call.
 *
 * Phone/email enrichment: the shared `DirectoryAskRecord` shape used by the
 * web app's "Ask SVC Directory" assistant deliberately has no phone/email
 * field. That's the right default for a broadly-shared component, but every
 * sender who can reach ANY tool in this file is, by construction, already a
 * uniquely identified internal SVC user (`buildToolRegistry` only registers
 * Directory tools when `canReadDirectory` is true, which requires an
 * identified sender) — a verified colleague coordinating with another SVC
 * person, not an outside party. So for person records, this adapter does one
 * extra bounded `/contacts` read per result and attaches `phone`/`email` when
 * the contact has them on file, and the system prompt explicitly allows
 * relaying them.
 */

const EXCLUDED_DIRECTORY_TOOLS = new Set(["searchRelevantNotes"])

type RecordValue = Record<string, unknown>

export interface DirectoryContactDetails {
  phone: string | null
  email: string | null
}

/** Test seam: swap for a fixture in offline tests instead of hitting Firestore. */
export type DirectoryContactDetailsProvider = (sourceIds: string[]) => Promise<Map<string, DirectoryContactDetails>>

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : []
}

/** First non-empty `.value` from an `ImportedContactPoint[]`-shaped array. */
function firstPointValue(value: unknown): string {
  if (!Array.isArray(value)) return ""
  for (const entry of value) {
    const point = asRecord(entry)
    const pointValue = asString(point?.value)
    if (pointValue) return pointValue
  }
  return ""
}

/** Mirrors the precedence `buildPersonProfileViewModel()` uses for display: human-edited masterData first, then the imported doc's own fields. */
function extractContactDetails(data: RecordValue): DirectoryContactDetails {
  const masterData = asRecord(data.masterData)
  const phone = asString(masterData?.primaryPhone) || asStringArray(masterData?.phones)[0] || asString(data.phone) || firstPointValue(data.phones)
  const email = asString(masterData?.primaryEmail) || asStringArray(masterData?.emails)[0] || asString(data.email) || firstPointValue(data.emails)
  return { phone: phone || null, email: email || null }
}

function createServerContactDetailsProvider(): DirectoryContactDetailsProvider {
  return async (sourceIds) => {
    const result = new Map<string, DirectoryContactDetails>()
    if (sourceIds.length === 0) return result
    const { getFirestore } = await import("firebase-admin/firestore")
    const db = getFirestore(await getFirebaseAdminApp())
    const snapshots = await db.getAll(...sourceIds.map((id) => db.collection("contacts").doc(id)))
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue
      result.set(snapshot.id, extractContactDetails(snapshot.data() as RecordValue))
    }
    return result
  }
}

/** Attaches `phone`/`email` to person records that have them on file. Non-person records pass through unchanged. */
async function enrichPersonRecords(
  records: DirectoryAskRecord[],
  provider: DirectoryDataProvider,
  getContactDetails: DirectoryContactDetailsProvider,
): Promise<Array<DirectoryAskRecord & { phone?: string; email?: string }>> {
  const personRecords = records.filter((record) => record.type === "person")
  if (personRecords.length === 0) return records

  const indexRecords = await Promise.all(personRecords.map((record) => provider.getEntity(record.id)))
  const sourceIdByDirectoryId = new Map<string, string>()
  indexRecords.forEach((indexRecord, i) => {
    if (indexRecord && indexRecord.sourceCollection === "contacts") {
      sourceIdByDirectoryId.set(personRecords[i]!.id, indexRecord.sourceId)
    }
  })
  if (sourceIdByDirectoryId.size === 0) return records

  const detailsBySourceId = await getContactDetails([...new Set(sourceIdByDirectoryId.values())])
  return records.map((record) => {
    const sourceId = sourceIdByDirectoryId.get(record.id)
    const details = sourceId ? detailsBySourceId.get(sourceId) : undefined
    if (!details) return record
    return {
      ...record,
      ...(details.phone ? { phone: details.phone } : {}),
      ...(details.email ? { email: details.email } : {}),
    }
  })
}

export function createDirectoryTools(
  deps: { provider?: DirectoryDataProvider; contactDetailsProvider?: DirectoryContactDetailsProvider } = {},
): SecretaryTool[] {
  const provider = deps.provider ?? createServerDirectoryProvider()
  const getContactDetails = deps.contactDetailsProvider ?? createServerContactDetailsProvider()

  return DIRECTORY_TOOLS.filter((tool) => !EXCLUDED_DIRECTORY_TOOLS.has(tool.name)).map(
    (tool: DirectoryTool<never>): SecretaryTool => ({
      name: `directory_${tool.name}`,
      module: "directory",
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
      async run(args, budget): Promise<SecretaryToolResult> {
        const result = await runDirectoryTool(tool.name, args, provider, budget)
        const records = result.records ? await enrichPersonRecords(result.records, provider, getContactDetails) : undefined
        return {
          summary: result.summary,
          empty: result.empty,
          data: {
            ...(records ? { records } : {}),
            ...(result.paths ? { paths: result.paths } : {}),
            ...(result.counts ? { counts: result.counts } : {}),
          },
        }
      },
    }),
  )
}
