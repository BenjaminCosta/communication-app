import { z } from "zod"
import type { SecretaryModule, SecretaryTool, SecretaryToolResult } from "@/lib/whatsapp-secretary/tool-registry"
import {
  getSelfContextSnapshot,
  snapshotHasLiveData,
  type SelfContextActor,
  type SelfContextProvider,
  type SelfContextSnapshot,
} from "@/lib/whatsapp-secretary/self-context"

/**
 * "Me" tools — the Secretary's self-awareness about the person it is talking
 * to, plus its self-awareness about its own capabilities *for that person*.
 *
 * These add no access: every field comes from
 * `lib/whatsapp-secretary/self-context.ts`, which narrows already-permitted
 * reads down to the resolved sender. The module is registered per-request with
 * the server-resolved actor closed over (like `messages`), so the model can
 * never supply, widen, or spoof whose context is being read — there is
 * deliberately no "personName" argument anywhere in this file.
 *
 * The guide tool exists because "what can you do?" was previously answered
 * from the system prompt's prose, which drifts from the real registry and
 * can't know what data this particular person actually has. It is instead
 * derived from the modules the sender's own access policy really enabled, and
 * its example questions are built only from names the snapshot really
 * returned — so a suggestion is never a job or project the person isn't
 * actually on.
 */

/** One line per module, describing what that module's tools genuinely do. Keyed by the real `SecretaryModule` union. */
const MODULE_CAPABILITIES: Record<SecretaryModule, string> = {
  directory: "SVC Directory — any person, company, or job: their details, phone numbers and emails, how they're connected, and free-text notes.",
  questCoral: "Quest Coral — project status, progress, next steps, written project context, and recent updates.",
  applications: "Applications — candidates, their details and documents, the review queue, and a job's application history.",
  reports: "ByeByeDPR Daily Reports — by job, by author, and which active jobs have no recent report. Reports with a generated PDF can be sent here as a file.",
  clocking: "ByeByeDPR clocking — clock-in/out history per job and which jobs have the most activity right now.",
  outlooks: "3-Week Outlooks — a job's scheduled tasks, trades, dates and status, and which jobs have an outlook running.",
  messages: "Communications — automatic operational posts (Outlook publishes, clock events, submitted reports, completed applications), plus the messages you personally can already see in the app.",
  knowledge: "SVC company knowledge — how each SVC app works, step-by-step tutorials, terminology, and the SVC Vision → Mission → Operation → Objective → Goal → Task framework.",
  me: "Your own SVC context — who I recognize you as, the jobs and companies linked to you, your projects, your reports, and what's open right now.",
}

/**
 * How to actually get value out of the Secretary. Deterministic text: these
 * are contract facts (the exact draft command, the read-only boundary, the
 * attachment trigger), not things the model should be paraphrasing from
 * memory.
 */
const USAGE_TUTORIAL: string[] = [
  "Just ask in plain English — there are no commands to learn, and no keywords needed.",
  "Follow-up questions work: the last few messages are remembered, so \"and his phone number?\" or \"what about last week?\" continues the same thread.",
  "Ask for a file explicitly (\"send me that report PDF\", \"show me the photo\") and it arrives as a real WhatsApp attachment when one exists.",
  "When more than one person or job matches, a tap-to-choose list is sent — tap the right one instead of retyping.",
  "Reading is unlimited; the only thing that can be written from WhatsApp is a ByeByeDPR Daily Report draft. Send the job name plus work completed / issues / next steps, then reply exactly CONFIRM DRAFT. It stays a draft — submitting still happens in the SVC app.",
  "Everything else (editing Directory, publishing an Outlook, approving an application) is read-only here, and a link to the right SVC app screen is offered instead.",
]

const MAX_EXAMPLES = 5

/**
 * Example questions grounded ONLY in what the snapshot actually returned. A
 * person with no linked jobs never gets "What's happening on <job>?" with an
 * invented job name — they fall through to the generic-but-true examples at
 * the bottom, which reference capabilities rather than records.
 */
export function buildPersonalizedExamples(snapshot: SelfContextSnapshot): string[] {
  const examples: string[] = []
  const [firstJob] = snapshot.jobs
  const [firstProject] = snapshot.projects
  const activeOutlook = snapshot.outlooks.find((outlook) => outlook.activeToday)

  if (snapshot.clock) examples.push(`How long have I been clocked in at ${snapshot.clock.jobName}?`)
  if (firstJob) examples.push(`What's happening on ${firstJob.name}?`)
  if (activeOutlook) examples.push(`What's on the 3-Week Outlook for ${activeOutlook.jobName} right now?`)
  if (firstProject) examples.push(`What's the status of ${firstProject.name}?`)
  if (snapshot.reports.length > 0) examples.push("What was my last Daily Report?")
  if (firstJob && snapshot.reports.length === 0) examples.push(`Show me the recent Daily Reports for ${firstJob.name}.`)
  if (snapshot.application) examples.push("What's the status of my application?")
  if (snapshot.companies[0]) examples.push(`Who else works with ${snapshot.companies[0].name}?`)

  // True for every internal sender regardless of their own records.
  const generic = [
    "Who is [a person's name] and what's their phone number?",
    "Which jobs don't have a recent Daily Report?",
    "What is Quest Coral for, and how do I use it?",
    "Which jobs have an active 3-Week Outlook today?",
  ]
  for (const example of generic) {
    if (examples.length >= MAX_EXAMPLES) break
    examples.push(example)
  }
  return examples.slice(0, MAX_EXAMPLES)
}

/** Strips the server-only `contextId` so a Directory document id never reaches the model. */
function toModelSnapshot(snapshot: SelfContextSnapshot): Record<string, unknown> {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map(({ contextId: _contextId, ...job }) => job),
  }
}

