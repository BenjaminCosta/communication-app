"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Flag, Search, ShieldOff, UsersRound } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { auth } from "@/lib/firebase"
import { Switch } from "@/components/ui/switch"
import { inputClassName } from "@/components/directory/directory-edit-sheet"
import { clearDirectoryReviewFlag, DirectoryWriteError } from "@/lib/directory-writes"
import {
  fetchDirectoryAdminAccessUsers,
  fetchDirectoryFlaggedEntities,
  setDirectoryAdminAccessUser,
  DirectoryAdminClientError,
  type DirectoryAdminAccessUser,
  type DirectoryFlaggedEntity,
} from "@/lib/directory-admin-client"

interface DirectoryAccessScreenProps {
  onBack: () => void
  onOpenDetail: (directoryId: string) => void
  className?: string
}

type AccessTab = "flagged" | "access"
type TypeFilter = "all" | "person" | "company" | "job"
const REASON_OPTIONS = ["Duplicate", "Incorrect info", "Inactive", "Other"] as const
type ReasonFilter = "all" | (typeof REASON_OPTIONS)[number]

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "person", label: "People" },
  { id: "company", label: "Companies" },
  { id: "job", label: "Jobs" },
]

// How long the "Access revoked — Undo" toast stays up before it's treated as final.
const UNDO_WINDOW_MS = 6000

