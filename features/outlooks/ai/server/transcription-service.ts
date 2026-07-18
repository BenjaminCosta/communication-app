import { canCallProvider, getOutlookAiConfig, OUTLOOK_AI_LIMITS } from "@/lib/ai/config"
import { transcribeAudio } from "@/lib/ai/openai/client"
import { MOCK_OUTLOOK_TRANSCRIPT } from "@/features/outlooks/ai/server/mock-parser"
import type { TranscribeOutlookResponse } from "@/features/outlooks/ai/outlook-parser-contract"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/**
 * Transcribe recorded audio into editable text.
 *
 * Mock mode returns a realistic canned transcript so the voice → transcript →
 * parse → review flow works with no API key. Live mode calls
 * `gpt-4o-mini-transcribe`. Either way the transcript is returned to the client
 * as *editable* text — nothing is auto-saved and no audio is persisted.
 */
export async function transcribeOutlookAudio(input: {
  file: Blob
  fileName: string
  language?: string
}, trace?: { operation: OutlookAiOperation; requestId: string }): Promise<TranscribeOutlookResponse> {
  const config = getOutlookAiConfig()

  if (!canCallProvider(config)) {
    return { transcript: MOCK_OUTLOOK_TRANSCRIPT, mode: "mock" }
  }

  const transcript = await transcribeAudio(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: OUTLOOK_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    { model: config.transcribeModel, file: input.file, fileName: input.fileName, language: input.language },
  )
  return { transcript, mode: "live" }
}
