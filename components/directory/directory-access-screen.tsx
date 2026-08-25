"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Flag, ShieldOff, UsersRound } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { auth } from "@/lib/firebase"
import { Switch } from "@/components/ui/switch"
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

/**
 * Delegates Directory admin access (merge/delete + this screen itself) to
 * other users, and surfaces the flagged-for-review moderation queue —
 * previously nowhere aggregated, only visible one profile at a time via
 * directory-flag-sheet.tsx. Both are gated by the same requireDirectoryAdmin
 * check; the access-management logic mirrors CourtneyRobertsCenterAccessScreen
 * exactly (fetch, optimistic toggle with revert-on-failure, self-toggle
 * disabled). The two lists live in separate tabs (same underline-tab pattern
 * as directory-profile-screen.tsx) rather than stacked sections — they're
 * unrelated lists doing unrelated jobs, and stacking them made the "flagged"
 * queue (the thing most likely to need action) compete for space with a
 * usually-static admin roster below it. Opening a flagged record just
 * navigates to its profile (onOpenDetail) — resolving the flag itself reuses
 * the existing directory-flag-sheet.tsx flow there; no inline clear-flag
 * control here.
 */
export function DirectoryAccessScreen({ onBack, onOpenDetail, className }: DirectoryAccessScreenProps) {
  const [tab, setTab] = useState<AccessTab>("flagged")

  const [users, setUsers] = useState<DirectoryAdminAccessUser[] | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingUid, setPendingUid] = useState<string | null>(null)

  const [flagged, setFlagged] = useState<DirectoryFlaggedEntity[] | null>(null)
  const [flaggedErrorMessage, setFlaggedErrorMessage] = useState<string | null>(null)

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

  const handleToggle = async (user: DirectoryAdminAccessUser, next: boolean) => {
    setPendingUid(user.uid)
    setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? { ...entry, hasAccess: next } : entry)) ?? current)
    try {
      const updated = await setDirectoryAdminAccessUser(user.uid, next)
      setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? updated : entry)) ?? current)
    } catch {
      // Revert the optimistic flip — the write failed, so the toggle should bounce back.
      setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? { ...entry, hasAccess: !next } : entry)) ?? current)
    } finally {
      setPendingUid(null)
    }
  }

  const isLoading = users === null
  const isDenied = errorStatus === 401 || errorStatus === 403
  const currentUid = auth.currentUser?.uid
  const flaggedCount = flagged?.length ?? 0

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
        <div className="mx-auto w-full max-w-2xl px-4 pb-12 pt-5 md:px-6">
          {isDenied ? (
            <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Not approved" description={errorMessage ?? "You are not approved to manage Directory access."} />
          ) : tab === "flagged" ? (
            <>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground/60">
                Records anyone flagged as a duplicate, incorrect, or inactive. Open one to review it, fix it, or clear the
                flag.
              </p>
              {flagged === null ? (
                <ListSkeleton rows={3} />
              ) : flaggedErrorMessage ? (
                <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Can't load flagged records" description={flaggedErrorMessage} />
              ) : flagged.length === 0 ? (
                <EmptyState icon={<Flag className="h-5 w-5" />} title="Nothing flagged" description="No records are currently flagged for review." />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-card divide-y divide-white/8">
                  {flagged.map((entity) => (
                    <div key={entity.directoryId} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{entity.name}</span>
                          <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                            {entity.type}
                          </span>
                        </div>
                        {entity.reviewReason && <span className="block truncate text-xs text-muted-foreground/50">{entity.reviewReason}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenDetail(entity.directoryId)}
                        className="glass-button shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium text-foreground/85 active:scale-[0.97]"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground/60">
                Anyone with access can merge duplicate records and delete entries in Directory, and grant or revoke
                access for others here.
              </p>
              {isLoading ? (
                <ListSkeleton />
              ) : errorMessage ? (
                <EmptyState icon={<ShieldOff className="h-5 w-5" />} title="Can't load users" description={errorMessage} />
              ) : users.length === 0 ? (
                <EmptyState icon={<UsersRound className="h-5 w-5" />} title="No users found" description="No registered app users to show." />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-card divide-y divide-white/8">
                  {users.map((user) => {
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
            </>
          )}
        </div>
      </main>
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
