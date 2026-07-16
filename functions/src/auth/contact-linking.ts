import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from "firebase-admin/firestore"
import * as functionsV1 from "firebase-functions/v1"

function normalizeEmail(email?: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))]
}

async function commitBatches(db: Firestore, updates: Array<(batch: WriteBatch) => void>): Promise<void> {
  for (let index = 0; index < updates.length; index += 450) {
    const batch = db.batch()
    updates.slice(index, index + 450).forEach((update) => update(batch))
    await batch.commit()
  }
}

async function findMatchingImportedContactRefs(
  db: Firestore,
  emailNormalized: string,
): Promise<DocumentReference[]> {
  const refs = new Map<string, DocumentReference>()
  const snapshots = await Promise.all([
    db.collection("contacts").where("emailNormalized", "==", emailNormalized).get(),
    db.collection("contacts").where("email", "==", emailNormalized).get(),
    db.collection("contacts").where("emailNormalizedCandidates", "array-contains", emailNormalized).get(),
  ])
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => refs.set(document.ref.path, document.ref))
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
    functionsV1.logger.info(
      `linkImportedContactsForUser: email not verified, skipping uid=${uid} email=${emailNormalized}`,
    )
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
    const contactSnapshot = await contactRef.get()
    if (!contactSnapshot.exists) continue
    const contact = contactSnapshot.data() ?? {}
    const linkedUserId = typeof contact.linkedUserId === "string" ? contact.linkedUserId : ""
    if (linkedUserId && linkedUserId !== uid) {
      skippedContacts += 1
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
    linkedContacts += 1

    const messagesSnapshot = await db
      .collection("messages")
      .where("contactIds", "array-contains", contactRef.id)
      .get()

    messagesSnapshot.docs.forEach((messageDocument) => {
      const message = messageDocument.data()
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

      if (
        sameStringSet(currentVisible, visibleToUserIds) &&
        sameStringSet(currentRecipients, recipientIds) &&
        sameStringSet(currentPeople, peopleIds) &&
        sameStringSet(currentParticipants, participants)
      ) return

      messageUpdates.push((batch) => batch.update(messageDocument.ref, {
        visibleToUserIds,
        recipientIds,
        peopleIds,
        participants,
        importedContactLinkRunId: linkRunId,
        updatedAt: FieldValue.serverTimestamp(),
      }))
      updatedMessages += 1
    })
  }

  await commitBatches(db, contactUpdates)
  await commitBatches(db, messageUpdates)
  functionsV1.logger.info(
    `linkImportedContactsForUser: email=${emailNormalized} uid=${uid} linkedContacts=${linkedContacts} skippedContacts=${skippedContacts} updatedMessages=${updatedMessages}`,
  )
}

function normalizeDocId(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function sameStringSet(leftValues: unknown[], rightValues: unknown[]): boolean {
  const left = uniqueStrings(leftValues)
  const right = uniqueStrings(rightValues)
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

export const autoLinkOnRegister = functionsV1.firestore
  .document("users/{uid}")
  .onCreate(async (snapshot, context) => {
    const uid: string = context.params.uid
    const newUser = snapshot.data()
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
