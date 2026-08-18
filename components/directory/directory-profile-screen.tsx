"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Link2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react"
import { DirectoryRowsSkeleton } from "@/components/directory/directory-states"
import { DirectoryNotesTab } from "@/components/directory/directory-notes-tab"
import { DirectoryFilesTab } from "@/components/directory/directory-files-tab"
import { DirectoryEditSheet } from "@/components/directory/directory-edit-sheet"
import { ThreeWeekOutlookTab } from "@/components/directory/outlooks/three-week-outlook-tab"
import { cn } from "@/lib/utils"
import { DIRECTORY_ENTITY_META } from "@/lib/directory-config"
import { useDirectoryUserState } from "@/components/directory/directory-state-provider"
import {
  type DirectoryProfileViewModel,
  type JobProfileViewModel,
  type ProfileAction,
  type ProfileField,
} from "@/lib/directory-view-models"
import { buildDirectoryDescription } from "@/lib/directory-descriptions"
import { useGeneratingReveal } from "@/hooks/use-generating-reveal"
import { readCachedDirectoryProfile, writeCachedDirectoryProfile } from "@/lib/directory-profile-cache"
import { loadDirectoryProfileViewModel } from "@/lib/directory-profile-loader"
import { loadDirectoryActivitySummary, type DirectoryActivitySummary } from "@/lib/directory-activity"
import {
  directoryRelationsFromEdges,
  loadDirectoryRelationsPage,
  type DirectoryRelations,
  type RelationEntityRef,
} from "@/lib/directory-relations"

type ProfileTab = "overview" | "outlook" | "related" | "notes" | "files"

interface DirectoryProfileScreenProps {
  directoryId: string
  userId: string
  initialView?: "profile" | "outlook"
  onBack: () => void
  onOpenEntity: (directoryId: string) => void
  companies?: Array<{ id: string; name: string }>
  people?: Array<{ id: string; name: string }>
  className?: string
}

