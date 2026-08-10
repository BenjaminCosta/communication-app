import { BYE_BYE_DPR_AI_LIMITS, canCallProvider, getByeByeDprAiConfig } from "@/lib/ai/config"
import { transcribeAudio } from "@/lib/ai/openai/client"
import type { OutlookAiOperation } from "@/lib/ai/server/safe-log"

/** Realistic canned transcript so the voice -> transcript -> structure -> review flow works with no API key. */
export const MOCK_BYE_BYE_DPR_TRANSCRIPT =
  "We finished framing on the second floor and started running electrical rough-in. " +
  "We're waiting on the concrete delivery for tomorrow's pour, that pushed us back about half a day. " +
  "Everyone was on site except Marcus, who called in sick. Tomorrow the plan is to finish rough-in and start drywall on the first floor."

export interface TranscribeReportAudioResponse {
  transcript: string
  mode: "mock" | "live"
}

/**
 * Transcribe recorded report audio into editable text. Mock mode returns a
 * canned transcript with no API key; live mode calls the configured OpenAI
 * transcription model. Either way the transcript is returned as editable
 * text for the user to review before it becomes report content.
 */
export async function transcribeReportAudio(
  input: { file: Blob; fileName: string; language?: string },
  trace?: { operation: OutlookAiOperation; requestId: string },
): Promise<TranscribeReportAudioResponse> {
  const config = getByeByeDprAiConfig()

  if (!canCallProvider(config)) {
    return { transcript: MOCK_BYE_BYE_DPR_TRANSCRIPT, mode: "mock" }
  }

  const transcript = await transcribeAudio(
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: BYE_BYE_DPR_AI_LIMITS.providerTimeoutMs,
      trace,
    },
    { model: config.transcribeModel, file: input.file, fileName: input.fileName, language: input.language },
  )
  return { transcript, mode: "live" }
}
