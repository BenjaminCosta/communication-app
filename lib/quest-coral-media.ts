"use client"

/**
 * Uploads for a Quest Coral activity. The activity stores only stable
 * Firebase Storage links and light metadata, so its feed can present media
 * exactly like a Feedback reply without turning the activity into a preview
 * surface.
 */

import { getStorageLazy } from "@/lib/firebase"
import type { ProjectUpdateAttachment, ProjectUpdateImage } from "@/lib/quest-coral-core"

export const MAX_QUEST_CORAL_ATTACHMENT_BYTES = 15 * 1024 * 1024
export const QUEST_CORAL_ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".txt",
  ".csv",
  ".zip",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
].join(",")

export type QuestCoralUpdateMedia = {
  image?: ProjectUpdateImage
  attachment?: ProjectUpdateAttachment
}

const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match ? match[1].toLowerCase() : ""
}

function resolvedContentType(file: File): string | null {
  const supplied = file.type.trim().toLowerCase()
  if (supplied.startsWith("image/")) return supplied
  if (Object.values(DOCUMENT_CONTENT_TYPES).includes(supplied)) return supplied
  return DOCUMENT_CONTENT_TYPES[extensionOf(file.name)] ?? null
}

function isImageContentType(contentType: string): boolean {
  return contentType.startsWith("image/")
}

function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120) || "attachment"
}

function uploadSuffix(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12)
}

export function validateQuestCoralAttachment(file: File | null): string | null {
  if (!file) return "Choose a file to attach."
  if (file.size <= 0) return "This file is empty."
  if (file.size > MAX_QUEST_CORAL_ATTACHMENT_BYTES) return "Attachments must be 15 MB or smaller."
  if (!resolvedContentType(file)) {
    return "Use an image, PDF, text, CSV, ZIP, Word, Excel or PowerPoint file."
  }
  return null
}

function mediaFor(url: string, path: string, file: File, contentType: string, size: number): QuestCoralUpdateMedia {
  const details = { url, path, name: file.name || "attachment", contentType, size }
  return isImageContentType(contentType) ? { image: details } : { attachment: details }
}

/** Stores one activity attachment under the authenticated uploader's prefix. */
export async function uploadQuestCoralAttachment(userId: string, file: File): Promise<QuestCoralUpdateMedia> {
  const validationError = validateQuestCoralAttachment(file)
  if (validationError) throw new Error(validationError)
  const contentType = resolvedContentType(file)
  if (!contentType) throw new Error("This file type is not supported.")

  let payload = file
  if (isImageContentType(contentType)) {
    try {
      const { compressImageFile } = await import("@/lib/image-upload")
      payload = await compressImageFile(file)
    } catch {
      // A readable original is always preferable to rejecting a valid image
      // just because browser-side compression is unavailable.
      payload = file
    }
  }

  const finalContentType = resolvedContentType(payload) ?? contentType
  const { ref, uploadBytes, getDownloadURL } = await import("firebase/storage")
  const storage = await getStorageLazy()
  const path = `quest-coral-updates/${userId}/${Date.now()}-${uploadSuffix()}-${sanitizeStorageName(payload.name || file.name)}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, payload, { contentType: finalContentType })
  const url = await getDownloadURL(storageRef)
  return mediaFor(url, path, file, finalContentType, payload.size)
}

/** Local mock mode still renders the same compact link without writing Storage. */
export function mockQuestCoralAttachment(file: File): QuestCoralUpdateMedia {
  const validationError = validateQuestCoralAttachment(file)
  if (validationError) throw new Error(validationError)
  const contentType = resolvedContentType(file)
  if (!contentType) throw new Error("This file type is not supported.")
  return mediaFor(URL.createObjectURL(file), "", file, contentType, file.size)
}
