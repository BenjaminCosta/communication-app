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
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { subscribeWithServerReconcile } from "@/lib/firestore-reconcile"

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

export interface DirectoryNotesPage {
  items: DirectoryNote[]
  hasMore: boolean
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

const NOTES_PAGE_SIZE = 50

function notesQueryFor(directoryId: string) {
  return query(
    collection(db, NOTES),
    where("entityIds", "array-contains", directoryId),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
  )
}

/** Live first page for one entity; older pages are fetched on demand. */
export function subscribeDirectoryNotes(
  directoryId: string,
  onChange: (notes: DirectoryNote[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const notesQuery = query(notesQueryFor(directoryId), limit(NOTES_PAGE_SIZE))
  return subscribeWithServerReconcile(
    notesQuery,
    (snapshot) => {
      onChange(snapshot.docs.map((entry) => mapNote(entry.id, entry.data())))
    },
    (error) => onError?.(error),
  )
}

export async function loadDirectoryNotesPage(
  directoryId: string,
  cursor: { createdAt: Date; id: string },
): Promise<DirectoryNotesPage> {
  const snapshot = await getDocs(query(
    notesQueryFor(directoryId),
    startAfter(Timestamp.fromDate(cursor.createdAt), cursor.id),
    limit(NOTES_PAGE_SIZE),
  ))
  return {
    items: snapshot.docs.map((entry) => mapNote(entry.id, entry.data())),
    hasMore: snapshot.size === NOTES_PAGE_SIZE,
  }
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
