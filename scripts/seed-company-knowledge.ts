#!/usr/bin/env tsx
import { FieldValue, getFirestore } from "firebase-admin/firestore"
import { getFirebaseAdminApp } from "@/lib/ai/server/firebase-admin"
import { INITIAL_COMPANY_KNOWLEDGE } from "@/lib/company-knowledge"

const COLLECTION = "companyKnowledge"

async function main(): Promise<void> {
  if (process.env.CONFIRM_COMPANY_KNOWLEDGE_SEED !== "true") {
    throw new Error("Set CONFIRM_COMPANY_KNOWLEDGE_SEED=true to create the initial curated company knowledge entries.")
  }

  const db = getFirestore(await getFirebaseAdminApp())
  const existing = await Promise.all(INITIAL_COMPANY_KNOWLEDGE.map((entry) => db.collection(COLLECTION).doc(entry.id).get()))
  const batch = db.batch()
  let created = 0
  let preserved = 0

  for (const [index, entry] of INITIAL_COMPANY_KNOWLEDGE.entries()) {
    if (existing[index].exists) {
      preserved += 1
      continue
    }

    batch.set(db.collection(COLLECTION).doc(entry.id), {
      ...entry,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    created += 1
  }

  if (created > 0) {
    await batch.commit()
  }

  console.info(`Company knowledge seed complete: ${created} created, ${preserved} preserved.`)
}

main().catch((error) => {
  console.error("Company knowledge seed failed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
