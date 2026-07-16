import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import * as functionsV1 from "firebase-functions/v1"
import { chunkValues, mapWithConcurrency } from "../shared/batches"

const USER_READ_CONCURRENCY = 50
const FIRESTORE_BATCH_SIZE = 450

/**
 * Sends push notifications to message recipients, respecting preferences and
 * removing invalid tokens. Multicast calls are capped at FCM's 500-token limit.
 */
export async function sendNotificationsToUsers(
  db: Firestore,
  recipientIds: string[],
  senderId: string,
  messageId: string,
  body: string,
): Promise<void> {
  const toNotify = [...new Set(recipientIds.filter((uid) => uid && uid !== senderId))]
  if (toNotify.length === 0) return

  const [senderSnap, userSnaps] = await Promise.all([
    db.collection("users").doc(senderId).get(),
    mapWithConcurrency(toNotify, USER_READ_CONCURRENCY, (uid) =>
      db.collection("users").doc(uid).get(),
    ),
  ])
  const senderName: string = senderSnap.data()?.name ?? "Someone"
  const tokens = new Set<string>()
  const tokenToUids = new Map<string, Set<string>>()

  userSnaps.forEach((snapshot, index) => {
    const userData = snapshot.data()
    if (!userData || (userData.notificationPreference ?? "instant") === "muted") return
    const userTokens: string[] = Array.isArray(userData.fcmTokens) ? userData.fcmTokens : []
    for (const token of userTokens) {
      if (!token) continue
      tokens.add(token)
      const tokenUids = tokenToUids.get(token) ?? new Set<string>()
      tokenUids.add(toNotify[index])
      tokenToUids.set(token, tokenUids)
    }
  })
  if (tokens.size === 0) return

  let successCount = 0
  let failureCount = 0
  const staleTokens: string[] = []

  for (const tokenBatch of chunkValues([...tokens], 500)) {
    const result = await getMessaging().sendEachForMulticast({
      tokens: tokenBatch,
      notification: { title: senderName, body },
      webpush: {
        notification: {
          icon: "https://svc-comms.web.app/icon-192x192.png",
          badge: "https://svc-comms.web.app/icon-192x192.png",
        },
        fcmOptions: { link: "/" },
      },
      data: { messageId },
    })

    successCount += result.successCount
    failureCount += result.failureCount
    result.responses.forEach((response, index) => {
      if (
        !response.success &&
        (response.error?.code === "messaging/invalid-registration-token" ||
          response.error?.code === "messaging/registration-token-not-registered")
      ) {
        staleTokens.push(tokenBatch[index])
      }
    })
  }

  functionsV1.logger.info(`[FCM] msg=${messageId} sent=${successCount} failed=${failureCount}`)

  if (staleTokens.length > 0) {
    const staleTokensByUid = new Map<string, Set<string>>()
    for (const token of staleTokens) {
      for (const uid of tokenToUids.get(token) ?? []) {
        const userTokens = staleTokensByUid.get(uid) ?? new Set<string>()
        userTokens.add(token)
        staleTokensByUid.set(uid, userTokens)
      }
    }

    for (const userBatch of chunkValues([...staleTokensByUid.entries()], FIRESTORE_BATCH_SIZE)) {
      const batch = db.batch()
      for (const [uid, userTokens] of userBatch) {
        batch.update(db.collection("users").doc(uid), {
          fcmTokens: FieldValue.arrayRemove(...userTokens),
        })
      }
      await batch.commit()
    }
    functionsV1.logger.info(`[FCM] Removed ${staleTokens.length} stale token(s)`)
  }
}

export const onMessageCreated = functionsV1.firestore
  .document("messages/{messageId}")
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data()
    const senderId: string = data.senderId ?? data.authorId ?? ""
    const visibleToUserIds: string[] = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : []
    if (!senderId || visibleToUserIds.length === 0) return

    await sendNotificationsToUsers(
      getFirestore(),
      visibleToUserIds,
      senderId,
      context.params.messageId,
      "New message",
    )
  })

export const onMessageUpdated = functionsV1.firestore
  .document("messages/{messageId}")
  .onUpdate(async (change, context) => {
    const before: string[] = Array.isArray(change.before.data().visibleToUserIds)
      ? change.before.data().visibleToUserIds
      : []
    const after: string[] = Array.isArray(change.after.data().visibleToUserIds)
      ? change.after.data().visibleToUserIds
      : []
    const beforeLinkRunId = change.before.data().importedContactLinkRunId
    const afterLinkRunId = change.after.data().importedContactLinkRunId
    if (typeof afterLinkRunId === "string" && afterLinkRunId && afterLinkRunId !== beforeLinkRunId) {
      functionsV1.logger.info(
        `[onMessageUpdated] msg=${context.params.messageId} skipped imported-contact-link notification`,
      )
      return
    }

    const beforeSet = new Set(before)
    const newlyAdded = after.filter((uid) => !beforeSet.has(uid))
    if (newlyAdded.length === 0) return
    const senderId: string = change.after.data().senderId ?? change.after.data().authorId ?? ""
    if (!senderId) return

    functionsV1.logger.info(
      `[onMessageUpdated] msg=${context.params.messageId} newlyAdded=${newlyAdded.join(",")}`,
    )
    await sendNotificationsToUsers(
      getFirestore(),
      newlyAdded,
      senderId,
      context.params.messageId,
      "New message",
    )
  })
