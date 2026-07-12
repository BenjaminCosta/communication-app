/**
 * SVC Directory — Notes.
 *
 * Notes are a SEPARATE, flexible collection (not a text field on the entity),
 * linked to one or more entities by composite id in `entityIds`. This is what
 * lets a plain "general" note evolve later into field updates, issues, daily
 * reports or follow-ups without re-architecting anything — only `noteType`
 * changes. The UI only surfaces "general" for now.
 *
 * Global-readable (any authenticated user), owner-scoped writes — same posture
 * as /contacts. Reads use the realtime `db` so a new note appears immediately;
 * a one-shot server prime guards against stale on-device cache (iOS PWA).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Query,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"

/** V1 always writes "general"; the rest are reserved for later phases. */
export type DirectoryNoteType =
  | "general"
  | "field_update"
  | "issue"
  | "daily_report"
  | "follow_up"
  | "status_update"

export interface DirectoryNote {
  id: string
  entityIds: string[]
  text: string
  noteType: DirectoryNoteType
  attachments: string[]
  createdBy: string
  createdAt: Date | null
  updatedAt: Date | null
}

const NOTES = "directoryNotes"

function toDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

function mapNote(id: string, data: Record<string, unknown>): DirectoryNote {
  return {
    id,
    entityIds: Array.isArray(data.entityIds) ? data.entityIds.filter((v): v is string => typeof v === "string") : [],
    text: typeof data.text === "string" ? data.text : "",
    noteType: (typeof data.noteType === "string" ? data.noteType : "general") as DirectoryNoteType,
    attachments: Array.isArray(data.attachments) ? data.attachments.filter((v): v is string => typeof v === "string") : [],
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function primeFromServer(target: Query): void {
  getDocsFromServer(target).catch(() => {})
}

/** Live notes for one entity, newest first (sorted client-side — no composite index). */
export function subscribeDirectoryNotes(
  directoryId: string,
  onChange: (notes: DirectoryNote[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const notesQuery = query(collection(db, NOTES), where("entityIds", "array-contains", directoryId))
  primeFromServer(notesQuery)
  return onSnapshot(
    notesQuery,
    (snapshot) => {
      const notes = snapshot.docs
        .map((entry) => mapNote(entry.id, entry.data()))
        .sort((a, b) => (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER))
      onChange(notes)
    },
    (error) => onError?.(error),
  )
}

export interface AddNoteOptions {
  noteType?: DirectoryNoteType
  attachments?: string[]
  /** Extra entities to link this note to (mentions/relations). */
  additionalEntityIds?: string[]
}

export async function addDirectoryNote(
  userId: string,
  directoryId: string,
  text: string,
  options: AddNoteOptions = {},
): Promise<void> {
  const clean = text.trim()
  if (!clean) throw new Error("Note text is required.")
  const entityIds = [...new Set([directoryId, ...(options.additionalEntityIds ?? [])])].filter(Boolean)
  await addDoc(collection(db, NOTES), {
    entityIds,
    text: clean,
    noteType: options.noteType ?? "general",
    attachments: options.attachments ?? [],
    createdBy: userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateDirectoryNote(noteId: string, text: string): Promise<void> {
  const clean = text.trim()
  if (!clean) throw new Error("Note text is required.")
  await updateDoc(doc(db, NOTES, noteId), { text: clean, updatedAt: serverTimestamp() })
}

export async function deleteDirectoryNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, NOTES, noteId))
}
