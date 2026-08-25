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
  addDoc,
  collection,
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
  directoryId,
  isLikelyEmail,
  isLikelyPhone,
  isLikelyUrl,
  type CoreContactPoint,
  type CoreContextField,
  type DirectoryType,
} from "@/lib/directory-core"
import { normalizePhoneDigits } from "@/lib/phone-normalization"

export class DirectoryWriteError extends Error {}

// ── Directory creation ──────────────────────────────────────────────────
//
// Contacts are the source of truth for people, while Companies and Jobs are
// Communications contexts.  Do not create /directoryIndex documents here:
// its Cloud Function projection is deliberately client read-only.

export type NewDirectoryEntityType = "person" | "company" | "job"

export interface DirectoryInvolvedPerson {
  id: string
  name: string
}

export interface DirectoryCompanyReference {
  id: string | null
  name: string
}

export interface CreateDirectoryEntityInput {
  type: NewDirectoryEntityType
  name: string
  role?: string
  companyName?: string
  companyContextId?: string | null
  involvedPeople?: DirectoryInvolvedPerson[]
  email?: string
  phone?: string
  address?: string
  website?: string
  description?: string
  status?: string
  location?: string
}

export interface CreatedDirectoryEntity {
  directoryId: string
  type: NewDirectoryEntityType
  name: string
}

function normalizedInvolvedPeople(people: DirectoryInvolvedPerson[] | undefined): DirectoryInvolvedPerson[] {
  const seen = new Set<string>()
  const normalized: DirectoryInvolvedPerson[] = []
  for (const person of people ?? []) {
    const id = cleanValue(person.id)
    const name = cleanValue(person.name)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    normalized.push({ id, name })
    if (normalized.length === 50) break
  }
  return normalized
}

/**
 * Create a source record that Directory's existing sync functions will index.
 * People belong in /contacts; Companies and Jobs belong in /contexts so they
 * immediately work as Communications context tags as well.
 */
