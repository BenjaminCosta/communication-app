"use client"

/**
 * SVC Applications — candidate file uploads (Firebase Storage).
 *
 * Documents are images/PDFs (compressed when they're images); the intro video
 * is large, so it uploads resumably with progress and can be retried. Storage
 * paths are scoped per application; the rules gate them to the candidate's
 * custom-token claim.
 */

import { getStorageLazy } from "@/lib/firebase"
import { compressImageFile } from "@/lib/image-upload"

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024

export interface StoredFile {
  storagePath: string
  downloadUrl: string
  fileName: string
}

/** Keep object names predictable and safe for Storage. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "file"
}

export function validateDocumentFile(file: File): string | null {
  const isImage = file.type.startsWith("image/")
  const isPdf = file.type === "application/pdf"
  if (!isImage && !isPdf) return "Upload a photo or a PDF."
  if (file.size > MAX_DOCUMENT_BYTES) return "Files must be 15 MB or smaller."
  return null
}

export function validateVideoFile(file: File): string | null {
  if (!file.type.startsWith("video/")) return "Choose a video file."
  if (file.size > MAX_VIDEO_BYTES) return "Videos must be 200 MB or smaller."
  return null
}

export async function uploadApplicationDocument(
  applicationId: string,
  documentId: string,
  file: File,
): Promise<StoredFile> {
  const payload = file.type.startsWith("image/") ? await compressImageFile(file) : file
  const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage")
  const storage = await getStorageLazy()
  const storagePath = `application-uploads/${applicationId}/documents/${documentId}-${safeName(payload.name)}`
  const storageRef = ref(storage, storagePath)
  await uploadBytes(storageRef, payload, { contentType: payload.type || "application/octet-stream" })
  const downloadUrl = await getDownloadURL(storageRef)
  return { storagePath, downloadUrl, fileName: file.name }
}

export async function uploadApplicationVideo(
  applicationId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<StoredFile> {
  const { ref, uploadBytesResumable, getDownloadURL } = await import("firebase/storage")
  const storage = await getStorageLazy()
  const storagePath = `application-uploads/${applicationId}/video/intro-${Date.now()}-${safeName(file.name)}`
  const storageRef = ref(storage, storagePath)
  const task = uploadBytesResumable(storageRef, file, { contentType: file.type || "video/mp4" })

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
        }
      },
      reject,
      () => resolve(),
    )
  })

  const downloadUrl = await getDownloadURL(storageRef)
  return { storagePath, downloadUrl, fileName: file.name }
}

/**
 * Older application records may have a Storage path but no persisted download
 * URL. Resolve one on demand for staff review so a valid upload is still
 * playable instead of being shown as an inert video card.
 */
export async function getApplicationDownloadUrl(storagePath: string): Promise<string> {
  const { ref, getDownloadURL } = await import("firebase/storage")
  const storage = await getStorageLazy()
  return getDownloadURL(ref(storage, storagePath))
}

export async function deleteApplicationFile(storagePath: string): Promise<void> {
  try {
    const { ref, deleteObject } = await import("firebase/storage")
    const storage = await getStorageLazy()
    await deleteObject(ref(storage, storagePath))
  } catch {
    // A missing object is fine — the metadata is what the UI reads.
  }
}

/** Reads a video's duration client-side so the dashboard can show its length. */
export function readVideoDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null)
    const video = document.createElement("video")
    video.preload = "metadata"
    const url = URL.createObjectURL(file)
    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? Math.round(video.duration) : null)
    video.onerror = () => done(null)
    video.src = url
  })
}
