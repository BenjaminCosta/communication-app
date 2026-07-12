/**
 * SVC Directory — conflict-safe WRITE helpers (client side).
 *
 * ARCHITECTURE RULE: every Directory edit writes to /contacts or /contexts —
 * the sources of truth — and NEVER to /directoryIndex. The Cloud Functions
 * (syncDirectoryOnContactWrite / syncDirectoryOnContextWrite) then derive the
 * index. These helpers must never touch /directoryIndex.
 *
 * CONCURRENCY: two users editing the same record at once must not clobber each
 * other.
 *  - Scalar fields → updateDoc with a single field path (field-level merge;
 *    other fields are untouched).
 *  - Array members (emails/phones/tags/companies) → arrayUnion / arrayRemove
 *    (commutative, safe under concurrency).
 *  - Context `fields[]` (array of {label,value}) → runTransaction (optimistic
 *    retry) so a concurrent edit to a different field can't overwrite this one.
 */

import {
  doc,
  updateDoc,
  runTransaction,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  type UpdateData,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import {
  cleanValue,
  isLikelyEmail,
  isLikelyPhone,
  isLikelyUrl,
  type CoreContactPoint,
  type CoreContextField,
  type DirectoryType,
} from "@/lib/directory-core"

export class DirectoryWriteError extends Error {}

// ── Public Overview field edits ─────────────────────────────────────────────
// Human edits are authoritative, so they are written into `masterData` — the
// map the normalizer (lib/directory-core) and view models read FIRST, above
// legacy top-level scalars. The top-level scalar is updated too (belt & braces
// for audits/non-Directory consumers). The Cloud Functions re-derive the index
// from the edited source doc, so edits reflect in search/lists automatically.
//
// Note: a future full re-enrichment from the master workbook only rewrites a
// record's masterData when that workbook ROW changes (contentHash diff), so
// these edits survive routine re-runs and are only superseded if the canonical
// source itself changes — which is the intended precedence.

export type DirectoryEditInput = Record<string, string>

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "")
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}

export async function applyDirectoryEdits(
  sourceCollection: "contacts" | "contexts",
  sourceId: string,
  type: DirectoryType,
  edits: DirectoryEditInput,
): Promise<void> {
  const ref = doc(db, sourceCollection, sourceId)
  const has = (key: string) => Object.prototype.hasOwnProperty.call(edits, key)
  const val = (key: string) => cleanValue(edits[key] ?? "")

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This entity no longer exists.")
    const data = snap.data()
    const master: Record<string, unknown> = { ...(data.masterData ?? {}) }
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }

    if (type === "person") {
      if (has("name")) { const v = val("name"); if (!v) throw new DirectoryWriteError("Name cannot be empty."); master.displayName = v; patch.name = v }
      if (has("role")) { const v = val("role"); master.roleName = v; patch.role = v }
      if (has("company")) {
        const v = val("company")
        master.companyName = v
        master.companyMatchConfidence = v ? 1 : (master.companyMatchConfidence ?? 0)
        patch.company = v
      }
      if (has("phone")) {
        const v = val("phone")
        if (v && !isLikelyPhone(v)) throw new DirectoryWriteError("Enter a valid phone number.")
        const others = (Array.isArray(master.phones) ? master.phones.map(String) : [])
          .filter((p) => phoneDigits(p) !== (v ? phoneDigits(v) : ""))
        master.phones = v ? [v, ...others] : others
        master.primaryPhone = v || null
        patch.phone = v
        patch.phoneNormalized = v ? phoneDigits(v) : null
      }
      if (has("email")) {
        const v = val("email")
        if (v && !isLikelyEmail(v)) throw new DirectoryWriteError("Enter a valid email address.")
        const others = (Array.isArray(master.emails) ? master.emails.map(String) : [])
          .filter((e) => e.toLowerCase() !== (v ? v.toLowerCase() : ""))
        master.emails = v ? [v, ...others] : others
        master.primaryEmail = v || null
        patch.email = v
        patch.emailNormalized = v ? v.toLowerCase() : null
      }
      if (has("address")) master.address = val("address")
      if (has("notes")) { const v = val("notes"); master.notes = v; patch.notes = v }
      patch.masterData = master
    } else if (type === "company") {
      if (has("name")) { const v = val("name"); if (!v) throw new DirectoryWriteError("Name cannot be empty."); master.displayName = v; patch.name = v }
      if (has("phone")) { const v = val("phone"); if (v && !isLikelyPhone(v)) throw new DirectoryWriteError("Enter a valid phone number."); master.phone = v }
      if (has("address")) master.address = val("address")
      if (has("website")) { const v = val("website"); if (v && !isLikelyUrl(v)) throw new DirectoryWriteError("Enter a valid website URL."); master.website = v }
      if (has("description")) { const v = val("description"); master.description = v; patch.description = v }
      patch.masterData = master
    } else if (type === "job") {
      if (has("name")) { const v = val("name"); if (!v) throw new DirectoryWriteError("Name cannot be empty."); master.canonicalName = v; patch.name = v }
      const jobKeys = ["status", "address", "location", "durationWeeks", "projectType", "reportCadence", "operationalNotes"] as const
      for (const key of jobKeys) if (has(key)) master[key] = val(key)
      patch.masterData = master
    } else {
      // "other" contexts have no masterData; the normalizer reads top-level.
      if (has("name")) { const v = val("name"); if (!v) throw new DirectoryWriteError("Name cannot be empty."); patch.name = v }
      if (has("description")) patch.description = val("description")
    }

    tx.update(ref, patch as unknown as UpdateData<Record<string, unknown>>)
  })
}

