export async function shareOrDownloadOutlookPdf(file: File, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      const canShare = !navigator.canShare || navigator.canShare({ files: [file] })
      if (canShare) {
        await navigator.share({ title, files: [file] })
        return "shared"
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
    }
  }
  const url = URL.createObjectURL(file)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return "downloaded"
}
