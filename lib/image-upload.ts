export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 1600
export const IMAGE_COMPRESSION_QUALITY = 0.78

export function validateImageFile(file: File | null): string | null {
  if (!file) return "Choose an image to attach."
  if (!file.type.startsWith("image/")) return "Only image files can be attached."
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return "Images must be 5 MB or smaller."
  return null
}

export async function compressImageFile(file: File): Promise<File> {
  if (file.type === "image/gif" || typeof window === "undefined") return file

  const image = await loadImage(file)
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  if (scale === 1 && file.size <= 600 * 1024) {
    image.close?.()
    return file
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) {
    image.close?.()
    return file
  }

  context.drawImage(image.source, 0, 0, width, height)
  image.close?.()

  const preferredType = file.type === "image/png" ? "image/webp" : (file.type || "image/jpeg")
  const blob = await canvasToBlob(canvas, preferredType, IMAGE_COMPRESSION_QUALITY)
    ?? await canvasToBlob(canvas, "image/jpeg", IMAGE_COMPRESSION_QUALITY)

  if (!blob || blob.size >= file.size) return file

  return new File([blob], withImageExtension(file.name, blob.type), {
    type: blob.type,
    lastModified: Date.now(),
  })
}

interface LoadedImage {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

async function loadImage(file: File): Promise<LoadedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Could not read image."))
    }
    img.src = url
  })

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function withImageExtension(name: string, contentType: string): string {
  const extension = contentType === "image/webp" ? "webp" : contentType === "image/png" ? "png" : "jpg"
  const baseName = name.replace(/\.[^.]+$/, "") || "image"
  return `${baseName}.${extension}`
}
