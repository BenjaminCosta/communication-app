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

/**
 * Shares the already-published PDF instead of regenerating it. Browsers that
 * support file sharing receive the PDF itself; otherwise we share or open its
 * stable Directory link.
 */
export async function shareOrOpenOutlookPdf(
  artifact: { downloadUrl: string; fileName: string },
  title: string,
): Promise<"shared" | "downloaded" | "opened" | "cancelled"> {
  try {
    const response = await fetch(artifact.downloadUrl)
    if (!response.ok) throw new Error("Could not load PDF")
    const file = new File([await response.blob()], artifact.fileName, { type: "application/pdf" })
    return await shareOrDownloadOutlookPdf(file, title)
  } catch {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url: artifact.downloadUrl })
        return "shared"
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
      }
    }
    window.open(artifact.downloadUrl, "_blank", "noopener,noreferrer")
    return "opened"
  }
}
