"use client"

/** Reactive read/write for one project's Markdown context. */

import { useCallback, useEffect, useState } from "react"
import {
  contextForProject,
  saveMockContext,
  subscribeQuestCoralContexts,
} from "@/features/quest-coral/quest-coral-context-store"
import { QUEST_CORAL_BACKEND_ENABLED } from "@/lib/quest-coral-flags"
import { saveQuestCoralProjectContext, subscribeQuestCoralProjectContext } from "@/lib/quest-coral-writes"
import { PROJECT_CONTEXT_MAX_CHARS, type ProjectContext, type ProjectContextSource } from "@/lib/quest-coral-core"

export interface SaveProjectContextInput {
  markdown: string
  source: ProjectContextSource
  fileName?: string | null
}

export function useQuestCoralContext(projectId: string, currentUserName: string) {
  const [context, setContext] = useState<ProjectContext | null>(() =>
    QUEST_CORAL_BACKEND_ENABLED ? null : contextForProject(projectId),
  )

  useEffect(() => {
    if (QUEST_CORAL_BACKEND_ENABLED) {
      setContext(null)
      return subscribeQuestCoralProjectContext(projectId, setContext)
    }
    return subscribeQuestCoralContexts((all) => {
      setContext(all.find((entry) => entry.projectId === projectId) ?? null)
    })
  }, [projectId])

  const saveContext = useCallback(
    async (input: SaveProjectContextInput): Promise<ProjectContext> => {
      const markdown = input.markdown.trim().slice(0, PROJECT_CONTEXT_MAX_CHARS)
      if (QUEST_CORAL_BACKEND_ENABLED) {
        const next = await saveQuestCoralProjectContext({
          projectId,
          markdown,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUserName,
          source: input.source,
          fileName: input.source === "upload" ? input.fileName ?? null : null,
        })
        setContext(next)
        return next
      }
      return saveMockContext(projectId, {
        markdown,
        updatedBy: currentUserName,
        source: input.source,
        fileName: input.fileName ?? null,
      })
    },
    [projectId, currentUserName],
  )

  return { context, saveContext }
}