function profileSection(snapshot: SelfContextSnapshot): Record<string, unknown> {
  return {
    name: snapshot.identity.name,
    role: snapshot.identity.role,
    recognizedVia:
      snapshot.identity.recognizedVia === "directory-contact"
        ? "an exact phone match on their SVC Directory contact record"
        : "an exact phone match on their SVC app account",
    hasLinkedAppAccount: snapshot.identity.hasLinkedAccount,
    phone: snapshot.profile?.phone ?? null,
    email: snapshot.profile?.email ?? null,
    company: snapshot.profile?.companyName ?? null,
    location: snapshot.profile?.location ?? null,
    jobs: snapshot.jobs.map(({ contextId: _contextId, ...job }) => job),
    companies: snapshot.companies,
    gaps: snapshot.gaps,
  }
}

export function createMeTools(
  deps: {
    actor: SelfContextActor
    enabledModules: SecretaryModule[]
    provider?: SelfContextProvider
    today?: string
  },
): SecretaryTool[] {
  const loadSnapshot = () => getSelfContextSnapshot(deps.actor, { provider: deps.provider, today: deps.today })

  const getMyProfile: SecretaryTool<Record<string, never>> = {
    name: "me_getMyProfile",
    module: "me",
    description:
      "Who the person asking actually is in SVC: the name and role they're recognized as, their own contact details, the companies and jobs linked to them in the Directory, and — importantly — an explicit `gaps` list of what is genuinely NOT on file for them. Call this for \"what do you know about me\", \"who am I\", \"what's my role\", \"am I in the system\". Never state a role, job, or company for the person that did not come back from this tool.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}),
    async run(_args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const snapshot = await loadSnapshot()
      budget.remainingRecords -= 1
      const linked = snapshot.jobs.length + snapshot.companies.length
      return {
        summary: `Recognized as ${snapshot.identity.name}${snapshot.identity.role ? `, ${snapshot.identity.role}` : " (no role on file)"}, with ${linked} linked Directory record(s).`,
        data: { profile: profileSection(snapshot) },
      }
    },
  }

  const getMySvcContext: SecretaryTool<Record<string, never>> = {
    name: "me_getMySvcContext",
    module: "me",
    description:
      "The person's own current SVC situation across every module at once: their linked jobs and companies, their Quest Coral projects, their own recent Daily Reports (including drafts), whether they are clocked in right now, the 3-Week Outlooks running on their jobs, how much recent Communications activity they can see, and their own Applications record if one matches their contact details. Call this for \"what should I check today\", \"what jobs am I on\", \"what's going on with my work\", \"catch me up\". Empty sections and the `gaps` list mean that data genuinely does not exist — say so plainly rather than filling it in.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}),
    async run(_args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const snapshot = await loadSnapshot()
      const recordCount =
        snapshot.jobs.length +
        snapshot.companies.length +
        snapshot.projects.length +
        snapshot.reports.length +
        snapshot.outlooks.length +
        (snapshot.clock ? 1 : 0) +
        (snapshot.application ? 1 : 0)
      budget.remainingRecords -= Math.max(1, Math.min(recordCount, budget.maxRecordsPerTool))

      if (!snapshotHasLiveData(snapshot)) {
        return {
          summary: `No SVC records are currently linked to ${snapshot.identity.name} across Directory, Quest Coral, Daily Reports, clocking, Outlooks, or Applications.`,
          data: { context: toModelSnapshot(snapshot) },
          empty: true,
        }
      }
      return {
        summary: `Current SVC context for ${snapshot.identity.name}: ${snapshot.jobs.length} linked job(s), ${snapshot.projects.length} Quest Coral project(s), ${snapshot.reports.length} recent Daily Report(s)${snapshot.clock ? `, currently clocked in at ${snapshot.clock.jobName}` : ""}.`,
        data: { context: toModelSnapshot(snapshot) },
      }
    },
  }

  const getSecretaryGuide: SecretaryTool<Record<string, never>> = {
    name: "me_getSecretaryGuide",
    module: "me",
    description:
      "What the SVC AI Secretary can actually do FOR THIS PERSON right now, how to use it, and example questions built from their real SVC records. Call this whenever the question is about the assistant itself — \"what can you do\", \"how can you help me\", \"how do I use this\", \"what can I ask you\", \"give me a tutorial\". Answer from these capabilities and examples rather than a generic feature list, and never claim a capability that is not in this result.",
    parameters: { type: "object", additionalProperties: false, required: [], properties: {} },
    schema: z.object({}),
    async run(_args, budget): Promise<SecretaryToolResult> {
      if (budget.remainingRecords <= 0) return { summary: "The retrieval budget for this question is used up.", empty: true }
      const snapshot = await loadSnapshot()
      budget.remainingRecords -= 1
      const capabilities = deps.enabledModules.map((module) => MODULE_CAPABILITIES[module]).filter(Boolean)
      return {
        summary: `${capabilities.length} capability area(s) available to ${snapshot.identity.name}, with example questions drawn from their own SVC records.`,
        data: {
          capabilities,
          howToUse: USAGE_TUTORIAL,
          exampleQuestions: buildPersonalizedExamples(snapshot),
          personalContext: {
            recognizedAs: snapshot.identity.name,
            role: snapshot.identity.role,
            jobNames: snapshot.jobs.map((job) => job.name),
            projectNames: snapshot.projects.map((project) => project.name),
            gaps: snapshot.gaps,
          },
        },
      }
    },
  }

  return [getMyProfile, getMySvcContext, getSecretaryGuide]
}
