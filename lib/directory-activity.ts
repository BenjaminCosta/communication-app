/**
 * SVC Directory — lightweight activity summary for the narrative "About".
 *
 * A one-shot, read-only count of an entity's notes and files (+ the most recent
 * timestamps) so the description can say "the latest note was added two days
 * ago" or "14 stored files" without opening the Notes/Files tabs. Uses the
 * Aggregate and bounded one-shot queries avoid collection scans and do not add
 * realtime listeners to Communications.
 */

import { collection, getCountFromServer, getDocs, limit, orderBy, query, where } from "firebase/firestore"
import { db } from "@/lib/firebase"

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

function createdAtOf(document: { data: () => Record<string, unknown> } | undefined): Date | null {
  const raw = document?.data().createdAt as { toDate?: () => Date } | undefined
  return raw && typeof raw.toDate === "function" ? raw.toDate() : null
}

export async function loadDirectoryActivitySummary(directoryId: string): Promise<DirectoryActivitySummary> {
  try {
    const notesQuery = query(collection(db, "directoryNotes"), where("entityIds", "array-contains", directoryId))
    const filesQuery = query(collection(db, "directoryFiles"), where("entityIds", "array-contains", directoryId))
    const [noteCount, fileCount, latestNote, latestFile] = await Promise.all([
      getCountFromServer(notesQuery),
      getCountFromServer(filesQuery),
      getDocs(query(notesQuery, orderBy("createdAt", "desc"), limit(1))),
      getDocs(query(filesQuery, orderBy("createdAt", "desc"), limit(1))),
    ])
    return {
      noteCount: noteCount.data().count,
      fileCount: fileCount.data().count,
      latestNoteAt: createdAtOf(latestNote.docs[0]),
      latestFileAt: createdAtOf(latestFile.docs[0]),
    }
  } catch {
    return { ...EMPTY_ACTIVITY }
  }
}
