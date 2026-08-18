"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ShieldOff, UsersRound } from "lucide-react"
import { cn, getUserAvatarColor } from "@/lib/utils"
import { deriveInitials } from "@/lib/store"
import { auth } from "@/lib/firebase"
import { Switch } from "@/components/ui/switch"
import {
  fetchCourtneyRobertsCenterAccessUsers,
  setCourtneyRobertsCenterAccessUser,
  CourtneyRobertsCenterClientError,
  type CourtneyRobertsCenterAccessUser,
} from "@/lib/courtney-roberts-center/client"

interface CourtneyRobertsCenterAccessScreenProps {
  onBack: () => void
  className?: string
}

export function CourtneyRobertsCenterAccessScreen({ onBack, className }: CourtneyRobertsCenterAccessScreenProps) {
  const [users, setUsers] = useState<CourtneyRobertsCenterAccessUser[] | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pendingUid, setPendingUid] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCourtneyRobertsCenterAccessUsers()
      .then((list) => {
        if (!cancelled) setUsers(list)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setUsers([])
        setErrorStatus(err instanceof CourtneyRobertsCenterClientError ? err.status : null)
        setErrorMessage(err instanceof CourtneyRobertsCenterClientError ? err.message : "Unable to load users.")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async (user: CourtneyRobertsCenterAccessUser, next: boolean) => {
    setPendingUid(user.uid)
    setUsers((current) => current?.map((entry) => (entry.uid === user.uid ? { ...entry, hasAccess: next } : entry)) ?? current)
    try {
      const updated = await setCourtneyRobertsCenterAccessUser(user.uid, next)
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

  return (
    <div className={cn("flex-1 min-h-0 flex flex-col courtney-roberts-center-glass-screen", className ?? "animate-fade-in")}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150 shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">Manage access</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-6 py-4">
          <p className="text-xs text-muted-foreground/60 mb-4 leading-relaxed">
            Anyone with access can see WhatsApp conversation history with Courtney, and grant or revoke access for others here.
          </p>

          {isDenied ? (
            <EmptyState icon={<ShieldOff className="w-5 h-5" />} title="Not approved" description={errorMessage ?? "You are not approved to manage access."} />
          ) : isLoading ? (
            <ListSkeleton />
          ) : errorMessage ? (
            <EmptyState icon={<ShieldOff className="w-5 h-5" />} title="Can't load users" description={errorMessage} />
          ) : users.length === 0 ? (
            <EmptyState icon={<UsersRound className="w-5 h-5" />} title="No users found" description="No registered app users to show." />
          ) : (
            <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
              {users.map((user) => {
                const isSelf = user.uid === currentUid
                return (
                  <div key={user.uid} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0",
                        getUserAvatarColor(user.uid),
                      )}
                    >
                      {deriveInitials(user.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{user.name}</span>
                        {isSelf && <span className="text-[10px] text-muted-foreground/40 shrink-0">(you)</span>}
                      </div>
                      {user.email && <span className="text-xs text-muted-foreground/50 truncate block">{user.email}</span>}
                    </div>
                    <Switch
                      checked={user.hasAccess}
                      disabled={pendingUid === user.uid || isSelf}
                      onCheckedChange={(checked) => handleToggle(user, checked)}
                      className="data-[state=checked]:bg-emerald-500 shrink-0"
                      aria-label={`${user.hasAccess ? "Revoke" : "Grant"} Courtney Roberts Center access for ${user.name}`}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-white/8 shrink-0" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3 w-28 rounded bg-white/8" />
            <div className="h-2.5 w-40 rounded bg-white/6" />
          </div>
          <div className="w-8 h-[1.15rem] rounded-full bg-white/8 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-16">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground/50">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground/60 max-w-[240px]">{description}</p>
    </div>
  )
}