function formatFlaggedAgo(millis: number | null): string | null {
  if (millis == null) return null
  const days = Math.floor((Date.now() - millis) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? "" : "s"} ago`
}

/**
 * Delegates Directory admin access (merge/delete + this screen itself) to
 * other users, and surfaces the flagged-for-review moderation queue —
 * previously nowhere aggregated, only visible one profile at a time via
 * directory-flag-sheet.tsx. Both are gated by the same requireDirectoryAdmin
 * check; the access-management logic mirrors CourtneyRobertsCenterAccessScreen
 * exactly (fetch, optimistic toggle with revert-on-failure, self-toggle
 * disabled). The two lists live in separate tabs (same underline-tab pattern
 * as directory-profile-screen.tsx) — they're unrelated lists doing unrelated
 * jobs, and stacking them made the "flagged" queue (the thing most likely to
 * need action) compete for space with a usually-static admin roster below it.
 * Each tab's intro/controls sit in a `sticky` bar inside the scroll area, so
 * search/filters (and the tab row itself, which lives outside `main`
 * entirely) stay reachable without scrolling back up on a long list.
 * Opening a flagged record just navigates to its profile (onOpenDetail);
 * clearing a flag can also be done right from this list (clearDirectoryReviewFlag
 * is open to any signed-in user, same as flagging itself — this screen only
 * gates the aggregate *view*), without leaving for the full profile.
 */
export function DirectoryAccessScreen({ onBack, onOpenDetail, className }: DirectoryAccessScreenProps) {
  const [tab, setTab] = useState<AccessTab>("flagged")

  const [users, setUsers] = useState<DirectoryAdminAccessUser[] | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingUid, setPendingUid] = useState<string | null>(null)
  const [userQuery, setUserQuery] = useState("")
  const [revokeToast, setRevokeToast] = useState<{ user: DirectoryAdminAccessUser } | null>(null)

  const [flagged, setFlagged] = useState<DirectoryFlaggedEntity[] | null>(null)
  const [flaggedErrorMessage, setFlaggedErrorMessage] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all")
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [clearError, setClearError] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDirectoryAdminAccessUsers()
      .then((list) => {
        if (!cancelled) setUsers(list)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setUsers([])
        setErrorStatus(err instanceof DirectoryAdminClientError ? err.status : null)
        setErrorMessage(err instanceof DirectoryAdminClientError ? err.message : "Unable to load users.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchDirectoryFlaggedEntities()
      .then((list) => {
        if (!cancelled) setFlagged(list)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFlagged([])
        setFlaggedErrorMessage(err instanceof DirectoryAdminClientError ? err.message : "Unable to load flagged records.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!revokeToast) return
    const timer = setTimeout(() => setRevokeToast(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [revokeToast])

  const handleToggle = async (user: DirectoryAdminAccessUser, next: boolean) => {
    setPendingUid(user.uid)
    setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? { ...entry, hasAccess: next } : entry)) ?? current)
    try {
      const updated = await setDirectoryAdminAccessUser(user.uid, next)
      setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? updated : entry)) ?? current)
      // Revoking is the higher-consequence direction (it can take away someone's
      // ability to merge/delete mid-task) — give it a brief, undoable toast.
      // Granting doesn't need the same friction.
      setRevokeToast(next ? null : { user })
    } catch {
      // Revert the optimistic flip — the write failed, so the toggle should bounce back.
      setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? { ...entry, hasAccess: !next } : entry)) ?? current)
    } finally {
      setPendingUid(null)
    }
  }

  const handleClearFlag = async (entity: DirectoryFlaggedEntity) => {
    if (clearingId) return
    setClearingId(entity.directoryId)
    setClearError(null)
    try {
      await clearDirectoryReviewFlag(entity.sourceCollection, entity.sourceId)
      setFlagged((current) => current?.filter((e) => e.directoryId !== entity.directoryId) ?? current)
    } catch (err) {
      setClearError({
        id: entity.directoryId,
        message: err instanceof DirectoryWriteError ? err.message : "Could not clear the flag. Try again.",
      })
    } finally {
      setClearingId(null)
    }
  }

  const isLoading = users === null
  const isDenied = errorStatus === 401 || errorStatus === 403
  const currentUid = auth.currentUser?.uid
  const flaggedCount = flagged?.length ?? 0
  const accessCount = users?.filter((user) => user.hasAccess || user.isLegacyAdmin).length ?? 0

  const filteredUsers = useMemo(() => {
    if (!users) return []
    const query = userQuery.trim().toLowerCase()
    if (!query) return users
    return users.filter((user) => user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
  }, [users, userQuery])

  const filteredFlagged = useMemo(() => {
    if (!flagged) return []
    return flagged.filter((entity) => {
      if (typeFilter !== "all" && entity.type !== typeFilter) return false
      if (reasonFilter !== "all" && !(entity.reviewReason ?? "").startsWith(reasonFilter)) return false
      return true
    })
  }, [flagged, typeFilter, reasonFilter])

  const tabs: Array<{ id: AccessTab; label: string; count: number | null }> = [
    { id: "flagged", label: "Flagged for review", count: flaggedCount > 0 ? flaggedCount : null },
    { id: "access", label: "Manage access", count: null },
  ]

  return (
    <div className={cn("directory-glass-screen flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      <header className="glass-panel app-topbar flex shrink-0 items-center gap-3 border-b px-4 animate-slide-down">
        <button
          type="button"
          onClick={onBack}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]"
          aria-label="Back to Directory"
        >
          <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Directory Access</h1>
      </header>

      {!isDenied && (
        <nav className="flex shrink-0 gap-1 border-b border-white/[0.07] px-4 md:px-6" aria-label="Directory access sections">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 px-3 pb-2.5 pt-3 text-[13px] font-medium transition-colors",
                tab === entry.id ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground/80",
              )}
              aria-current={tab === entry.id ? "page" : undefined}
            >
              {entry.label}
              {entry.count != null && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/90 px-1 text-[10px] font-bold leading-none text-white">
                  {entry.count > 99 ? "99+" : entry.count}
                </span>
              )}
              {tab === entry.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--directory-title)]" />}
            </button>
          ))}
        </nav>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl pb-12">
          {isDenied ? (
            <div className="px-4 pt-5 md:px-6">
              <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Not approved" description={errorMessage ?? "You are not approved to manage Directory access."} />
            </div>
          ) : tab === "flagged" ? (
            <>
              <div className="glass-panel sticky top-0 z-10 border-b px-4 pb-3 pt-4 md:px-6">
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground/60">
                  Records anyone flagged as a duplicate, incorrect, or inactive.
                </p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
                  {TYPE_FILTERS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTypeFilter(option.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors active:scale-[0.97]",
                        typeFilter === option.id
                          ? "border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] text-[var(--directory-title)]"
                          : "border-white/[0.1] bg-white/[0.03] text-foreground/65",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {flagged && flagged.length > 0 && (
                  <select
                    value={reasonFilter}
                    onChange={(event) => setReasonFilter(event.target.value as ReasonFilter)}
                    className={cn(inputClassName, "mt-2 !py-2 text-xs")}
                    aria-label="Filter by reason"
                  >
                    <option value="all">All reasons</option>
                    {REASON_OPTIONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="px-4 pb-2 pt-4 md:px-6">
                {flagged === null ? (
                  <ListSkeleton rows={3} />
                ) : flaggedErrorMessage ? (
                  <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Can't load flagged records" description={flaggedErrorMessage} />
                ) : flagged.length === 0 ? (
                  <EmptyState icon={<Flag className="h-5 w-5" />} title="Nothing flagged" description="No records are currently flagged for review." />
                ) : filteredFlagged.length === 0 ? (
                  <EmptyState icon={<Flag className="h-5 w-5" />} title="No matches" description="Nothing flagged matches this filter." />
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-card divide-y divide-white/8">
                    {filteredFlagged.map((entity) => {
                      const flaggedAgo = formatFlaggedAgo(entity.flaggedAt)
                      return (
                        <div key={entity.directoryId} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-semibold">{entity.name}</span>
                                <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                                  {entity.type}
                                </span>
                              </div>
                              {entity.reviewReason && <span className="block truncate text-xs text-muted-foreground/50">{entity.reviewReason}</span>}
                              {(flaggedAgo || entity.flaggedByName) && (
                                <span className="block truncate text-[10px] text-muted-foreground/40">
                                  Flagged{flaggedAgo ? ` ${flaggedAgo}` : ""}
                                  {entity.flaggedByName ? ` by ${entity.flaggedByName}` : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenDetail(entity.directoryId)}
                                className="glass-button shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium text-foreground/85 active:scale-[0.97]"
                              >
                                Open
                              </button>
                              <button
                                type="button"
                                onClick={() => handleClearFlag(entity)}
                                disabled={clearingId === entity.directoryId}
                                className="px-1 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground/80 disabled:opacity-40"
                              >
                                {clearingId === entity.directoryId ? "Clearing…" : "Clear flag"}
                              </button>
                            </div>
                          </div>
                          {clearError?.id === entity.directoryId && (
                            <p className="mt-1.5 text-[10px] text-orange-300/80" role="alert">
                              {clearError.message}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="glass-panel sticky top-0 z-10 border-b px-4 pb-3 pt-4 md:px-6">
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground/60">
                  Anyone with access can merge duplicate records and delete entries in Directory, and grant or revoke
                  access for others here.
                </p>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.02] px-3">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" strokeWidth={1.8} />
                  <input
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                    placeholder="Search by name or email"
                    className="w-full bg-transparent py-2.5 text-[13px] text-foreground/90 outline-none placeholder:text-muted-foreground/40"
                  />
                </div>
                {!isLoading && !errorMessage && (
                  <p className="mt-2 text-[11px] text-muted-foreground/50">
                    {accessCount} {accessCount === 1 ? "person has" : "people have"} Directory admin access
                  </p>
                )}
              </div>

              <div className="px-4 pb-2 pt-4 md:px-6">
                {isLoading ? (
                  <ListSkeleton />
                ) : errorMessage ? (
                  <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Can't load users" description={errorMessage} />
                ) : users.length === 0 ? (
                  <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No users found" description="No registered app users to show." />
                ) : filteredUsers.length === 0 ? (
                  <EmptyState icon={<Search className="h-5 w-5" />} title="No matches" description="No users match that search." />
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-card divide-y divide-white/8">
                    {filteredUsers.map((user) => {
                      const isSelf = user.uid === currentUid
                      return (
                        <div key={user.uid} className="flex items-center gap-3 px-4 py-3">
                          <div
                            className={cn(
                              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
                              getUserAvatarColor(user.uid),
                            )}
                          >
                            {deriveInitials(user.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold">{user.name}</span>
                              {isSelf && <span className="shrink-0 text-[10px] text-muted-foreground/40">(you)</span>}
                              {user.isLegacyAdmin && (
                                <span className="shrink-0 rounded-full border border-primary/25 bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                  Admin
                                </span>
                              )}
                            </div>
                            {user.email && <span className="block truncate text-xs text-muted-foreground/50">{user.email}</span>}
                            {user.isLegacyAdmin && !user.hasAccess && (
                              <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground/45">
                                Has access via the app-wide Admin flag regardless of this toggle.
                              </span>
                            )}
                          </div>
                          <Switch
                            checked={user.hasAccess}
                            disabled={pendingUid === user.uid || isSelf}
                            onCheckedChange={(checked) => handleToggle(user, checked)}
                            className="shrink-0 data-[state=checked]:bg-emerald-500"
                            aria-label={`${user.hasAccess ? "Revoke" : "Grant"} Directory admin access for ${user.name}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {revokeToast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4" role="status">
          <div className="glass-panel pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-2.5 text-xs text-foreground/85 shadow-[0_16px_40px_rgba(0,0,0,0.35)] animate-slide-up">
            <span>Access revoked for {revokeToast.user.name}.</span>
            <button
              type="button"
              onClick={() => {
                const user = revokeToast.user
                setRevokeToast(null)
                handleToggle(user, true)
              }}
              className="font-semibold text-[var(--directory-title)]"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-card divide-y divide-white/8">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-3 px-4 py-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-white/8" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3 w-28 rounded bg-white/8" />
            <div className="h-2.5 w-40 rounded bg-white/6" />
          </div>
          <div className="h-[1.15rem] w-8 shrink-0 rounded-full bg-white/8" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-[240px] text-xs text-muted-foreground/60">{description}</p>
    </div>
  )
}
