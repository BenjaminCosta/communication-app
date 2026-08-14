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
    canCreateDailyReportDraft: Boolean(identity.userId),
    ...(identity.userId ? { actorUserId: identity.userId } : {}),
    actorPersonId: identity.personId,
  }
}
