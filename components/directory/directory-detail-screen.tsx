"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, AlertCircle, Mail, MapPin, Phone, Star } from "lucide-react"
import { doc, getDoc, type DocumentData } from "firebase/firestore/lite"
import { DirectoryEntityIcon } from "@/components/directory/directory-entity-icon"
import { DirectoryRowsSkeleton } from "@/components/directory/directory-states"
import { directoryDb } from "@/lib/firebase"
import { cn } from "@/lib/utils"
import { isDirectoryEntityType, type DirectoryListItem } from "@/lib/directory-config"
import { recordDirectoryRecent, setDirectoryFavorite, subscribeDirectoryFavorites } from "@/lib/directory-user-state"

interface DirectoryDetailScreenProps {
  directoryId: string
  userId: string
  onBack: () => void
  className?: string
}

interface DetailRecord extends DirectoryListItem {
  sourceCollection: "contacts" | "contexts"
  sourceId: string
  email: string
  phone: string
}

interface DetailState {
  record: DetailRecord
  source: DocumentData
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function pointValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const candidate = text((entry as Record<string, unknown>).value) || text((entry as Record<string, unknown>).formatted)
    return candidate ? [candidate] : []
  })
}

function sourceFieldValues(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const raw = entry as Record<string, unknown>
    const label = text(raw.label)
    const fieldValue = text(raw.value)
    return label && fieldValue ? [{ label, value: fieldValue }] : []
  })
}

function DetailLine({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-white/[0.06] py-3 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.035] text-muted-foreground/70">
        {icon ?? <span className="text-[10px] font-semibold uppercase">{label.slice(0, 2)}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/45">{label}</p>
        <p className="mt-0.5 break-words text-sm leading-5 text-foreground/85">{value}</p>
      </div>
    </div>
  )
}

