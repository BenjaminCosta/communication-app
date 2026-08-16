/**
 * Canonical phone normalization shared by every writer (Directory edits,
 * profile edits, master-data imports) and reader (WhatsApp inbound number
 * matching) that touches `phone`/`phoneNormalized`/`whatsappPhoneNormalized`
 * in this codebase.
 *
 * Before this module existed, `lib/whatsapp-svc-identity.ts`,
 * `lib/directory-writes.ts`, `app/page.tsx`, and
 * `scripts/link-whatsapp-sender-identity.ts` each had their own slightly
 * different digit-stripping logic — none of them stripped Argentina's
 * "54"/"549" prefix except the WhatsApp identity resolver's own candidate
 * generator. That divergence was harmless by luck (the resolver always
 * widens its search to several candidate forms), but it was still a single
 * strategy waiting to drift further apart. Now there is exactly one.
 */

/**
 * Single canonical digits-only form. Strips formatting and well-known
 * country-code prefixes (US/CA "1", Argentina "54"/"549") so the same
 * physical number collapses to one value regardless of how it was typed.
 * This is what NEW writes should store in `phoneNormalized`/
 * `whatsappPhoneNormalized`.
 */
export function normalizePhoneDigits(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  if (digits.startsWith("549")) return digits.slice(3)
  if (digits.startsWith("54")) return digits.slice(2)
  return digits
}

/**
 * Every normalized form a stored phone value might plausibly carry, so a
 * lookup matches historical data written under an older or divergent
 * convention (including data written before this module existed) as well as
 * numbers WhatsApp/Meta supplies with a country code the local record omits
 * or vice versa. Always includes {@link normalizePhoneDigits}'s canonical
 * form. Returns `[]` for anything too short to plausibly be a phone number.
 */
export function phoneLookupCandidates(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, "")
  if (digits.length < 7) return []

  const candidates = new Set<string>([digits, normalizePhoneDigits(rawPhone)])
  // WhatsApp supplies Argentine mobile numbers as 54 + 9 + local number,
  // while imported contacts can store either of the local variants.
  if (digits.startsWith("54")) candidates.add(digits.slice(2))
  if (digits.startsWith("549")) candidates.add(digits.slice(3))
  // Preserve the existing SVC phone-normalization convention for US numbers.
  if (digits.length === 11 && digits.startsWith("1")) candidates.add(digits.slice(1))

  return [...candidates].filter((candidate) => candidate.length >= 7 && candidate.length <= 15)
}
