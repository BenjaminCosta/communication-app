import { canCallProvider, getDirectoryAiConfig } from "@/lib/ai/config"

/**
 * Query-side embedding helper for semantic note retrieval.
 *
 * Note embeddings are PRECOMPUTED when a note changes (Cloud Function +
 * backfill) — never on every question. This only embeds the short user query so
 * it can be compared against those stored vectors.
 *
 * Returns null whenever embeddings are unavailable (mock mode, no API key, or a
 * provider error) so callers fall back to lexical search instead of failing.
 */

const EMBED_TIMEOUT_MS = 10_000
const MAX_EMBED_CHARS = 2_000

export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim().slice(0, MAX_EMBED_CHARS)
  if (!trimmed) return null

  const config = getDirectoryAiConfig()
  if (!canCallProvider(config)) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)
  try {
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: config.embedModel, input: trimmed }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { data?: Array<{ embedding?: unknown }> }
    const embedding = data.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number")) return null
    return embedding as number[]
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
