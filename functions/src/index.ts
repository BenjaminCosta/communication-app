import { initializeApp } from "firebase-admin/app"
import { getFirestore, FieldValue, Firestore } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import * as functionsV1 from "firebase-functions/v1"

initializeApp()

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
 *   - email matches the new user's email
 *   - status === "not_registered"
 * and updates them to:
 *   - linkedUserId: uid
 *   - status: "registered"
 *   - updatedAt: server timestamp
 *
 * Uses 1st-gen API to avoid Eventarc / Cloud Run IAM complexity.
 */
export const autoLinkOnRegister = functionsV1.firestore
  .document("users/{uid}")
  .onCreate(async (snap, context) => {
    const uid: string = context.params.uid
    const newUser = snap.data()

    if (!newUser?.email) {
      functionsV1.logger.info(`autoLinkOnRegister: uid ${uid} has no email, skipping.`)
      return
    }

    const email = (newUser.email as string).toLowerCase().trim()
    const db = getFirestore()

    const querySnap = await db
      .collectionGroup("contacts")
      .where("email", "==", email)
      .where("status", "==", "not_registered")
      .get()

    if (querySnap.empty) {
      functionsV1.logger.info(`autoLinkOnRegister: no unlinked contacts for ${email}`)
      return
    }

    const batch = db.batch()
    querySnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        linkedUserId: uid,
        status: "registered",
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    await batch.commit()
    functionsV1.logger.info(
      `autoLinkOnRegister: linked ${querySnap.size} contact(s) for ${email} → uid ${uid}`
    )
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
