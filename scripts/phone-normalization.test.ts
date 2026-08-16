import assert from "node:assert/strict"
import test from "node:test"
import { normalizePhoneDigits, phoneLookupCandidates } from "../lib/phone-normalization"

test("normalizePhoneDigits strips formatting and the US/CA country code", () => {
  assert.equal(normalizePhoneDigits("(908) 555-1279"), "9085551279")
  assert.equal(normalizePhoneDigits("+1 908 555 1279"), "9085551279")
  assert.equal(normalizePhoneDigits("19085551279"), "9085551279")
  assert.equal(normalizePhoneDigits("9085551279"), "9085551279")
})

test("normalizePhoneDigits strips Argentine 54/549 prefixes", () => {
  assert.equal(normalizePhoneDigits("+54 9 11 2345-6789"), "1123456789")
  assert.equal(normalizePhoneDigits("5491123456789"), "1123456789")
  assert.equal(normalizePhoneDigits("541123456789"), "1123456789")
})

test("normalizePhoneDigits leaves a bare local number untouched", () => {
  assert.equal(normalizePhoneDigits("1123456789"), "1123456789")
})

test("normalizePhoneDigits passes through anything that isn't 11-digit-US or 54/549-prefixed", () => {
  assert.equal(normalizePhoneDigits("442071234567"), "442071234567") // UK, no special-cased prefix
})

test("phoneLookupCandidates returns [] for anything shorter than 7 digits", () => {
  assert.deepEqual(phoneLookupCandidates("12345"), [])
  assert.deepEqual(phoneLookupCandidates(""), [])
})

test("phoneLookupCandidates widens a US number to both the raw and country-code-stripped forms", () => {
  const candidates = new Set(phoneLookupCandidates("19085551279"))
  assert.ok(candidates.has("19085551279"))
  assert.ok(candidates.has("9085551279"))
})

test("phoneLookupCandidates widens an Argentine mobile number to every plausible stored form", () => {
  const candidates = new Set(phoneLookupCandidates("5491123456789"))
  assert.ok(candidates.has("5491123456789")) // as WhatsApp sends it
  assert.ok(candidates.has("91123456789")) // "54" stripped
  assert.ok(candidates.has("1123456789")) // "549" stripped
})

test("phoneLookupCandidates always includes the canonical normalized form", () => {
  const candidates = phoneLookupCandidates("(908) 555-1279")
  assert.ok(candidates.includes(normalizePhoneDigits("(908) 555-1279")))
})

test("phoneLookupCandidates never returns a candidate outside the 7-15 digit window", () => {
  for (const candidate of phoneLookupCandidates("+1 908 555 1279")) {
    assert.ok(candidate.length >= 7 && candidate.length <= 15, `unexpected candidate length: ${candidate}`)
  }
})
