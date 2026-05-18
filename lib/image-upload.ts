export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024

export function validateImageFile(file: File | null): string | null {
  if (!file) return "Choose an image to attach."
  if (!file.type.startsWith("image/")) return "Only image files can be attached."
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return "Images must be 5 MB or smaller."
  return null
}
