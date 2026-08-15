import type { WhatsAppSenderIdentity } from "@/lib/whatsapp-svc-identity"

export type CompanyKnowledgeAccessScope = "public" | "internal"

/**
 * First WhatsApp authorization boundary.
 *
 * Identity resolution is intentionally the only input: an exact, unambiguous
 * SVC identity grants the internal read-only scope. Every other sender is
 * public-only. Future role- and relation-based policies can refine this object
 * without changing the webhook or individual data tools.
 */
export type WhatsAppAccessPolicy = {
  level: "public" | "internal"
  principal: "anonymous" | "identified"
  /** Selects the baseline knowledge slice folded into the prompt
   * (`lib/company-knowledge.ts`) and, when `"internal"`, also gates the
   * deeper `knowledge_search`/`knowledge_getSection` tools
   * (`lib/whatsapp-secretary/tool-registry.ts`). A public sender never gets
   * the knowledge tools — only the small fixed public entry in the prompt. */
  companyKnowledgeScope: CompanyKnowledgeAccessScope
  canReadDirectory: boolean
  canReadQuestCoral: boolean
  canReadApplications: boolean
  canReadReports: boolean
  canReadClocking: boolean
  canReadOutlooks: boolean
  /** Gates the whole Messages/Communications module (both the automatic
   * operational history tool and the human-message tool). The human-message
   * tool applies a further, per-request scope on top of this: it only ever
   * returns messages the requesting sender's own `visibleToUserIds` already
   * includes, so an identified sender with no linked Firebase user id still
   * gets this flag but that tool returns nothing for them (see
   * `lib/whatsapp-secretary/tools/messages.ts`). */
  canReadMessages: boolean
  /**
   * Gates the "my SVC context" module (`lib/whatsapp-secretary/tools/me.ts`) —
   * personalization only. It exposes nothing a recognized sender couldn't
   * already read through the other modules; it narrows those same reads down
   * to the server-resolved sender, whose identity the model never supplies.
   * True for any identified sender, including one with no linked app account
   * (their Directory-side context still resolves; the account-keyed sections
   * come back empty and explicitly flagged).
   */
  canReadOwnContext: boolean
  /** Requires an identified, linked Firebase user because ByeByeDPR drafts are author-scoped. */
  canCreateDailyReportDraft: boolean
  /** Server-side authorization context. Never pass these IDs to a model. */
  actorUserId?: string
  /** Server-side authorization context. Never pass these IDs to a model. */
  actorPersonId?: string
}

export function resolveWhatsAppAccessPolicy(identity: WhatsAppSenderIdentity | null): WhatsAppAccessPolicy {
  if (!identity) {
    return {
      level: "public",
      principal: "anonymous",
      companyKnowledgeScope: "public",
      canReadDirectory: false,
      canReadQuestCoral: false,
      canReadApplications: false,
      canReadReports: false,
      canReadClocking: false,
      canReadOutlooks: false,
      canReadMessages: false,
      canReadOwnContext: false,
      canCreateDailyReportDraft: false,
    }
  }

  return {
    level: "internal",
    principal: "identified",
    companyKnowledgeScope: "internal",
    canReadDirectory: true,
    canReadQuestCoral: true,
    canReadApplications: true,
    canReadReports: true,
    canReadClocking: true,
    canReadOutlooks: true,
    canReadMessages: true,
    canReadOwnContext: true,
    canCreateDailyReportDraft: Boolean(identity.userId),
    ...(identity.userId ? { actorUserId: identity.userId } : {}),
    actorPersonId: identity.personId,
  }
}