export function DirectoryDetailScreen({ directoryId, userId, onBack, className }: DirectoryDetailScreenProps) {
  const [detail, setDetail] = useState<DetailState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [favoritePending, setFavoritePending] = useState(false)
  const [favoriteError, setFavoriteError] = useState("")

  useEffect(() => subscribeDirectoryFavorites(userId, setFavoriteIds), [userId])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(false)
    getDoc(doc(directoryDb, "directoryIndex", directoryId))
      .then(async (snapshot) => {
        if (!snapshot.exists()) throw new Error("Directory entry not found")
        const data = snapshot.data()
        if (!isDirectoryEntityType(data.type)) throw new Error("Unsupported Directory entry")
        const sourceCollection = data.sourceCollection === "contacts" ? "contacts" : "contexts"
        const sourceId = text(data.sourceId)
        const sourceSnapshot = sourceId ? await getDoc(doc(directoryDb, sourceCollection, sourceId)) : null
        const record: DetailRecord = {
          id: snapshot.id,
          type: data.type,
          name: text(data.name),
          subtitle: text(data.subtitle),
          companyName: text(data.companyName),
          location: text(data.location),
          role: text(data.role),
          sourceCollection,
          sourceId,
          email: text(data.email),
          phone: text(data.phone),
        }
        if (active) setDetail({ record, source: sourceSnapshot?.data() ?? {} })
      })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setIsLoading(false) })
    recordDirectoryRecent(userId, directoryId).catch(() => {})
    return () => { active = false }
  }, [directoryId, userId])

  const isFavorite = favoriteIds.includes(directoryId)
  const fields = useMemo(() => {
    if (!detail) return []
    const { record, source } = detail
    if (record.type === "person") {
      const emails = [...new Set([record.email, text(source.email), ...pointValues(source.emails)].filter(Boolean))]
      const phones = [...new Set([record.phone, text(source.phone), ...pointValues(source.phones)].filter(Boolean))]
      const addresses = pointValues(source.addresses)
      const urls = pointValues(source.urls)
      return [
        ...emails.map((value) => ({ label: "Email", value, icon: <Mail key="mail" className="h-4 w-4" strokeWidth={1.8} /> })),
        ...phones.map((value) => ({ label: "Phone", value, icon: <Phone key="phone" className="h-4 w-4" strokeWidth={1.8} /> })),
        ...addresses.map((value) => ({ label: "Address", value, icon: <MapPin key="address" className="h-4 w-4" strokeWidth={1.8} /> })),
        ...urls.map((value) => ({ label: "Website", value })),
        ...(text(source.notes) ? [{ label: "Notes", value: text(source.notes) }] : []),
      ]
    }
    return [
      ...(text(source.description) ? [{ label: "Description", value: text(source.description) }] : []),
      ...sourceFieldValues(source.fields).map((field) => ({ ...field })),
    ]
  }, [detail])

  const toggleFavorite = async () => {
    if (favoritePending) return
    const next = !isFavorite
    setFavoritePending(true)
    setFavoriteError("")
    setFavoriteIds((current) => next ? [directoryId, ...current] : current.filter((id) => id !== directoryId))
    try {
      await setDirectoryFavorite(userId, directoryId, next)
    } catch {
      setFavoriteIds((current) => next ? current.filter((id) => id !== directoryId) : [directoryId, ...current])
      setFavoriteError("Favorite could not be updated. Try again.")
    } finally {
      setFavoritePending(false)
    }
  }

  return (
    <div className={cn("directory-glass-screen flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4 animate-slide-down">
        <button type="button" onClick={onBack} className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]" aria-label="Back to Directory">
          <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={toggleFavorite}
          disabled={favoritePending || isLoading || error}
          className={cn(
            "glass-button flex h-9 w-9 items-center justify-center rounded-full border transition-[color,transform] active:scale-[0.96] disabled:opacity-40",
            isFavorite && "text-[var(--directory-title)]",
          )}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFavorite}
        >
          <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} strokeWidth={1.8} />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 md:px-6 md:pt-12">
          {isLoading ? (
            <div className="space-y-8">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 animate-pulse rounded-2xl bg-white/[0.07]" />
                <div className="flex-1 space-y-2"><div className="h-5 w-1/2 animate-pulse rounded bg-white/[0.08]" /><div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" /></div>
              </div>
              <DirectoryRowsSkeleton count={5} />
            </div>
          ) : error || !detail ? (
            <div className="flex flex-col items-center py-20 text-center" role="alert">
              <AlertCircle className="h-7 w-7 text-[var(--directory-focus)]" strokeWidth={1.7} />
              <p className="mt-4 text-sm font-medium">This Directory entry is unavailable.</p>
              <button type="button" onClick={onBack} className="mt-4 text-xs font-semibold text-[var(--directory-title)]">Back to Directory</button>
            </div>
          ) : (
            <>
              <section className="flex items-start gap-4">
                <DirectoryEntityIcon item={detail.record} size="lg" />
                <div className="min-w-0 pt-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">{detail.record.type}</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-foreground">{detail.record.name}</h2>
                  {(detail.record.role || detail.record.companyName || detail.record.subtitle) && (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{[detail.record.role, detail.record.companyName].filter(Boolean).join(" · ") || detail.record.subtitle}</p>
                  )}
                  {detail.record.location && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/65"><MapPin className="h-3.5 w-3.5" strokeWidth={1.8} />{detail.record.location}</p>
                  )}
                </div>
              </section>
              {favoriteError && <p className="mt-5 rounded-xl border border-orange-400/20 bg-orange-400/[0.05] px-4 py-3 text-xs text-orange-200/80" role="alert">{favoriteError}</p>}
              <section className="mt-10" aria-labelledby="directory-details-heading">
                <h3 id="directory-details-heading" className="mb-2 text-xs font-medium tracking-wide text-muted-foreground/65">Details</h3>
                <div className="border-t border-white/[0.08]">
                  {fields.length > 0 ? fields.map((field, index) => <DetailLine key={`${field.label}-${field.value}-${index}`} {...field} />) : (
                    <p className="py-8 text-center text-xs text-muted-foreground/55">No additional details available.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
