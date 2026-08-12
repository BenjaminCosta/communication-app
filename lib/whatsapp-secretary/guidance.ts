/**
 * Deterministic guidance for actions the WhatsApp Secretary cannot yet
 * perform. This is static reference text folded into the system prompt, not
 * a callable tool — it is guidance, not data retrieval. Keeping it in one
 * deterministic table (rather than letting the model invent a URL) guarantees
 * every link the Secretary offers is real.
 *
 * `app/page.tsx` resolves a small allowlist of authenticated query deep links:
 * Directory profiles/Outlooks, Quest Coral projects, Application records, and
 * top-level modules. These helpers only emit that allowlist, so the model
 * never invents a route or controls the target identifier.
 */

const DEFAULT_APP_BASE_URL = "https://communication-svc.vercel.app"

export function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") || DEFAULT_APP_BASE_URL
}

/** A real, working deep link into one job's 3-Week Outlook screen. */
export function buildOutlookDeepLink(jobDirectoryId: string): string {
  return `${getAppBaseUrl()}/?directory=${encodeURIComponent(jobDirectoryId)}&view=outlook`
}

/** A real, working deep link into one Directory entity's profile. */
export function buildDirectoryProfileDeepLink(directoryId: string): string {
  return `${getAppBaseUrl()}/?directory=${encodeURIComponent(directoryId)}&view=profile`
}

/** Opens a real top-level SVC module after the normal authenticated app boot. */
export function buildModuleDeepLink(module: "directory" | "applications" | "quest-coral" | "bye-bye-dpr"): string {
  return `${getAppBaseUrl()}/?module=${encodeURIComponent(module)}`
}

/** Opens one Quest Coral project after the dashboard's normal data load. */
export function buildQuestCoralProjectDeepLink(projectId: string): string {
  return `${getAppBaseUrl()}/?questCoral=${encodeURIComponent(projectId)}`
}

/** Opens one internal Applications record after the dashboard's normal data load. */
export function buildApplicationDeepLink(applicationId: string): string {
  return `${getAppBaseUrl()}/?application=${encodeURIComponent(applicationId)}`
}

export interface NotYetSupportedAction {
  /** Matches loosely against the user's question to decide whether to mention this. */
  keywords: RegExp
  guidance: string
}

const NOT_YET_SUPPORTED_ACTIONS: NotYetSupportedAction[] = [
  {
    keywords: /\b(create|start|publish|edit|update)\b.*\b(3.?week )?outlook\b/i,
    guidance:
      "Creating, editing, or publishing a 3-Week Outlook isn't available over WhatsApp yet. Open the job in the SVC app (Directory → the job → Outlook tab) to do that.",
  },
  {
    keywords: /\b(submit|finalize|finish)\b.*\b(daily )?report\b/i,
    guidance:
      "WhatsApp can only create and preview a Daily Report draft (CONFIRM DRAFT). Submitting/finalizing a report happens in the SVC app's ByeByeDPR module.",
  },
  {
    keywords: /\b(approve|reject|review)\b.*\b(application|candidate)\b/i,
    guidance:
      "Approving, rejecting, or reviewing an application isn't available over WhatsApp. Open the Applications module in the SVC app to act on it.",
  },
  {
    keywords: /\b(edit|update|change|add)\b.*\b(directory|contact|company|job|context)\b/i,
    guidance:
      "Editing Directory records isn't available over WhatsApp — it's read-only here. Use the Directory module in the SVC app to make changes.",
  },
  {
    keywords: /\bclock\b.*\b(in|out)\b.*\b(him|her|them|someone|another|for )\b/i,
    guidance:
      "WhatsApp can't clock someone else in or out — that has to be done by that person in the SVC app.",
  },
]

/** Returns guidance snippets whose keywords match the question, for the system prompt. */
export function matchNotYetSupportedGuidance(question: string): string[] {
  return NOT_YET_SUPPORTED_ACTIONS.filter((action) => action.keywords.test(question)).map(
    (action) => action.guidance,
  )
}

export function buildGuidanceReferenceBlock(): string {
  const appUrl = getAppBaseUrl()
  return [
    `The SVC app is at ${appUrl}. WhatsApp cannot perform these actions yet — if asked, briefly explain that and point to the relevant SVC app module instead of attempting it or inventing a link:`,
    ...NOT_YET_SUPPORTED_ACTIONS.map((action) => `- ${action.guidance}`),
  ].join("\n")
}