// ── Scalar field edits (contacts + contexts) ────────────────────────────

/** Update a single scalar field on a contact (name, role, company, notes…). */
export async function setContactField(
  contactId: string,
  field: "name" | "company" | "role" | "notes",
  value: string | null,
): Promise<void> {
  const clean = value == null ? null : cleanValue(value)
  await updateDoc(doc(db, "contacts", contactId), {
    [field]: clean,
    updatedAt: serverTimestamp(),
  })
}

/** Update the display name of a context (company/job/other). */
export async function setContextName(contextId: string, name: string): Promise<void> {
  const clean = cleanValue(name)
  if (!clean) throw new DirectoryWriteError("Name cannot be empty")
  await updateDoc(doc(db, "contexts", contextId), {
    name: clean,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Explicitly (re)classify a context. Writes a `directoryType` field the sync
 * function honors first; the entry moves to the new composite id and the old
 * one is removed automatically by the Cloud Function.
 */
export async function setContextType(
  contextId: string,
  directoryType: "company" | "job" | "other",
): Promise<void> {
  await updateDoc(doc(db, "contexts", contextId), {
    directoryType,
    updatedAt: serverTimestamp(),
  })
}

// ── Array-member edits — conflict-safe via arrayUnion/arrayRemove ────────

/** Add an email to a contact's emails[]. Validates format. */
export async function addContactEmail(contactId: string, email: string, label = "email"): Promise<void> {
  if (!isLikelyEmail(email)) throw new DirectoryWriteError(`Invalid email: ${email}`)
  const point: CoreContactPoint = { label, value: cleanValue(email)!, normalized: cleanValue(email)!.toLowerCase() }
  await updateDoc(doc(db, "contacts", contactId), {
    emails: arrayUnion(point),
    updatedAt: serverTimestamp(),
  })
}

/** Remove an exact email point from a contact's emails[]. */
export async function removeContactEmail(contactId: string, point: CoreContactPoint): Promise<void> {
  await updateDoc(doc(db, "contacts", contactId), {
    emails: arrayRemove(point),
    updatedAt: serverTimestamp(),
  })
}

/** Add a phone to a contact's phones[]. Validates format. */
export async function addContactPhone(contactId: string, phone: string, label = "phone"): Promise<void> {
  if (!isLikelyPhone(phone)) throw new DirectoryWriteError(`Invalid phone: ${phone}`)
  const point: CoreContactPoint = { label, value: cleanValue(phone)!, normalized: cleanValue(phone)!.replace(/\D/g, "") }
  await updateDoc(doc(db, "contacts", contactId), {
    phones: arrayUnion(point),
    updatedAt: serverTimestamp(),
  })
}

/** Remove an exact phone point from a contact's phones[]. */
export async function removeContactPhone(contactId: string, point: CoreContactPoint): Promise<void> {
  await updateDoc(doc(db, "contacts", contactId), {
    phones: arrayRemove(point),
    updatedAt: serverTimestamp(),
  })
}

/** Add a URL to a contact's urls[]. Validates format. */
export async function addContactUrl(contactId: string, url: string, label = "url"): Promise<void> {
  if (!isLikelyUrl(url)) throw new DirectoryWriteError(`Invalid URL: ${url}`)
  await updateDoc(doc(db, "contacts", contactId), {
    urls: arrayUnion({ label, value: cleanValue(url)! }),
    updatedAt: serverTimestamp(),
  })
}

/** Add a freeform tag. */
export async function addContactTag(contactId: string, tag: string): Promise<void> {
  const clean = cleanValue(tag)
  if (!clean) throw new DirectoryWriteError("Tag cannot be empty")
  await updateDoc(doc(db, "contacts", contactId), {
    tags: arrayUnion(clean),
    updatedAt: serverTimestamp(),
  })
}

/** Remove a tag. */
export async function removeContactTag(contactId: string, tag: string): Promise<void> {
  await updateDoc(doc(db, "contacts", contactId), {
    tags: arrayRemove(tag),
    updatedAt: serverTimestamp(),
  })
}

// ── Context fields[] — transactional (retry-safe) ───────────────────────

/**
 * Set (or add) the value of a context field by label without clobbering other
 * fields. Uses a transaction so concurrent edits to different labels retry
 * instead of overwriting the whole array.
 */
export async function setContextFieldValue(
  contextId: string,
  label: string,
  value: string,
): Promise<void> {
  const ref = doc(db, "contexts", contextId)
  const cleanVal = cleanValue(value) ?? ""
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("Context not found")
    const data = snap.data()
    const fields: CoreContextField[] = Array.isArray(data.fields) ? [...data.fields] : []
    const idx = fields.findIndex((f) => (f.label ?? "").toLowerCase() === label.toLowerCase())
    if (idx >= 0) fields[idx] = { ...fields[idx], value: cleanVal }
    else fields.push({ label, value: cleanVal })
    tx.update(ref, { fields, updatedAt: serverTimestamp() })
  })
}

/** Remove a context field by label (transactional). */
export async function removeContextField(contextId: string, label: string): Promise<void> {
  const ref = doc(db, "contexts", contextId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("Context not found")
    const data = snap.data()
    const fields: CoreContextField[] = Array.isArray(data.fields) ? data.fields : []
    const next = fields.filter((f) => (f.label ?? "").toLowerCase() !== label.toLowerCase())
    tx.update(ref, { fields: next, updatedAt: serverTimestamp() })
  })
}

