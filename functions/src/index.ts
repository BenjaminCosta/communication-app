import { initializeApp } from "firebase-admin/app"
import { getFirestore, FieldValue, Firestore, DocumentReference, WriteBatch } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import * as functionsV1 from "firebase-functions/v1"
import {
  buildContactIndexEntry,
  buildContextIndexEntry,
  classifyContext,
  directoryId,
  contextCompositeIds,
  type CoreContact,
  type CoreContext,
} from "./directory-core"

// Today's date in YYYY-MM-DD (UTC)
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

initializeApp()

function normalizeEmail(email?: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
}

async function commitBatches(db: Firestore, updates: Array<(batch: WriteBatch) => void>): Promise<void> {
  for (let i = 0; i < updates.length; i += 450) {
    const batch = db.batch()
    updates.slice(i, i + 450).forEach((update) => update(batch))
    await batch.commit()
  }
}

async function findMatchingImportedContactRefs(db: Firestore, emailNormalized: string): Promise<DocumentReference[]> {
  const refs = new Map<string, DocumentReference>()
  const snapshots = await Promise.all([
    db.collection("contacts").where("emailNormalized", "==", emailNormalized).get(),
    db.collection("contacts").where("email", "==", emailNormalized).get(),
    db.collection("contacts").where("emailNormalizedCandidates", "array-contains", emailNormalized).get(),
  ])

  snapshots.forEach((snap) => {
    snap.docs.forEach((doc) => refs.set(doc.ref.path, doc.ref))
  })

  return [...refs.values()]
}

async function linkImportedContactsForUser(uid: string, email: unknown, emailVerified: boolean): Promise<void> {
  const emailNormalized = normalizeEmail(email)
  if (!uid || !emailNormalized) {
    functionsV1.logger.info(`linkImportedContactsForUser: missing uid/email, skipping uid=${uid}`)
    return
  }
  if (!emailVerified) {
    functionsV1.logger.info(`linkImportedContactsForUser: email not verified, skipping uid=${uid} email=${emailNormalized}`)
    return
  }

  const db = getFirestore()
  const contactRefs = await findMatchingImportedContactRefs(db, emailNormalized)
  if (contactRefs.length === 0) {
    functionsV1.logger.info(`linkImportedContactsForUser: no imported contacts for ${emailNormalized}`)
    return
  }

  const linkRunId = `${uid}-${Date.now()}`
  const contactUpdates: Array<(batch: WriteBatch) => void> = []
  const messageUpdates: Array<(batch: WriteBatch) => void> = []
  let linkedContacts = 0
  let skippedContacts = 0
  let updatedMessages = 0

  for (const contactRef of contactRefs) {
    const contactSnap = await contactRef.get()
    if (!contactSnap.exists) continue
    const contact = contactSnap.data() ?? {}
    const linkedUserId = typeof contact.linkedUserId === "string" ? contact.linkedUserId : ""
    if (linkedUserId && linkedUserId !== uid) {
      skippedContacts++
      continue
    }

    contactUpdates.push((batch) => batch.update(contactRef, {
      email: emailNormalized,
      emailNormalized,
      linkedUserId: uid,
      linkedAt: FieldValue.serverTimestamp(),
      status: "registered",
      updatedAt: FieldValue.serverTimestamp(),
    }))
    linkedContacts++

    const messagesSnap = await db
      .collection("messages")
      .where("contactIds", "array-contains", contactRef.id)
      .get()

    messagesSnap.docs.forEach((messageDoc) => {
      const message = messageDoc.data()
      const authorId = normalizeDocId(message.authorId) || normalizeDocId(message.senderId)
      const currentVisible = Array.isArray(message.visibleToUserIds) ? message.visibleToUserIds : []
      const currentRecipients = Array.isArray(message.recipientIds) ? message.recipientIds : []
      const currentPeople = Array.isArray(message.peopleIds) ? message.peopleIds : []
      const currentParticipants = Array.isArray(message.participants) ? message.participants : []

      const visibleToUserIds = uniqueStrings([
        ...currentVisible,
        authorId,
        ...currentRecipients,
        ...currentParticipants,
        uid,
      ])
      const recipientIds = uniqueStrings([...currentRecipients, uid])
      const peopleIds = uniqueStrings([...currentPeople, uid])
      const participants = uniqueStrings([...currentParticipants, authorId, uid])

      const visibleChanged = !sameStringSet(currentVisible, visibleToUserIds)
      const recipientsChanged = !sameStringSet(currentRecipients, recipientIds)
      const peopleChanged = !sameStringSet(currentPeople, peopleIds)
      const participantsChanged = !sameStringSet(currentParticipants, participants)

      if (!visibleChanged && !recipientsChanged && !peopleChanged && !participantsChanged) return

      messageUpdates.push((batch) => batch.update(messageDoc.ref, {
        visibleToUserIds,
        recipientIds,
        peopleIds,
        participants,
        importedContactLinkRunId: linkRunId,
        updatedAt: FieldValue.serverTimestamp(),
      }))
      updatedMessages++
    })
  }

  await commitBatches(db, contactUpdates)
  await commitBatches(db, messageUpdates)

  functionsV1.logger.info(
    `linkImportedContactsForUser: email=${emailNormalized} uid=${uid} linkedContacts=${linkedContacts} skippedContacts=${skippedContacts} updatedMessages=${updatedMessages}`
  )
}

