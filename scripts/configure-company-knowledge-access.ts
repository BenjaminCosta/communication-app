#!/usr/bin/env tsx
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { INITIAL_COMPANY_KNOWLEDGE } from "@/lib/company-knowledge"

const COLLECTION = "companyKnowledge"

/**
 * Explicitly classifies the curated bootstrap entries. Existing unclassified
 * entries are treated as internal by the runtime, so this only grants public
 * access to the intentionally safe overview entry.
 */
async function main(): Promise<void> {
  if (process.env.CONFIRM_COMPANY_KNOWLEDGE_ACCESS_SCOPES !== "true") {
    throw new Error("Set CONFIRM_COMPANY_KNOWLEDGE_ACCESS_SCOPES=true to apply curated company-knowledge access scopes.")
  }

  const db = getFirestore(await getFirebaseAdminApp())
  const existing = await Promise.all(INITIAL_COMPANY_KNOWLEDGE.map((entry) => db.collection(COLLECTION).doc(entry.id).get()))
  const batch = db.batch()
  let updated = 0
  let missing = 0

  for (const [index, entry] of INITIAL_COMPANY_KNOWLEDGE.entries()) {
    const document = existing[index]
    if (!document.exists) {
      missing += 1
      continue
    }

    if (document.get("accessScope") === entry.accessScope) continue
    batch.set(document.ref, {
      accessScope: entry.accessScope,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    updated += 1
  }

  if (updated > 0) await batch.commit()
  console.info(`Company knowledge access scopes complete: ${updated} updated, ${missing} missing.`)
}

main().catch((error) => {
  console.error("Company knowledge access-scope setup failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