export function DirectoryProfileScreen({
  directoryId,
  userId,
  initialView = "profile",
  onBack,
  onOpenEntity,
  companies = [],
  people = [],
  className,
}: DirectoryProfileScreenProps) {
  const [vm, setVm] = useState<DirectoryProfileViewModel | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProfileStale, setIsProfileStale] = useState(false)
  const [error, setError] = useState<"none" | "not-found" | "load">("none")
  const [relations, setRelations] = useState<DirectoryRelations | null>(null)
  const [relationEdges, setRelationEdges] = useState<RelationEntityRef[]>([])
  const [relationsCursor, setRelationsCursor] = useState<string | null>(null)
  const [hasMoreRelations, setHasMoreRelations] = useState(false)
  const [relationsPageLoading, setRelationsPageLoading] = useState(false)
  const [fullRelationsLoaded, setFullRelationsLoaded] = useState(false)
  const [activity, setActivity] = useState<DirectoryActivitySummary | null>(null)
  // Track when the async inputs to the About narrative have settled, so the
  // description renders once (no visible mid-load text swap).
  const [relationsSettled, setRelationsSettled] = useState(false)
  const [activitySettled, setActivitySettled] = useState(false)
  const [tab, setTab] = useState<ProfileTab>("overview")
  const [fullOutlook, setFullOutlook] = useState(false)
  const { favoriteIds, toggleFavorite: updateFavorite, recordRecent } = useDirectoryUserState()
  const [favoritePending, setFavoritePending] = useState(false)
  const [notice, setNotice] = useState("")
  const [showAdmin, setShowAdmin] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const vmId = vm?.id ?? null

  useEffect(() => {
    recordRecent(directoryId)
  }, [directoryId, recordRecent])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError("none")
    const cachedProfile = readCachedDirectoryProfile(directoryId)
    setVm(cachedProfile)
    setIsProfileStale(Boolean(cachedProfile))
    if (cachedProfile) setIsLoading(false)
    setRelations(null)
    setRelationEdges([])
    setRelationsCursor(null)
    setHasMoreRelations(false)
    setFullRelationsLoaded(false)
    setTab(initialView === "outlook" ? "outlook" : "overview")
    setFullOutlook(initialView === "outlook")
    setShowAdmin(false)
    setShowEdit(false)
    loadDirectoryProfileViewModel(directoryId, reloadKey > 0)
      .then((built) => {
        if (!active) return
        setVm(built)
        setIsProfileStale(false)
        writeCachedDirectoryProfile(built)
      })
      .catch((err) => {
        if (active && !cachedProfile) setError(err?.code === "not-found" ? "not-found" : "load")
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [directoryId, initialView, reloadKey, userId])

  // Resolve safe relationships + recent activity once the entity is known
  // (best-effort, non-blocking — the About narrative refines as they arrive).
  useEffect(() => {
    if (!vmId) return
    let active = true
    setRelations(null)
    setActivity(null)
    setRelationsSettled(false)
    setActivitySettled(false)
    loadDirectoryRelationsPage(vmId, null, 5)
      .then((page) => {
        if (!active) return
        setRelationEdges(page.edges)
        setRelations(page.relations)
        setRelationsCursor(page.nextCursor)
        setHasMoreRelations(page.hasMore)
      })
      .catch(() => { if (active) setRelations(null) })
      .finally(() => { if (active) setRelationsSettled(true) })
    loadDirectoryActivitySummary(vmId)
      .then((summary) => { if (active) setActivity(summary) })
      .catch(() => { if (active) setActivity(null) })
      .finally(() => { if (active) setActivitySettled(true) })
    return () => { active = false }
  }, [vmId])

  useEffect(() => {
    if (!vmId || tab !== "related" || fullRelationsLoaded || relationsPageLoading) return
    let active = true
    setRelationsPageLoading(true)
    loadDirectoryRelationsPage(vmId, null, 50)
      .then((page) => {
        if (!active) return
        setRelationEdges(page.edges)
        setRelations(page.relations)
        setRelationsCursor(page.nextCursor)
        setHasMoreRelations(page.hasMore)
        setFullRelationsLoaded(true)
      })
      .finally(() => { if (active) setRelationsPageLoading(false) })
    return () => { active = false }
  }, [fullRelationsLoaded, tab, vmId])

  const isFavorite = favoriteIds.includes(directoryId)
  const description = useMemo(
    () => (vm ? buildDirectoryDescription(vm, relations, activity) : null),
    [vm, relations, activity],
  )
  // Reveal the narrative only once its async inputs (relations + activity) have
  // settled — it never visibly rewrites itself a beat after open. Held for a
  // deliberate minimum so the "generating" shimmer reads as an intentional
  // micro-moment, not an imperceptible flicker on a warm cache. (vm identity text
  // is stable across cache→fresh, so we don't gate on that.)
  const descriptionInputsReady = !!vm && relationsSettled && activitySettled
  const generatingDescription = useGeneratingReveal(directoryId, !descriptionInputsReady, 750)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(""), 2600)
    return () => clearTimeout(timer)
  }, [notice])

  const toggleFavorite = async () => {
    if (favoritePending) return
    setFavoritePending(true)
    try {
      await updateFavorite(directoryId)
    } catch {
      setNotice("Favorite could not be updated.")
    } finally {
      setFavoritePending(false)
    }
  }

  const loadMoreRelations = async () => {
    if (!vm || !relationsCursor || relationsPageLoading) return
    setRelationsPageLoading(true)
    try {
      const page = await loadDirectoryRelationsPage(vm.id, relationsCursor, 50)
      const merged = [...relationEdges, ...page.edges]
      setRelationEdges(merged)
      setRelations(directoryRelationsFromEdges(merged))
      setRelationsCursor(page.nextCursor)
      setHasMoreRelations(page.hasMore)
    } finally {
      setRelationsPageLoading(false)
    }
  }

  const handleAction = (action: ProfileAction) => {
    if (!vm) return
    if (!action.inApp) return // native <a> handles href
    if (action.kind === "edit") { setShowEdit(true); return }
    setNotice(`${action.label} is coming soon.`)
  }

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "overview", label: "Overview" },
    ...(vm?.type === "job" ? [{ id: "outlook" as const, label: "Outlook" }] : []),
    { id: "related", label: "Related" },
    { id: "notes", label: "Notes" },
    { id: "files", label: "Files" },
  ]
  const isOutlookScreen = fullOutlook && tab === "outlook" && vm?.type === "job"

  return (
    <div className={cn("directory-glass-screen flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden", className)}>
      {isOutlookScreen ? (
        <header className="glass-panel app-topbar flex shrink-0 items-center gap-3 border-b px-4 animate-slide-down">
          <button
            type="button"
            onClick={() => setFullOutlook(false)}
            className="glass-button flex h-9 w-9 shrink-0 items-center justify-center rounded-full border active:scale-[0.96]"
            aria-label="Back to job profile"
          >
            <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">3-Week Outlook</h1>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
              {vm.name}{vm.companyName ? ` · ${vm.companyName}` : ""}
            </p>
          </div>
          <span className="h-9 w-9 shrink-0" aria-hidden="true" />
        </header>
      ) : (
        <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4 animate-slide-down">
          <button
            type="button"
            onClick={onBack}
            className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96]"
            aria-label="Back to Directory"
          >
            <ArrowLeft className="h-4 w-4 text-white/80" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={favoritePending || isLoading || error !== "none"}
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
      )}

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className={cn("mx-auto w-full px-4 pb-24 md:px-6", isOutlookScreen ? "max-w-xl pt-4" : "max-w-3xl pt-6")}>
          {isLoading ? (
            <ProfileSkeleton />
          ) : error !== "none" || !vm ? (
            <ProfileErrorState kind={error === "not-found" ? "not-found" : "load"} onBack={onBack} />
          ) : isOutlookScreen ? (
            <ThreeWeekOutlookTab
              job={vm}
              userId={userId}
              companies={companies}
              mode="full"
            />
          ) : (
            <>
              <ProfileHeader vm={vm} relations={relations} />

              <QuickActions actions={vm.actions} onAction={handleAction} />

              {isProfileStale && (
                <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/55" role="status">
                  Showing saved profile while reconnecting
                </p>
              )}

              {notice && (
                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-foreground/75" role="status">
                  {notice}
                </p>
              )}

              {vm && (generatingDescription || description?.text) && (
                <section className="mt-6" aria-label="About">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Sparkles
                      className={cn("h-3 w-3 shrink-0 text-[var(--directory-job)]", generatingDescription && "directory-ai-spark")}
                      strokeWidth={2}
                    />
                    <span className="directory-ai-text text-[10px] font-semibold uppercase tracking-[0.14em]">
                      {generatingDescription ? "Generating summary" : "AI summary"}
                    </span>
                  </div>
                  {generatingDescription ? (
                    <div className="space-y-2.5" aria-hidden>
                      <div className="h-3.5 w-full rounded-full directory-ai-shimmer" />
                      <div className="h-3.5 w-11/12 rounded-full directory-ai-shimmer" style={{ animationDelay: "0.15s" }} />
                      <div className="h-3.5 w-3/5 rounded-full directory-ai-shimmer" style={{ animationDelay: "0.3s" }} />
                    </div>
                  ) : (
                    <p className="text-[15px] leading-7 text-foreground/85">{description?.text}</p>
                  )}
                </section>
              )}

              <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-white/[0.07] scrollbar-hide" aria-label="Profile sections">
                {tabs.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTab(entry.id)}
                    className={cn(
                      "relative shrink-0 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors",
                      tab === entry.id ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground/80",
                    )}
                    aria-current={tab === entry.id ? "page" : undefined}
                  >
                    {entry.label}
                    {tab === entry.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--directory-title)]" />}
                  </button>
                ))}
              </nav>

              <div className="pt-5">
                {tab === "overview" && (
                  <OverviewTab
                    vm={vm}
                    relations={relations}
                    onOpenEntity={onOpenEntity}
                    showAdmin={showAdmin}
                    onToggleAdmin={() => setShowAdmin((v) => !v)}
                  />
                )}
                {tab === "outlook" && vm.type === "job" && (
                  <ThreeWeekOutlookTab
                    job={vm}
                    userId={userId}
                    companies={companies}
                    mode="embedded"
                    onSeeFullOutlook={() => setFullOutlook(true)}
                  />
                )}
                {tab === "related" && (
                  <RelatedTab
                    vm={vm}
                    relations={relations}
                    onOpenEntity={onOpenEntity}
                    hasMore={hasMoreRelations}
                    isLoadingMore={relationsPageLoading}
                    onLoadMore={loadMoreRelations}
                  />
                )}
                {tab === "notes" && <DirectoryNotesTab directoryId={vm.id} userId={userId} autoFocus />}
                {tab === "files" && <DirectoryFilesTab directoryId={vm.id} userId={userId} />}
              </div>
            </>
          )}
        </div>
      </main>

      {showEdit && vm && (
        <DirectoryEditSheet
          vm={vm}
          userId={userId}
          companies={companies}
          people={people}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); setReloadKey((k) => k + 1); setNotice("Changes saved.") }}
        />
      )}
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ vm, relations }: { vm: DirectoryProfileViewModel; relations: DirectoryRelations | null }) {
  const meta = DIRECTORY_ENTITY_META[vm.type === "other" ? "company" : vm.type]
  const badges: Array<{ label: string; tone: "neutral" | "good" | "warn" }> = []
  if (vm.type === "person") {
    badges.push({ label: vm.isInternalUser ? "Internal user" : "External contact", tone: vm.isInternalUser ? "good" : "neutral" })
    if (vm.isActive === true) badges.push({ label: "Active", tone: "good" })
    if (vm.isActive === false) badges.push({ label: "Inactive", tone: "warn" })
  }
  if (vm.type === "job" && vm.status) badges.push({ label: vm.status, tone: "neutral" })
  if (vm.needsReview) badges.push({ label: "Needs review", tone: "warn" })

  const health = vm.type === "job" ? computeJobHealth(vm, relations) : null

  return (
    <section className="flex items-start gap-4">
      <ProfileAvatar vm={vm} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">{vm.type}</p>
        <h2 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.035em] text-foreground">{vm.name}</h2>
        {vm.headline && <p className="mt-1 text-sm leading-6 text-muted-foreground">{vm.headline}</p>}
        {vm.location && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/65">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.8} />
            {vm.location}
          </p>
        )}
        {(badges.length > 0 || health) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {health && <HealthPill health={health} />}
            {badges.map((badge) => (
              <span
                key={badge.label}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  badge.tone === "good" && "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200/80",
                  badge.tone === "warn" && "border-orange-400/25 bg-orange-400/[0.08] text-orange-200/80",
                  badge.tone === "neutral" && "border-white/12 bg-white/[0.04] text-muted-foreground/70",
                )}
                style={badge.tone === "neutral" ? { borderColor: meta.border, color: meta.color } : undefined}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProfileAvatar({ vm }: { vm: DirectoryProfileViewModel }) {
  const meta = DIRECTORY_ENTITY_META[vm.type === "other" ? "company" : vm.type]
  const initials = vm.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
  const isPerson = vm.type === "person"
  const photoUrl = vm.type === "person" ? vm.photoUrl : null
  return (
    <div
      className={cn(
        "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        isPerson ? "rounded-full" : "rounded-2xl",
      )}
      style={{ color: meta.color, background: meta.softBackground, borderColor: meta.border }}
      aria-hidden="true"
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : isPerson ? (
        <span className="text-lg font-semibold tracking-tight">{initials}</span>
      ) : vm.type === "company" ? (
        <Building2 className="h-7 w-7" strokeWidth={1.8} />
      ) : (
        <BriefcaseBusiness className="h-7 w-7" strokeWidth={1.8} />
      )}
    </div>
  )
}

// ── Quick actions ────────────────────────────────────────────────────────────

const ACTION_ICONS: Partial<Record<ProfileAction["kind"], typeof Phone>> = {
  call: Phone,
  email: Mail,
  directions: MapPin,
  website: ExternalLink,
  drive: FolderOpen,
  edit: Pencil,
}

function QuickActions({ actions, onAction }: { actions: ProfileAction[]; onAction: (action: ProfileAction) => void }) {
  if (actions.length === 0) return null
  return (
    <div className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {actions.map((action, index) => {
        const Icon = ACTION_ICONS[action.kind]
        const content = (
          <>
            {Icon && <Icon className="h-4 w-4" strokeWidth={1.8} />}
            <span>{action.label}</span>
          </>
        )
        // All quick actions share one neutral style — no highlighted primary.
        const base = "glass-button flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 px-3.5 py-2 text-xs font-medium text-foreground/85 transition-colors active:scale-[0.97]"
        if (action.href && !action.inApp) {
          const external = /^https?:/i.test(action.href)
          return (
            <a
              key={`${action.kind}-${index}`}
              href={action.href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className={base}
            >
              {content}
            </a>
          )
        }
        return (
          <button key={`${action.kind}-${index}`} type="button" onClick={() => onAction(action)} className={base}>
            {content}
          </button>
        )
      })}
    </div>
  )
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  vm,
  relations,
  onOpenEntity,
  showAdmin,
  onToggleAdmin,
}: {
  vm: DirectoryProfileViewModel
  relations: DirectoryRelations | null
  onOpenEntity: (id: string) => void
  showAdmin: boolean
  onToggleAdmin: () => void
}) {
  const hasRelated = relations && (relations.company || relations.jobs.length > 0 || relations.people.length > 0)
  return (
    <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-8">
      <div className="min-w-0">
        {vm.quality.issues.length > 0 && (
          <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-orange-400/20 bg-orange-400/[0.05] px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--directory-focus)]" strokeWidth={1.8} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-orange-200/85">Incomplete data</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground/70">{vm.quality.issues.join(" · ")}</p>
            </div>
          </div>
        )}

        {vm.overview.length > 0 ? (
          <FieldList fields={vm.overview} />
        ) : (
          <p className="py-8 text-center text-xs text-muted-foreground/55">No additional details available.</p>
        )}

        {vm.adminDetails.length > 0 && (
          <div className="mt-8">
            <button
              type="button"
              onClick={onToggleAdmin}
              className="flex w-full items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-left"
              aria-expanded={showAdmin}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground/70">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                Admin / Data Details
              </span>
              <ChevronRight className={cn("h-4 w-4 text-muted-foreground/50 transition-transform", showAdmin && "rotate-90")} strokeWidth={1.8} />
            </button>
            {showAdmin && (
              <dl className="mt-2 space-y-2 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
                {vm.adminDetails.map((item) => (
                  <div key={item.label} className="flex flex-col gap-0.5 border-b border-white/[0.04] pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:gap-3">
                    <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/45 sm:w-48">{item.label}</dt>
                    <dd className="min-w-0 break-words font-mono text-[11px] leading-5 text-muted-foreground/75">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      {hasRelated && (
        <aside className="mt-8 lg:mt-0">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground/60">Related</h3>
          <div className="space-y-1">
            {relations!.company && <RelationRow entity={relations!.company} onOpen={onOpenEntity} />}
            {relations!.jobs.slice(0, 4).map((job) => <RelationRow key={job.id} entity={job} onOpen={onOpenEntity} />)}
            {relations!.people.slice(0, 4).map((person) => <RelationRow key={person.id} entity={person} onOpen={onOpenEntity} />)}
          </div>
        </aside>
      )}
    </div>
  )
}

function FieldList({ fields }: { fields: ProfileField[] }) {
  return (
    <div className="border-t border-white/[0.08]">
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className="flex gap-3 border-b border-white/[0.06] py-3 last:border-b-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.035] text-muted-foreground/70">
            <FieldIcon kind={field.kind} label={field.label} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/45">{field.label}</p>
            {field.href ? (
              <a
                href={field.href}
                target={/^https?:/i.test(field.href) ? "_blank" : undefined}
                rel={/^https?:/i.test(field.href) ? "noopener noreferrer" : undefined}
                className="mt-0.5 block break-words text-sm leading-5 text-[var(--directory-title)] hover:underline"
              >
                {field.value}
              </a>
            ) : (
              <p className={cn("mt-0.5 break-words text-sm leading-5 text-foreground/85", field.kind === "multiline" && "whitespace-pre-line")}>
                {field.value}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function FieldIcon({ kind, label }: { kind: ProfileField["kind"]; label: string }) {
  if (kind === "email") return <Mail className="h-4 w-4" strokeWidth={1.8} />
  if (kind === "phone") return <Phone className="h-4 w-4" strokeWidth={1.8} />
  if (kind === "address") return <MapPin className="h-4 w-4" strokeWidth={1.8} />
  if (kind === "url") return <ExternalLink className="h-4 w-4" strokeWidth={1.8} />
  return <span className="text-[10px] font-semibold uppercase">{label.slice(0, 2)}</span>
}

// ── Related tab ──────────────────────────────────────────────────────────────

function RelatedTab({
  vm,
  relations,
  onOpenEntity,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: {
  vm: DirectoryProfileViewModel
  relations: DirectoryRelations | null
  onOpenEntity: (id: string) => void
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
}) {
  if (!relations) return <DirectoryRowsSkeleton count={4} />

  const groups: Array<{ title: string; entities: RelationEntityRef[] }> = []
  if (vm.type === "person") {
    if (relations.company) groups.push({ title: "Company", entities: [relations.company] })
    if (relations.jobs.length) groups.push({ title: "Jobs", entities: relations.jobs })
    if (relations.people.length) groups.push({ title: "Related people", entities: relations.people })
  } else if (vm.type === "company") {
    if (relations.people.length) groups.push({ title: "People", entities: relations.people })
    if (relations.jobs.length) groups.push({ title: "Jobs", entities: relations.jobs })
  } else if (vm.type === "job") {
    if (relations.company) groups.push({ title: "Company", entities: [relations.company] })
    if (relations.projectManager) groups.push({ title: "Project Manager", entities: [relations.projectManager] })
    if (relations.projectLead) groups.push({ title: "Project Lead", entities: [relations.projectLead] })
    if (relations.supervisors.length) groups.push({ title: "Supervisors", entities: relations.supervisors })
    if (relations.contacts.length) groups.push({ title: "Related contacts", entities: relations.contacts })
  } else {
    if (relations.people.length) groups.push({ title: "Related people", entities: relations.people })
    if (relations.companies.length) groups.push({ title: "Related companies", entities: relations.companies })
    if (relations.jobs.length) groups.push({ title: "Related jobs", entities: relations.jobs })
  }

  if (groups.length === 0) {
    return <PreparedState icon={Link2} title="No relationships" body="No safe, confirmed relationships are recorded for this entity yet." />
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground/60">
            {group.title}
            {group.entities.length > 1 && <span className="ml-1.5 text-muted-foreground/40">{group.entities.length}</span>}
          </h3>
          <div className="space-y-1">
            {group.entities.map((entity) => <RelationRow key={entity.id} entity={entity} onOpen={onOpenEntity} />)}
          </div>
        </section>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="glass-button w-full rounded-xl border px-4 py-2.5 text-xs font-medium text-muted-foreground transition-transform active:scale-[0.99] disabled:opacity-50"
        >
          {isLoadingMore ? "Loading relationships…" : "Load 50 more"}
        </button>
      )}
    </div>
  )
}

function RelationRow({ entity, onOpen }: { entity: RelationEntityRef; onOpen: (id: string) => void }) {
  const meta = DIRECTORY_ENTITY_META[entity.type === "other" ? "company" : entity.type]
  const isPerson = entity.type === "person"
  const initials = entity.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?"
  return (
    <button
      type="button"
      onClick={() => onOpen(entity.id)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.03] active:scale-[0.995]"
    >
      <div
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center border", isPerson ? "rounded-full" : "rounded-lg")}
        style={{ color: meta.color, background: meta.softBackground, borderColor: meta.border }}
        aria-hidden="true"
      >
        {isPerson ? (
          <span className="text-[10px] font-semibold tracking-tight">{initials}</span>
        ) : entity.type === "company" ? (
          <Building2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <BriefcaseBusiness className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground/90">{entity.name}</p>
        {entity.role && <p className="truncate text-xs text-muted-foreground/55">{entity.role}</p>}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/35" strokeWidth={1.8} />
    </button>
  )
}

// ── Job Health ───────────────────────────────────────────────────────────────

interface JobHealth {
  level: "healthy" | "attention" | "risk"
  reasons: string[]
}

function computeJobHealth(vm: JobProfileViewModel, relations: DirectoryRelations | null): JobHealth {
  const reasons: string[] = []
  const hasTeam = relations
    ? Boolean(relations.projectManager || relations.projectLead || relations.supervisors.length)
    : Boolean(vm.projectManagerName || vm.projectLeadName)
  if (relations && !hasTeam) reasons.push("No supervisor assigned")
  if (!vm.confirmedStartDate) reasons.push("Confirmed start date missing")
  if (!vm.address && !vm.location) reasons.push("Missing address")
  if (vm.isLegacyOrArchived) reasons.push("Legacy / archived job")
  if (vm.needsReview) reasons.push("Flagged for review")
  const level: JobHealth["level"] = reasons.length === 0 ? "healthy" : reasons.length === 1 ? "attention" : "risk"
  return { level, reasons }
}

function HealthPill({ health }: { health: JobHealth }) {
  const config = {
    healthy: { label: "Healthy", cls: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200/85", Icon: Check },
    attention: { label: "Needs attention", cls: "border-amber-400/25 bg-amber-400/[0.08] text-amber-200/85", Icon: AlertTriangle },
    risk: { label: "At risk", cls: "border-red-400/25 bg-red-400/[0.08] text-red-200/85", Icon: AlertCircle },
  }[health.level]
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", config.cls)}
      title={health.reasons.join(" · ") || undefined}
    >
      <config.Icon className="h-3 w-3" strokeWidth={2} />
      {config.label}
    </span>
  )
}

// ── Shared states ────────────────────────────────────────────────────────────

function PreparedState({ icon: Icon, title, body }: { icon: typeof Link2; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035]">
        <Icon className="h-5 w-5 text-[var(--directory-title)]/70" strokeWidth={1.7} />
      </div>
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      <p className="mt-1 max-w-72 text-xs leading-5 text-muted-foreground/60">{body}</p>
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 animate-pulse rounded-2xl bg-white/[0.07]" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-1/2 animate-pulse rounded bg-white/[0.08]" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-white/[0.05]" />)}
      </div>
      <DirectoryRowsSkeleton count={5} />
    </div>
  )
}

function ProfileErrorState({ kind, onBack }: { kind: "not-found" | "load"; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center py-20 text-center" role="alert">
      <AlertCircle className="h-7 w-7 text-[var(--directory-focus)]" strokeWidth={1.7} />
      <p className="mt-4 text-sm font-medium">
        {kind === "not-found" ? "This entity could not be found." : "This profile is unavailable."}
      </p>
      <button type="button" onClick={onBack} className="mt-4 text-xs font-semibold text-[var(--directory-title)]">
        Back to Directory
      </button>
    </div>
  )
}