function normalizeDocId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function sameStringSet(a: unknown[], b: unknown[]): boolean {
  const left = uniqueStrings(a)
  const right = uniqueStrings(b)
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

/**
 * Shared helper: sends FCM push notifications to `recipientIds` (excluding `senderId`).
 * Respects notificationPreference; cleans up stale tokens automatically.
 */
async function sendNotificationsToUsers(
  db: Firestore,
  recipientIds: string[],
  senderId: string,
  messageId: string,
  body: string
): Promise<void> {
  const toNotify = recipientIds.filter((uid) => uid !== senderId)
  if (toNotify.length === 0) return

  // Fetch sender name + all recipient docs in parallel
  const [senderSnap, ...userSnaps] = await Promise.all([
    db.collection("users").doc(senderId).get(),
    ...toNotify.map((uid) => db.collection("users").doc(uid).get()),
  ])
  const senderName: string = senderSnap.data()?.name ?? "Someone"

  const tokens: string[] = []
  const tokenToUid = new Map<string, string>()

  userSnaps.forEach((snap, i) => {
    const userData = snap.data()
    if (!userData) return
    const pref: string = userData.notificationPreference ?? "instant"
    if (pref === "muted") return
    const fcmTokens: string[] = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : []
    for (const token of fcmTokens) {
      tokens.push(token)
      tokenToUid.set(token, toNotify[i])
    }
  })

  if (tokens.length === 0) return

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: senderName,
      body,
    },
    webpush: {
      notification: {
        icon: "https://svc-comms.web.app/icon-192x192.png",
        badge: "https://svc-comms.web.app/icon-192x192.png",
      },
      fcmOptions: { link: "/" },
    },
    data: { messageId },
  })

  functionsV1.logger.info(
    `[FCM] msg=${messageId} sent=${result.successCount} failed=${result.failureCount}`
  )

  // Clean up stale / expired tokens
  const staleTokens = result.responses
    .map((r, i) => ({ r, token: tokens[i] }))
    .filter(
      ({ r }) =>
        !r.success &&
        (r.error?.code === "messaging/invalid-registration-token" ||
          r.error?.code === "messaging/registration-token-not-registered")
    )
    .map(({ token }) => token)

  if (staleTokens.length > 0) {
    const batch = db.batch()
    for (const token of staleTokens) {
      const uid = tokenToUid.get(token)
      if (uid) {
        batch.update(db.collection("users").doc(uid), {
          fcmTokens: FieldValue.arrayRemove(token),
        })
      }
    }
    await batch.commit()
    functionsV1.logger.info(`[FCM] Removed ${staleTokens.length} stale token(s)`)
  }
}

/**
 * Triggered whenever a new user document is created in /users/{uid}.
 * Finds all imported contacts across all owners where:
 *   - normalized email matches the new user's email
 *   - the Firebase Auth email is verified
 *   - linkedUserId is empty or already points at this uid
 * and updates them to:
 *   - linkedUserId: uid
 *   - status: "registered"
 *   - linkedAt: server timestamp
 *   - updatedAt: server timestamp
 *
 * Uses 1st-gen API to avoid Eventarc / Cloud Run IAM complexity.
 */
export const autoLinkOnRegister = functionsV1.firestore
  .document("users/{uid}")
  .onCreate(async (snap, context) => {
    const uid: string = context.params.uid
    const newUser = snap.data()

    const email = normalizeEmail(newUser?.emailNormalized) || normalizeEmail(newUser?.email)
    if (!email) {
      functionsV1.logger.info(`autoLinkOnRegister: uid ${uid} has no email, skipping.`)
      return
    }

    await linkImportedContactsForUser(uid, email, newUser?.emailVerified === true)
  })

