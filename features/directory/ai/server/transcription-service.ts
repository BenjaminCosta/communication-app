import { canCallProvider, getDirectoryAiConfig, DIRECTORY_AI_LIMITS } from "@/lib/ai/config"
import { transcribeAudio } from "@/lib/ai/openai/client"
import { MOCK_DIRECTORY_TRANSCRIPT } from "@/features/directory/ai/server/mock-answerer"
import type { TranscribeDirectoryResponse } from "@/features/directory/ai/directory-ask-contract"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Transcribe a spoken Directory question into editable text.
 *
 * Mock mode returns a realistic canned transcript so the voice → transcript →
 * ask flow works with no API key. Live mode calls the configured transcription
 * model. Either way the transcript is returned to the client as *editable* text
 * before it is submitted — nothing is auto-asked and no audio is persisted.
 */
export async function transcribeDirectoryAudio(
  input: { file: Blob; fileName: string; language?: string },
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<TranscribeDirectoryResponse> {
  const config = getDirectoryAiConfig()

  if (!canCallProvider(config)) {
    return { transcript: MOCK_DIRECTORY_TRANSCRIPT, mode: "mock" }
  }

  const transcript = await transcribeAudio(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: DIRECTORY_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    { model: config.transcribeModel, file: input.file, fileName: input.fileName, language: input.language },
  )
  return { transcript, mode: "live" }
}
