export const OUTLOOK_SCHEMA_VERSION = 1
export const OUTLOOK_DAY_COUNT = 21
export const MAX_OUTLOOK_TASKS = 60

export type OutlookTaskStatus = "not_started" | "in_progress" | "blocked" | "complete"
export type OutlookIssueKind = "missing" | "conflict" | "warning"

export interface OutlookIssue {
  id: string
  taskId: string
  field: "title" | "startDate" | "durationDays" | "dependencyTaskId" | "window"
  kind: OutlookIssueKind
  message: string
}

export interface OutlookTask {
  id: string
  sortOrder: number
  title: string
  description: string
  trade: string
  companyName: string
  companyContextId: string | null
  startDate: string | null
  durationDays: number
  endDate: string | null
  dependencyTaskId: string | null
  status: OutlookTaskStatus
  completionPercent: number
}

export interface OutlookWindow {
  start: string
  end: string
}

export interface ScheduledOutlook {
  tasks: OutlookTask[]
  issues: OutlookIssue[]
  canPublish: boolean
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function utcDate(date: string): Date | null {
  if (!ISO_DATE_RE.test(date)) return null
  const [year, month, day] = date.split("-").map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null
  return parsed
}

export function isIsoDate(date: string | null | undefined): date is string {
  return Boolean(date && utcDate(date))
}

export function isoDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

export function localDateToIso(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

export function addIsoDays(date: string, days: number): string {
  const parsed = utcDate(date)
  if (!parsed) throw new Error(`Invalid ISO date: ${date}`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return isoDate(parsed)
}

export function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b)
}

/** Monday of the local calendar week containing `date`. */
export function mondayForDate(date: Date): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = local.getDay()
  local.setDate(local.getDate() - (day === 0 ? 6 : day - 1))
  return localDateToIso(local)
}

export function outlookWindow(windowStart: string): OutlookWindow {
  if (!isIsoDate(windowStart)) throw new Error("Outlook start must be an ISO date.")
  return { start: windowStart, end: addIsoDays(windowStart, OUTLOOK_DAY_COUNT - 1) }
}

export function outlookDates(windowStart: string): string[] {
  return Array.from({ length: OUTLOOK_DAY_COUNT }, (_, index) => addIsoDays(windowStart, index))
}

export function formatOutlookDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const parsed = utcDate(value)
  if (!parsed) return value
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parsed)
}

export function formatOutlookRange(window: OutlookWindow): string {
  return `${formatOutlookDate(window.start)} - ${formatOutlookDate(window.end, { month: "short", day: "numeric", year: "numeric" })}`
}

export function createOutlookTask(partial: Partial<OutlookTask> = {}): OutlookTask {
  const id = partial.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    sortOrder: partial.sortOrder ?? 0,
    title: partial.title?.trim() ?? "",
    description: partial.description?.trim() ?? "",
    trade: partial.trade?.trim() ?? "",
    companyName: partial.companyName?.trim() ?? "",
    companyContextId: partial.companyContextId ?? null,
    startDate: partial.startDate && isIsoDate(partial.startDate) ? partial.startDate : null,
    durationDays: Number.isFinite(partial.durationDays) ? Math.max(1, Math.round(partial.durationDays!)) : 1,
    endDate: partial.endDate && isIsoDate(partial.endDate) ? partial.endDate : null,
    dependencyTaskId: partial.dependencyTaskId ?? null,
    status: partial.status ?? "not_started",
    completionPercent: Math.min(100, Math.max(0, Math.round(partial.completionPercent ?? 0))),
  }
}

function issue(
  taskId: string,
  field: OutlookIssue["field"],
  kind: OutlookIssueKind,
  message: string,
): OutlookIssue {
  return { id: `${taskId}:${field}:${kind}`, taskId, field, kind, message }
}

/**
 * Resolve task end dates and dependency-only starts. Dates are inclusive and
 * durations use calendar days. An explicit start before its dependency ends is
 * retained but reported as a blocking conflict for the user to fix.
 */
export function scheduleOutlookTasks(sourceTasks: OutlookTask[], window: OutlookWindow): ScheduledOutlook {
  const tasks = sourceTasks
    .slice(0, MAX_OUTLOOK_TASKS)
    .map((task, index) => createOutlookTask({ ...task, sortOrder: index }))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const issues: OutlookIssue[] = []
  const resolving = new Set<string>()
  const resolved = new Set<string>()

  const resolveTask = (task: OutlookTask): void => {
    if (resolved.has(task.id)) return
    if (resolving.has(task.id)) {
      issues.push(issue(task.id, "dependencyTaskId", "conflict", "Dependency cycle detected."))
      return
    }
    resolving.add(task.id)

    if (!task.title.trim()) issues.push(issue(task.id, "title", "missing", "Task name is required."))
    if (!Number.isInteger(task.durationDays) || task.durationDays < 1) {
      issues.push(issue(task.id, "durationDays", "missing", "Duration must be at least one day."))
      task.durationDays = 1
    }

    if (task.dependencyTaskId) {
      const dependency = byId.get(task.dependencyTaskId)
      if (!dependency) {
        issues.push(issue(task.id, "dependencyTaskId", "missing", "The selected dependency no longer exists."))
      } else if (dependency.id === task.id) {
        issues.push(issue(task.id, "dependencyTaskId", "conflict", "A task cannot depend on itself."))
      } else {
        resolveTask(dependency)
        if (dependency.endDate) {
          const earliestStart = addIsoDays(dependency.endDate, 1)
          if (!task.startDate) task.startDate = earliestStart
          else if (compareIsoDates(task.startDate, earliestStart) < 0) {
            issues.push(issue(
              task.id,
              "dependencyTaskId",
              "conflict",
              `Start must be ${formatOutlookDate(earliestStart)} or later after ${dependency.title || "its dependency"}.`,
            ))
          }
        }
      }
    }

    if (!task.startDate || !isIsoDate(task.startDate)) {
      issues.push(issue(task.id, "startDate", "missing", "Start date or a valid dependency is required."))
      task.startDate = null
      task.endDate = null
    } else {
      task.endDate = addIsoDays(task.startDate, task.durationDays - 1)
      if (compareIsoDates(task.startDate, window.start) < 0 || compareIsoDates(task.startDate, window.end) > 0) {
        issues.push(issue(task.id, "window", "warning", "Task starts outside this three-week window."))
      } else if (task.endDate && compareIsoDates(task.endDate, window.end) > 0) {
        issues.push(issue(task.id, "window", "warning", "Task continues beyond this three-week window."))
      }
    }

    resolving.delete(task.id)
    resolved.add(task.id)
  }

  for (const task of tasks) resolveTask(task)
  const blocking = issues.some((entry) => entry.kind !== "warning")
  return { tasks, issues, canPublish: tasks.length > 0 && !blocking }
}

export function taskStatusLabel(status: OutlookTaskStatus): string {
  switch (status) {
    case "in_progress": return "In progress"
    case "blocked": return "Blocked"
    case "complete": return "Complete"
    default: return "Planned"
  }
}

export function outlookVersionId(versionNumber: number): string {
  return `v${String(versionNumber).padStart(4, "0")}`
}