export async function createDirectoryEntity(
  userId: string,
  input: CreateDirectoryEntityInput,
): Promise<CreatedDirectoryEntity> {
  const name = cleanValue(input.name)
  if (!name) throw new DirectoryWriteError("Name cannot be empty.")

  const role = cleanValue(input.role ?? "")
  const companyName = cleanValue(input.companyName ?? "")
  const companyContextId = cleanValue(input.companyContextId ?? "")
  const email = cleanValue(input.email ?? "")
  const phone = cleanValue(input.phone ?? "")
  const address = cleanValue(input.address ?? "")
  const website = cleanValue(input.website ?? "")
  const description = cleanValue(input.description ?? "")
  const status = cleanValue(input.status ?? "")
  const location = cleanValue(input.location ?? "")

  if (email && !isLikelyEmail(email)) throw new DirectoryWriteError("Enter a valid email address.")
  if (phone && !isLikelyPhone(phone)) throw new DirectoryWriteError("Enter a valid phone number.")
  if (website && !isLikelyUrl(website)) throw new DirectoryWriteError("Enter a valid website URL.")

  if (input.type === "person") {
    const ref = await addDoc(collection(db, "contacts"), {
      ownerUserId: userId,
      name,
      role: role ?? "",
      company: companyName ?? "",
      email: email ?? "",
      emailNormalized: email?.toLowerCase() ?? "",
      phone: phone ?? "",
      phoneNormalized: phone ? normalizePhoneDigits(phone) : "",
      emails: email ? [{ label: "email", value: email, normalized: email.toLowerCase(), isPrimary: true }] : [],
      phones: phone ? [{ label: "phone", value: phone, normalized: normalizePhoneDigits(phone), isPrimary: true }] : [],
      addresses: address ? [{ label: "address", formatted: address }] : [],
      urls: website ? [{ label: "website", value: website }] : [],
      tags: [],
      source: "directory",
      visibility: "global",
      masterData: {
        displayName: name,
        roleName: role ?? "",
        companyName: companyName ?? "",
        companyMatchConfidence: companyName ? 1 : 0,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
        address: address ?? "",
        notes: description ?? "",
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return { directoryId: directoryId("person", ref.id), type: "person", name }
  }

  const involvedPeople = normalizedInvolvedPeople(input.involvedPeople)
  const peopleNames = involvedPeople.map((person) => person.name)
  const fields: CoreContextField[] = peopleNames.length
    ? [{ label: "People involved", value: peopleNames.join(", ") }]
    : []

  const masterData = input.type === "company"
    ? {
        displayName: name,
        phone: phone ?? "",
        address: address ?? "",
        website: website ?? "",
        description: description ?? "",
      }
    : {
        canonicalName: name,
        companyName: companyName ?? "",
        companyContextId: companyContextId ?? "",
        status: status ?? "",
        location: location ?? "",
        address: address ?? "",
      }

  const ref = await addDoc(collection(db, "contexts"), {
    name,
    description: description ?? "",
    directoryType: input.type,
    createdBy: userId,
    fields,
    involvedContactIds: involvedPeople.map((person) => person.id),
    involvedPeople,
    masterData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { directoryId: directoryId(input.type, ref.id), type: input.type, name }
}

/** Link a contact to an existing Company context, or retain a typed company name. */
export async function setContactCompanyContext(
  contactId: string,
  company: DirectoryCompanyReference,
): Promise<void> {
  const ref = doc(db, "contacts", contactId)
  const name = cleanValue(company.name) ?? ""
  const contextId = name ? cleanValue(company.id ?? "") : null
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This contact no longer exists.")
    const master: Record<string, unknown> = { ...(snap.data().masterData ?? {}) }
    master.companyName = name
    master.companyContextId = contextId
    master.companyMatchConfidence = name ? 1 : 0
    tx.update(ref, {
      company: name,
      masterData: master,
      updatedAt: serverTimestamp(),
    })
  })
}

function dedupeValid(values: string[], isValid: (v: string) => boolean, normalize: (v: string) => string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = cleanValue(raw)
    if (!v) continue
    if (!isValid(v)) throw new DirectoryWriteError(`"${v}" doesn't look valid.`)
    const key = normalize(v)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/**
 * Replace a contact's full email list (first = primary). Written into
 * masterData — same "human edits are authoritative" rule as the rest of the
 * Public Overview fields — with the legacy top-level scalar kept in sync for
 * non-Directory consumers that still read it directly.
 */
export async function setContactEmails(contactId: string, emails: string[]): Promise<void> {
  const clean = dedupeValid(emails, isLikelyEmail, (v) => v.toLowerCase())
  const ref = doc(db, "contacts", contactId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This contact no longer exists.")
    const master: Record<string, unknown> = { ...(snap.data().masterData ?? {}) }
    master.emails = clean
    master.primaryEmail = clean[0] ?? null
    tx.update(ref, {
      masterData: master,
      email: clean[0] ?? "",
      emailNormalized: clean[0] ? clean[0].toLowerCase() : "",
      updatedAt: serverTimestamp(),
    })
  })
}

/** Replace a contact's full phone list (first = primary). Same shape as setContactEmails. */
export async function setContactPhones(contactId: string, phones: string[]): Promise<void> {
  const clean = dedupeValid(phones, isLikelyPhone, (v) => normalizePhoneDigits(v))
  const ref = doc(db, "contacts", contactId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This contact no longer exists.")
    const master: Record<string, unknown> = { ...(snap.data().masterData ?? {}) }
    master.phones = clean
    master.primaryPhone = clean[0] ?? null
    tx.update(ref, {
      masterData: master,
      phone: clean[0] ?? "",
      phoneNormalized: clean[0] ? normalizePhoneDigits(clean[0]) : "",
      updatedAt: serverTimestamp(),
    })
  })
}

/**
 * Update the actual context connections used by Directory and Communications.
 * The transaction preserves unrelated fields while replacing only the named
 * company reference and/or the selected People involved collection.
 */
export async function updateDirectoryContextConnections(
  contextId: string,
  input: {
    company?: DirectoryCompanyReference
    involvedPeople?: DirectoryInvolvedPerson[]
  },
): Promise<void> {
  const ref = doc(db, "contexts", contextId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This context no longer exists.")
    const data = snap.data()
    const patch: Record<string, unknown> = { updatedAt: serverTimestamp() }

    if (input.company !== undefined) {
      const companyName = cleanValue(input.company.name) ?? ""
      const companyContextId = companyName ? cleanValue(input.company.id ?? "") : null
      const master: Record<string, unknown> = { ...(data.masterData ?? {}) }
      master.companyName = companyName
      master.companyContextId = companyContextId
      patch.masterData = master
    }

    if (input.involvedPeople !== undefined) {
      const involvedPeople = normalizedInvolvedPeople(input.involvedPeople)
      const fields: CoreContextField[] = Array.isArray(data.fields) ? [...data.fields] : []
      const withoutPeople = fields.filter((field) => (field.label ?? "").toLowerCase() !== "people involved")
      if (involvedPeople.length > 0) {
        withoutPeople.push({ label: "People involved", value: involvedPeople.map((person) => person.name).join(", ") })
      }
      patch.fields = withoutPeople
      patch.involvedContactIds = involvedPeople.map((person) => person.id)
      patch.involvedPeople = involvedPeople
    }

    tx.update(ref, patch as unknown as UpdateData<Record<string, unknown>>)
  })
}

/**
 * The reverse of updateDirectoryContextConnections' `involvedPeople`: edit
 * which Jobs a person is on FROM the person's side. Each affected job is its
 * own transaction (jobs are independent docs; there's no need for one atomic
 * multi-doc write, only per-job consistency against a concurrent edit).
 */
export async function updateContactJobAssignments(
  person: { id: string; name: string },
  changes: { addJobSourceIds: string[]; removeJobSourceIds: string[] },
): Promise<void> {
  const jobs = [
    ...changes.addJobSourceIds.map((jobId) => ({ jobId, add: true })),
    ...changes.removeJobSourceIds.map((jobId) => ({ jobId, add: false })),
  ]
  await Promise.all(jobs.map(async ({ jobId, add }) => {
    const ref = doc(db, "contexts", jobId)
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return // job was deleted concurrently — nothing to update
      const data = snap.data()
      const existing = normalizedInvolvedPeople(
        Array.isArray(data.involvedPeople) ? (data.involvedPeople as DirectoryInvolvedPerson[]) : [],
      )
      const next = add
        ? (existing.some((p) => p.id === person.id) ? existing : [...existing, { id: person.id, name: person.name }])
        : existing.filter((p) => p.id !== person.id)
      const fields: CoreContextField[] = Array.isArray(data.fields) ? [...data.fields] : []
      const withoutPeople = fields.filter((field) => (field.label ?? "").toLowerCase() !== "people involved")
      if (next.length > 0) {
        withoutPeople.push({ label: "People involved", value: next.map((p) => p.name).join(", ") })
      }
      tx.update(ref, {
        fields: withoutPeople,
        involvedContactIds: next.map((p) => p.id),
        involvedPeople: next,
        updatedAt: serverTimestamp(),
      })
    })
  }))
}

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
          .filter((p) => normalizePhoneDigits(p) !== (v ? normalizePhoneDigits(v) : ""))
        master.phones = v ? [v, ...others] : others
        master.primaryPhone = v || null
        patch.phone = v
        patch.phoneNormalized = v ? normalizePhoneDigits(v) : null
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
      if (has("active")) {
        const v = val("active")
        master.active = v === "Active" ? true : v === "Inactive" ? false : null
      }
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
      if (has("imageFolderUrl")) {
        const v = val("imageFolderUrl")
        if (v && !isLikelyUrl(v)) throw new DirectoryWriteError("Enter a valid Drive folder URL.")
      }
      const jobKeys = [
        "status", "address", "location", "durationWeeks", "projectType", "reportCadence", "operationalNotes",
        "operatingZone", "estimatedStartDate", "confirmedStartDate", "imageFolderUrl",
        "projectManagerName", "projectLeadName", "jobRateAmount", "jobRateCurrency", "jobRateUnit",
      ] as const
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