export const autoLinkOnUserEmailUpdate = functionsV1.firestore
  .document("users/{uid}")
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()
    const beforeEmail = normalizeEmail(before.emailNormalized) || normalizeEmail(before.email)
    const afterEmail = normalizeEmail(after.emailNormalized) || normalizeEmail(after.email)
    const beforeVerified = before.emailVerified === true
    const afterVerified = after.emailVerified === true
    if (!afterEmail || !afterVerified) return
    if (afterEmail === beforeEmail && beforeVerified === afterVerified) return
    await linkImportedContactsForUser(context.params.uid, afterEmail, afterVerified)
  })

/**
 * Triggered on new message creation.
 * Notifies all users in visibleToUserIds except the sender.
 */
export const onMessageCreated = functionsV1.firestore
  .document("messages/{messageId}")
  .onCreate(async (snap, context) => {
    const data = snap.data()
    const senderId: string = data.senderId ?? data.authorId ?? ""
    const visibleToUserIds: string[] = Array.isArray(data.visibleToUserIds)
      ? data.visibleToUserIds
      : []

    if (!senderId || visibleToUserIds.length === 0) return

    await sendNotificationsToUsers(
      getFirestore(),
      visibleToUserIds,
      senderId,
      context.params.messageId,
      "New message"
    )
  })

/**
 * Triggered on message update.
 * Detects UIDs newly added to visibleToUserIds (e.g. via tag or direct recipient)
 * and sends them a notification. Only fires when visibleToUserIds actually changes.
 */
export const onMessageUpdated = functionsV1.firestore
  .document("messages/{messageId}")
  .onUpdate(async (change, context) => {
    const before: string[] = Array.isArray(change.before.data().visibleToUserIds)
      ? change.before.data().visibleToUserIds
      : []
    const after: string[] = Array.isArray(change.after.data().visibleToUserIds)
      ? change.after.data().visibleToUserIds
      : []
    const beforeImportedContactLinkRunId = change.before.data().importedContactLinkRunId
    const afterImportedContactLinkRunId = change.after.data().importedContactLinkRunId
    if (
      typeof afterImportedContactLinkRunId === "string" &&
      afterImportedContactLinkRunId &&
      afterImportedContactLinkRunId !== beforeImportedContactLinkRunId
    ) {
      functionsV1.logger.info(
        `[onMessageUpdated] msg=${context.params.messageId} skipped imported-contact-link notification`
      )
      return
    }

    // Only proceed if visibleToUserIds actually grew
    const beforeSet = new Set(before)
    const newlyAdded = after.filter((uid) => !beforeSet.has(uid))
    if (newlyAdded.length === 0) return

    const senderId: string =
      change.after.data().senderId ?? change.after.data().authorId ?? ""
    if (!senderId) return

    functionsV1.logger.info(
      `[onMessageUpdated] msg=${context.params.messageId} newlyAdded=${newlyAdded.join(",")}`
    )

    await sendNotificationsToUsers(
      getFirestore(),
      newlyAdded,
      senderId,
      context.params.messageId,
      "New message"
    )
  })

/**
 * Runs every day at 08:00 UTC.
 * Finds messages that have a calendarDate matching today and sends reminders
 * to all users in visibleToUserIds except the author.
 *
 * Uses calendarDateStrings (flat string[]) for the Firestore array-contains query.
 * Writes reminderSentDates: arrayUnion(today) to avoid sending the same reminder twice.
 */
export const onDailyCalendarReminders = functionsV1.pubsub
  .schedule("0 8 * * *")   // 08:00 UTC every day
  .timeZone("UTC")
  .onRun(async () => {
    const today = todayUTC()
    const db = getFirestore()

    const snap = await db
      .collection("messages")
      .where("calendarDateStrings", "array-contains", today)
      .get()

    if (snap.empty) {
      functionsV1.logger.info(`[calendarReminders] ${today}: no messages`)
      return
    }

    let notified = 0
    let skipped = 0

    await Promise.all(
      snap.docs.map(async (msgDoc) => {
        const data = msgDoc.data()

        // Dedup: skip if we already sent a reminder for today on this message
        const alreadySent: string[] = Array.isArray(data.reminderSentDates)
          ? data.reminderSentDates
          : []
        if (alreadySent.includes(today)) {
          skipped++
          return
        }

        const senderId: string = data.senderId ?? data.authorId ?? ""
        const visibleToUserIds: string[] = Array.isArray(data.visibleToUserIds)
          ? data.visibleToUserIds
          : []

        if (!senderId || visibleToUserIds.length === 0) return

        await sendNotificationsToUsers(
          db,
          visibleToUserIds,
          senderId,
          msgDoc.id,
          "You have a message scheduled for today"
        )

        // Mark this date as notified so we never send it again for this message
        await msgDoc.ref.update({
          reminderSentDates: FieldValue.arrayUnion(today),
        })

        notified++
      })
    )

    functionsV1.logger.info(
      `[calendarReminders] ${today}: notified=${notified} skipped=${skipped}`
    )
  })

