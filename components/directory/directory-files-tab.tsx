"use client"

import { useEffect, useRef, useState } from "react"
import { FileText, Paperclip, Trash2, Upload } from "lucide-react"
import {
  deleteDirectoryFile,
  isImageFile,
  loadDirectoryFilesPage,
  subscribeDirectoryFiles,
  uploadDirectoryFile,
  type DirectoryFile,
} from "@/lib/directory-files"

interface DirectoryFilesTabProps {
  directoryId: string
  userId: string
  autoOpen?: boolean
}

function formatSize(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DirectoryFilesTab({ directoryId, userId, autoOpen }: DirectoryFilesTabProps) {
  const [files, setFiles] = useState<DirectoryFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState("")
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setIsLoading(true)
    setFiles([])
    setHasMore(false)
    const unsubscribe = subscribeDirectoryFiles(
      directoryId,
      (next) => {
        setFiles((current) => {
          const firstPage = new Set(next.map((file) => file.id))
          return [...next, ...current.filter((file) => !firstPage.has(file.id))]
        })
        setHasMore(next.length === 50)
        setIsLoading(false)
      },
      () => setIsLoading(false),
    )
    return unsubscribe
  }, [directoryId])

  useEffect(() => {
    if (autoOpen) requestAnimationFrame(() => inputRef.current?.click())
  }, [autoOpen])

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // allow re-selecting the same file
    if (!file) return
    setIsUploading(true)
    setError("")
    try {
      await uploadDirectoryFile(userId, directoryId, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.")
    } finally {
      setIsUploading(false)
    }
  }

  const remove = async (file: DirectoryFile) => {
    try {
      await deleteDirectoryFile(file)
    } catch {
      setError("File could not be deleted.")
    } finally {
      setConfirmingDelete(null)
    }
  }

  const loadMore = async () => {
    const last = files.at(-1)
    if (!last?.createdAt || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const page = await loadDirectoryFilesPage(directoryId, { id: last.id, createdAt: last.createdAt })
      setFiles((current) => {
        const ids = new Set(current.map((file) => file.id))
        return [...current, ...page.items.filter((file) => !ids.has(file.id))]
      })
      setHasMore(page.hasMore)
    } catch {
      setError("Older files could not be loaded.")
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] py-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/[0.04] disabled:opacity-50 active:scale-[0.99]"
      >
        <Upload className="h-4 w-4" strokeWidth={1.8} />
        {isUploading ? "Uploading…" : "Upload file or photo"}
      </button>

      {error && <p className="mt-3 text-xs text-orange-200/80" role="alert">{error}</p>}

      <div className="mt-5">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/[0.04]" />)}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
              <Paperclip className="h-5 w-5 text-[var(--directory-title)]/70" strokeWidth={1.7} />
            </div>
            <p className="text-sm font-medium text-foreground/80">No files yet</p>
            <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground/60">Attach photos, PDFs and documents — they stay linked to this entity.</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {files.map((file) => {
              const isOwn = file.uploadedBy === userId
              return (
                <div key={file.id} className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
                  <a href={file.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                    {isImageFile(file) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.downloadUrl} alt={file.caption || file.fileName} className="aspect-square w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 px-3 text-center">
                        <FileText className="h-7 w-7 text-muted-foreground/60" strokeWidth={1.6} />
                        <span className="line-clamp-2 break-all text-[11px] leading-4 text-muted-foreground/70">{file.fileName}</span>
                      </div>
                    )}
                  </a>
                  <div className="flex items-center justify-between gap-1 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/55">{formatSize(file.size)}</span>
                    {isOwn && (
                      confirmingDelete === file.id ? (
                        <button type="button" onClick={() => remove(file)} className="text-[10px] font-semibold text-red-300/90">Delete</button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(file.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/40 hover:bg-white/[0.06] hover:text-red-300/80"
                          aria-label="Delete file"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              )
            })}
            </div>
            {hasMore && (
              <button type="button" onClick={loadMore} disabled={isLoadingMore} className="glass-button mt-4 w-full rounded-xl border px-4 py-2.5 text-xs text-muted-foreground disabled:opacity-50">
                {isLoadingMore ? "Loading files…" : "Load 50 more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
