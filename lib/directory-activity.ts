/**
 * SVC Directory — lightweight activity summary for the narrative "About".
 *
 * A one-shot, read-only count of an entity's notes and files (+ the most recent
 * timestamps) so the description can say "the latest note was added two days
 * ago" or "14 stored files" without opening the Notes/Files tabs. Uses the
 * Firestore Lite instance so it never touches Communications' realtime stream.
 */

import { collection, getDocs, query, where } from "firebase/firestore/lite"
import { directoryDb } from "@/lib/firebase"

export interface DirectoryActivitySummary {
  noteCount: number
  fileCount: number
  latestNoteAt: Date | null
  latestFileAt: Date | null
}

export const EMPTY_ACTIVITY: DirectoryActivitySummary = {
  noteCount: 0,
  fileCount: 0,
  latestNoteAt: null,
  latestFileAt: null,
}

function latestCreatedAt(docs: Array<{ data: () => Record<string, unknown> }>): Date | null {
  let latest: Date | null = null
  for (const doc of docs) {
    const raw = doc.data().createdAt as { toDate?: () => Date } | undefined
    const date = raw && typeof raw.toDate === "function" ? raw.toDate() : null
    if (date && (!latest || date > latest)) latest = date
  }
  return latest
}

export async function loadDirectoryActivitySummary(directoryId: string): Promise<DirectoryActivitySummary> {
  try {
    const [notes, files] = await Promise.all([
      getDocs(query(collection(directoryDb, "directoryNotes"), where("entityIds", "array-contains", directoryId))),
      getDocs(query(collection(directoryDb, "directoryFiles"), where("entityIds", "array-contains", directoryId))),
    ])
    return {
      noteCount: notes.size,
      fileCount: files.size,
      latestNoteAt: latestCreatedAt(notes.docs),
      latestFileAt: latestCreatedAt(files.docs),
    }
  } catch {
    return { ...EMPTY_ACTIVITY }
  }
}
