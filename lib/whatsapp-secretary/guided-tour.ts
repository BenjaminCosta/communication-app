import { buildCapabilityProfile } from "@/lib/whatsapp-secretary/capability-profiles"
import type { SelfContextSnapshot } from "@/lib/whatsapp-secretary/self-context"
import type { SecretaryModule } from "@/lib/whatsapp-secretary/tool-registry"
import type { WhatsAppOutgoingReply } from "@/lib/whatsapp-response-ux"

/**
 * "Show me around" — the guided tour.
 *
 * Deliberately not documentation. A long feature tour is the thing people skim
 * and then still don't know what to ask, so this is two sentences of framing
 * plus a tap-to-run list: **the tour ends by actually doing something**. The
 * rows are real questions, and choosing one flows straight back through the
 * normal `Selected: …` path into the real orchestrator, so the last thing the
 * tour does is produce a genuine answer about the person's own work.
 *
 * The four framings below are capability *categories*, not module names —
 * "find information" is what someone recognizes wanting; "Directory" is not.
 * Which concrete rows appear is driven by what the person's live snapshot can
 * actually back, so nobody is offered a tour stop that would come back empty.
 */

const TOUR_FRAMING = "I can mainly help you with four things: find information, understand what's happening, learn how SVC works, and point you to the right place to take action."

export interface TourStop {
  /** Short label — WhatsApp list rows are tightly capped. */
  label: string
  /** The real question that runs when the row is chosen. */
  question: string
}

/**
 * Ordered by demonstration value, then filtered to what the snapshot supports.
 * The brief goes first on purpose: it is the one stop that makes the Secretary
 * read across several modules at once, which is the thing that lands.
 */
export function tourStops(snapshot: SelfContextSnapshot): TourStop[] {
  const hasWork = snapshot.jobs.length > 0 || snapshot.projects.length > 0
  const [firstJob] = snapshot.jobs
  const [firstProject] = snapshot.projects

  return [
    ...(hasWork || snapshot.clock ? [{ label: "Today's brief", question: "What should I know today?" }] : []),
    ...(firstJob ? [{ label: `On ${firstJob.name}`.slice(0, 22), question: `What's happening on ${firstJob.name}?` }] : []),
    ...(firstProject ? [{ label: `${firstProject.name}`.slice(0, 22), question: `What's the status of ${firstProject.name}?` }] : []),
    { label: "Find a person", question: "Who is [a person's name] and what's their phone number?" },
    { label: "How SVC works", question: "Show me how SVC works." },
  ]
}

const MAX_TOUR_ROWS = 4

/**
 * Recognized phrasings for asking to be shown around. Kept separate from the
 * general "what can you do?" family because this one gets the deterministic
 * tap-to-run list, while the others go to the model so the answer adapts to how
 * the question was actually asked.
 */
export function isShowMeAroundRequest(value: string): boolean {
  return /^(?:show me around|give me a tour|walk me through(?: this| it)?|tour|show me how (?:this|you) works?|onboard me|get me started|how do i (?:use|get started with) (?:this|you))[!.?\s]*$/i.test(
    value.trim(),
  )
}

/**
 * Builds the tour reply plus a native WhatsApp list whose rows are runnable
 * questions. The `description` carries the full question because the row title
 * is clamped hard by WhatsApp — and the inbound selection is rendered as
 * `Selected: <title> — <description>`, so the description is what the
 * orchestrator actually reads back as the question.
 */
export function buildGuidedTourReply(snapshot: SelfContextSnapshot, enabledModules: SecretaryModule[]): WhatsAppOutgoingReply {
  const profile = buildCapabilityProfile(snapshot, enabledModules)
  const stops = tourStops(snapshot).slice(0, MAX_TOUR_ROWS)

  const body = [
    TOUR_FRAMING,
    profile.phrases.length > 0 ? `For you that mostly means ${profile.phrases.slice(0, 3).join(", ")}.` : "",
    "",
    "Pick one and I'll actually run it now:",
  ]
    .filter(Boolean)
    .join("\n")

  return {
    text: body,
    presentation: {
      kind: "list",
      body,
      buttonText: "Try one",
      sectionTitle: "Start here",
      rows: stops.map((stop, index) => ({
        id: `svc-tour-${index + 1}`,
        title: stop.label,
        description: stop.question,
      })),
    },
  }
}