// ══════════════════════════════════════════════════════════════════════════
// SVC Directory sync — keeps /directoryIndex in lockstep with the source
// collections (/contacts, /contexts).
//
// /directoryIndex is a DERIVED, client-read-only projection. These functions
// are its ONLY writers (Admin SDK bypasses security rules). The source
// collections remain the sole source of truth and are NEVER modified here, so
// no existing Communications flow changes. All Directory edits must therefore
// write to /contacts or /contexts first; the change then flows here.
//
// Reuses the exact normalizer logic from lib/directory-core.ts via the
// generated ./directory-core copy (no duplicated logic). 1st-gen triggers,
// matching the rest of this file (avoids Eventarc/Cloud Run IAM setup).
// ══════════════════════════════════════════════════════════════════════════

/** Recursively drop undefined (Firestore rejects it); leave Dates/sentinels intact. */
function sanitizeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUndefined).filter((v) => v !== undefined)
  if (
    value &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    (value as { constructor?: unknown }).constructor === Object
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, sanitizeUndefined(v)])
        .filter(([, v]) => v !== undefined)
    )
  }
  return value === undefined ? null : value
}

/** Stamp a server updatedAt and strip undefined before writing an index doc. */
function toIndexDoc(entry: object): Record<string, unknown> {
  return sanitizeUndefined({ ...entry, updatedAt: FieldValue.serverTimestamp() }) as Record<string, unknown>
}

/**
 * Best-effort person→company resolution for the incremental path: exact-name
 * match against a Company context. Full normalized resolution happens on a
 * bulk --rebuild; here we keep it cheap (one query) and fall back to null.
 */
async function resolveCompanyCompositeId(db: Firestore, companyName: unknown): Promise<string | null> {
  const name = typeof companyName === "string" ? companyName.trim() : ""
  if (!name) return null
  const snap = await db.collection("contexts").where("name", "==", name).limit(5).get()
  for (const doc of snap.docs) {
    if (classifyContext({ id: doc.id, ...(doc.data() as object) } as CoreContext) === "company") {
      return directoryId("company", doc.id)
    }
  }
  return null
}

/**
 * /contacts → /directoryIndex (always type "person", stable composite id).
 * create/update → upsert person__{id}; delete → remove it.
 */
export const syncDirectoryOnContactWrite = functionsV1.firestore
  .document("contacts/{contactId}")
  .onWrite(async (change, context) => {
    const id: string = context.params.contactId
    const db = getFirestore()
    const ref = db.collection("directoryIndex").doc(directoryId("person", id))

    if (!change.after.exists) {
      await ref.delete()
      functionsV1.logger.info(`[directorySync] contact ${id} deleted → removed person__${id}`)
      return
    }

    const data = change.after.data() ?? {}
    const companyEntityId = await resolveCompanyCompositeId(db, (data as { company?: unknown }).company)
    const entry = buildContactIndexEntry({ id, ...(data as object) } as CoreContact, {
      resolveCompanyId: () => companyEntityId,
    })
    await ref.set(toIndexDoc(entry))
    functionsV1.logger.info(`[directorySync] contact ${id} → person__${id}`)
  })

/**
 * /contexts → /directoryIndex (type company|job|other, chosen by classifyContext,
 * which honors an explicit directoryType field first).
 *
 * On every write we keep EXACTLY ONE entry for the source id: delete the two
 * non-matching type composite ids and upsert the matching one. This makes
 * type changes self-healing (old-type doc is removed) without needing the
 * before-state. On delete, all three context composite ids are removed.
 */
export const syncDirectoryOnContextWrite = functionsV1.firestore
  .document("contexts/{contextId}")
  .onWrite(async (change, context) => {
    const id: string = context.params.contextId
    const db = getFirestore()
    const col = db.collection("directoryIndex")
    const allIds = contextCompositeIds(id) // [company__id, job__id, other__id]

    if (!change.after.exists) {
      const batch = db.batch()
      for (const cid of allIds) batch.delete(col.doc(cid))
      await batch.commit()
      functionsV1.logger.info(`[directorySync] context ${id} deleted → removed ${allIds.join(", ")}`)
      return
    }

    const data = change.after.data() ?? {}
    const entry = buildContextIndexEntry({ id, ...(data as object) } as CoreContext)

    const batch = db.batch()
    for (const cid of allIds) {
      if (cid !== entry.id) batch.delete(col.doc(cid)) // clear stale/other-type entries
    }
    batch.set(col.doc(entry.id), toIndexDoc(entry))
    await batch.commit()
    functionsV1.logger.info(`[directorySync] context ${id} → ${entry.id} (type=${entry.type})`)
  })