// ── Duplicate merge (contact data) ──────────────────────────────────────

/**
 * Merge a duplicate contact INTO a surviving contact WITHOUT losing data.
 * Unions emails/phones/urls/tags/companies/roles and records the duplicate's
 * name + id as aliases on the survivor. The duplicate is NOT deleted here.
 *
 * IMPORTANT — message safety: messages reference contacts via `contactIds`.
 * Re-pointing those from the duplicate to the survivor must run server-side
 * (Admin SDK) because a client can't write messages it doesn't own. This helper
 * therefore only merges CONTACT data; the caller must trigger the server-side
 * message re-point + duplicate deletion (see pending `mergeContactsServer`
 * Cloud Function) so no message/job/relation is orphaned.
 *
 * Returns nothing; throws on missing docs.
 */
export async function mergeContactData(survivorId: string, duplicateId: string): Promise<void> {
  if (survivorId === duplicateId) throw new DirectoryWriteError("Cannot merge a contact into itself")
  const survivorRef = doc(db, "contacts", survivorId)
  const dupRef = doc(db, "contacts", duplicateId)
  await runTransaction(db, async (tx) => {
    const [sSnap, dSnap] = [await tx.get(survivorRef), await tx.get(dupRef)]
    if (!sSnap.exists() || !dSnap.exists()) throw new DirectoryWriteError("Both contacts must exist")
    const s = sSnap.data()
    const d = dSnap.data()
    const union = <T>(a: T[] | undefined, b: T[] | undefined): T[] => {
      const seen = new Set<string>()
      const out: T[] = []
      for (const item of [...(a ?? []), ...(b ?? [])]) {
        const key = JSON.stringify(item)
        if (!seen.has(key)) { seen.add(key); out.push(item) }
      }
      return out
    }
    const aliasNames = union<string>(
      Array.isArray(s.aliasNames) ? s.aliasNames : [],
      [d.name].filter(Boolean),
    )
    tx.update(survivorRef, {
      emails: union(s.emails, d.emails),
      phones: union(s.phones, d.phones),
      urls: union(s.urls, d.urls),
      tags: union(s.tags, d.tags),
      companies: union(s.companies, d.companies),
      roles: union(s.roles, d.roles),
      company: cleanValue(s.company) ?? cleanValue(d.company) ?? null,
      role: cleanValue(s.role) ?? cleanValue(d.role) ?? null,
      aliasNames,
      mergedFromIds: arrayUnion(duplicateId),
      updatedAt: serverTimestamp(),
    })
    // Tombstone the duplicate so it stops surfacing while the server re-points
    // its messages; the server function deletes it once messages are moved.
    tx.update(dupRef, {
      mergedIntoId: survivorId,
      mergedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}
