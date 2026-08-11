import "server-only"

/**
 * Google Geocoding API — free-text address -> {lat, lng}. General-purpose
 * (not ByeByeDPR-specific), server-only.
 *
 * Fails closed and silent: returns `null` whenever the API key is missing,
 * the address doesn't resolve, or the request errors — never throws, and
 * never fabricates a fallback coordinate. A wrong/guessed location is worse
 * than none (see docs/svc-bye-bye-dpr-module.md's 2026-08-11 nearest-
 * location bug, where a job's coordinates got silently set to the wrong
 * place) — callers must treat a `null` result as "this address couldn't be
 * located," not retry with something approximate.
 */

export interface GeocodedPoint {
  lat: number
  lng: number
}

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json"
const REQUEST_TIMEOUT_MS = 8_000

interface GoogleGeocodeResponse {
  status: string
  results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
}

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_GEOCODING_API_KEY)
}

export async function geocodeAddress(address: string): Promise<GeocodedPoint | null> {
  const trimmed = address.trim()
  if (!trimmed) return null
  const apiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY
  if (!apiKey) return null

  try {
    const url = new URL(GEOCODE_ENDPOINT)
    url.searchParams.set("address", trimmed)
    url.searchParams.set("key", apiKey)
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) return null
    const data = (await response.json()) as GoogleGeocodeResponse
    if (data.status !== "OK") return null
    const location = data.results?.[0]?.geometry?.location
    if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") return null
    return { lat: location.lat, lng: location.lng }
  } catch {
    return null
  }
}