// ── Flag for review ──────────────────────────────────────────────────────
// Available to every signed-in user (unlike merge/delete): flagging a record
// as needing attention is safe and non-destructive, and is often how a
// duplicate/bad record gets noticed in the first place. Writes into
// `masterData` — same "human edits are authoritative" precedence as the rest
// of the Public Overview fields (see applyDirectoryEdits above) — so a flag
// set here survives routine master-workbook re-imports. Only person/company/
// job carry masterData; "other" contexts don't track needsReview today.

export type DirectoryReviewReason = "Duplicate" | "Incorrect info" | "Inactive" | "Other"

function formatReviewReason(reason: DirectoryReviewReason, note: string | null): string {
  return note ? `${reason} — ${note}` : reason
}

/** Mark a person/company/job as needing review, with a preset reason + optional free-text note. */
export async function flagDirectoryEntityForReview(
  sourceCollection: "contacts" | "contexts",
  sourceId: string,
  input: { reason: DirectoryReviewReason; note?: string; flaggedBy: string },
): Promise<void> {
  const ref = doc(db, sourceCollection, sourceId)
  const note = cleanValue(input.note ?? "")
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This entity no longer exists.")
    const data = snap.data()
    const master: Record<string, unknown> = { ...(data.masterData ?? {}) }
    master.needsReview = true
    master.reviewReason = formatReviewReason(input.reason, note)
    master.reviewFlaggedBy = input.flaggedBy
    master.reviewFlaggedAt = serverTimestamp()
    tx.update(ref, { masterData: master, updatedAt: serverTimestamp() })
  })
}

/** Clear a previously-set review flag (available to any signed-in user, same as flagging). */
export async function clearDirectoryReviewFlag(
  sourceCollection: "contacts" | "contexts",
  sourceId: string,
): Promise<void> {
  const ref = doc(db, sourceCollection, sourceId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new DirectoryWriteError("This entity no longer exists.")
    const data = snap.data()
    const master: Record<string, unknown> = { ...(data.masterData ?? {}) }
    master.needsReview = false
    master.reviewReason = null
    master.reviewFlaggedBy = null
    master.reviewFlaggedAt = null
    tx.update(ref, { masterData: master, updatedAt: serverTimestamp() })
  })
}

// ── Duplicate merge (contact data) ──────────────────────────────────────
//
// Merging is admin-only and runs entirely server-side via Admin SDK — see
// mergeDirectoryContacts() in lib/directory-server-writes.ts, called from
// app/api/directory/merge. A client-only version can't safely do this: it
// can't write /messages it doesn't own to re-point contactIds, and the
// /contacts update rule wouldn't let a non-owner touch most imported
// duplicates anyway. Client callers use requestDirectoryMerge() in
// lib/directory-cleanup-client.ts.
