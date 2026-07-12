/**
 * SVC Directory — Files.
 *
 * Files are a SEPARATE collection linked to entities by composite id in
 * `entityIds` — never stored as a giant array inside a contact/context. Each
 * doc records the Storage path + a public download URL plus light metadata.
 * `category` is reserved for later (photo/report/issue/plan/safety/…); V1
 * only writes "general".
 *
 * Global-readable, owner-scoped writes. The binary lives in Firebase Storage
 * under the uploader's already-permitted `message-images/{uid}/…` prefix so no
 * Storage-rule change is needed; the stored token URL is what makes the file
 * globally viewable regardless of Storage read rules.
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
  where,
  type Query,
  type Unsubscribe,
} from "firebase/firestore"
import { db, getStorageLazy } from "@/lib/firebase"

/** V1 always writes "general"; the rest are reserved for later phases. */
export type DirectoryFileCategory =
  | "general"
  | "photo"
  | "report"
  | "issue"
  | "plan"
  | "safety"
  | "profile"

export interface DirectoryFile {
  id: string
  entityIds: string[]
  storagePath: string
  downloadUrl: string
  fileName: string
  mimeType: string
  size: number
  category: DirectoryFileCategory
  caption: string
  uploadedBy: string
  createdAt: Date | null
}

export const MAX_DIRECTORY_FILE_BYTES = 15 * 1024 * 1024 // 15 MB

const FILES = "directoryFiles"

function toDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}

function mapFile(id: string, data: Record<string, unknown>): DirectoryFile {
  return {
    id,
    entityIds: Array.isArray(data.entityIds) ? data.entityIds.filter((v): v is string => typeof v === "string") : [],
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    downloadUrl: typeof data.downloadUrl === "string" ? data.downloadUrl : "",
    fileName: typeof data.fileName === "string" ? data.fileName : "file",
    mimeType: typeof data.mimeType === "string" ? data.mimeType : "application/octet-stream",
    size: typeof data.size === "number" ? data.size : 0,
    category: (typeof data.category === "string" ? data.category : "general") as DirectoryFileCategory,
    caption: typeof data.caption === "string" ? data.caption : "",
    uploadedBy: typeof data.uploadedBy === "string" ? data.uploadedBy : "",
    createdAt: toDate(data.createdAt),
  }
}

function primeFromServer(target: Query): void {
  getDocsFromServer(target).catch(() => {})
}

export function isImageFile(file: Pick<DirectoryFile, "mimeType">): boolean {
  return file.mimeType.startsWith("image/")
}

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120) || "file"
}

/** Live files for one entity, newest first (sorted client-side — no composite index). */
export function subscribeDirectoryFiles(
  directoryId: string,
  onChange: (files: DirectoryFile[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const filesQuery = query(collection(db, FILES), where("entityIds", "array-contains", directoryId))
  primeFromServer(filesQuery)
  return onSnapshot(
    filesQuery,
    (snapshot) => {
      const files = snapshot.docs
        .map((entry) => mapFile(entry.id, entry.data()))
        .sort((a, b) => (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER))
      onChange(files)
    },
    (error) => onError?.(error),
  )
}

export interface UploadFileOptions {
  category?: DirectoryFileCategory
  caption?: string
  additionalEntityIds?: string[]
}

export async function uploadDirectoryFile(
  userId: string,
  directoryId: string,
  file: File,
  options: UploadFileOptions = {},
): Promise<void> {
  if (file.size > MAX_DIRECTORY_FILE_BYTES) {
    throw new Error(`File is too large (max ${Math.round(MAX_DIRECTORY_FILE_BYTES / (1024 * 1024))} MB).`)
  }
  let payload: File = file
  // Compress images the same way message images are handled.
  if (file.type.startsWith("image/")) {
    try {
      const { compressImageFile } = await import("@/lib/image-upload")
      payload = await compressImageFile(file)
    } catch {
      payload = file
    }
  }

  const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage")
  const storage = await getStorageLazy()
  const safeName = sanitizeStorageName(payload.name || file.name)
  const storagePath = `message-images/${userId}/directory-files/${Date.now()}-${safeName}`
  const storageRef = ref(storage, storagePath)
  const contentType = payload.type || file.type || "application/octet-stream"
  await uploadBytes(storageRef, payload, { contentType })
  const downloadUrl = await getDownloadURL(storageRef)

  const entityIds = [...new Set([directoryId, ...(options.additionalEntityIds ?? [])])].filter(Boolean)
  await addDoc(collection(db, FILES), {
    entityIds,
    storagePath,
    downloadUrl,
    fileName: file.name,
    mimeType: contentType,
    size: payload.size,
    category: options.category ?? "general",
    caption: options.caption ?? "",
    uploadedBy: userId,
    createdAt: serverTimestamp(),
  })
}

export async function deleteDirectoryFile(file: DirectoryFile): Promise<void> {
  // Delete the Firestore doc first (owner-scoped rule); best-effort remove the blob.
  await deleteDoc(doc(db, FILES, file.id))
  if (file.storagePath) {
    try {
      const { ref, deleteObject } = await import("firebase/storage")
      const storage = await getStorageLazy()
      await deleteObject(ref(storage, file.storagePath))
    } catch {
      // Blob may already be gone or rules may forbid delete — the doc is what the UI reads.
    }
  }
}
