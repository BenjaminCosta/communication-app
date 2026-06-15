import { initializeApp } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import * as functionsV1 from "firebase-functions/v1"

initializeApp()

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
 * Triggered whenever a new message is created in /messages/{messageId}.
 * Sends FCM push notifications to all users in visibleToUserIds except the sender.
 * Respects each user's notificationPreference ("instant" | "muted").
 * Notification title is the sender's display name; body is generic (no message content).
 * Cleans up invalid/expired FCM tokens automatically.
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

    // Notify everyone in visibleToUserIds except the author
    const recipientIds = visibleToUserIds.filter((uid) => uid !== senderId)
    if (recipientIds.length === 0) return

    const db = getFirestore()

    // Fetch sender's display name
    const senderSnap = await db.collection("users").doc(senderId).get()
    const senderName: string = senderSnap.data()?.name ?? "Someone"

    // Collect valid FCM tokens, skipping muted users
    // tokenToUid lets us remove invalid tokens afterwards
    const tokens: string[] = []
    const tokenToUid = new Map<string, string>()

    await Promise.all(
      recipientIds.map(async (uid) => {
        const userSnap = await db.collection("users").doc(uid).get()
        const userData = userSnap.data()
        if (!userData) return

        const pref: string = userData.notificationPreference ?? "instant"
        if (pref === "muted") return

        const fcmTokens: string[] = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : []
        for (const token of fcmTokens) {
          tokens.push(token)
          tokenToUid.set(token, uid)
        }
      })
    )

    if (tokens.length === 0) return

    // Send — title = sender name, body = generic (no message content exposed)
    const result = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: senderName,
        body: "Sent you a message",
      },
      webpush: {
        notification: {
          icon : "https://svc-comms.web.app/icon-192x192.png",
          badge: "https://svc-comms.web.app/icon-192x192.png",
        },
        fcmOptions: { link: "/" },
      },
      data: {
        messageId: context.params.messageId,
      },
    })

    functionsV1.logger.info(
      `[onMessageCreated] msg=${context.params.messageId} sent=${result.successCount} failed=${result.failureCount}`
    )

    // Clean up stale / invalid tokens
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
      functionsV1.logger.info(
        `[onMessageCreated] Removed ${staleTokens.length} stale token(s)`
      )
    }
  })
