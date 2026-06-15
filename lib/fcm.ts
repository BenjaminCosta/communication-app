import { getMessaging, getToken, onMessage, type Messaging } from "firebase/messaging"
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore"
import { app, db } from "./firebase"

export type NotificationPreference = "instant" | "muted"

const VAPID_KEY =
  "BHFxtBJG1vuiizNVGHThybZkp_9u6-X3LIRpCatRDu4219KOeG3ay4XVtKNAKyvU_4E37n-xuxvXg39oQv4Td5c"

let _messaging: Messaging | null = null

function getMsg(): Messaging {
  if (!_messaging) _messaging = getMessaging(app)
  return _messaging
}

/**
 * Fetch the FCM token for this browser and save it to users/{userId}.fcmTokens.
 * Assumes notification permission is already granted.
 */
export async function registerFCMToken(userId: string): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.ready
    const token = await getToken(getMsg(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })
    if (token) {
      await updateDoc(doc(db, "users", userId), { fcmTokens: arrayUnion(token) })
    }
    return token ?? null
  } catch (e) {
    console.warn("[FCM] getToken failed:", e)
    return null
  }
}

/**
 * Ask for notification permission; if granted, register the FCM token.
 */
export async function requestNotificationPermission(
  userId: string
): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied"
  const permission = await Notification.requestPermission()
  if (permission === "granted") {
    await registerFCMToken(userId)
  }
  return permission
}

/**
 * Remove one FCM token from the user doc (e.g. on explicit opt-out or SW change).
 */
export async function removeFCMToken(userId: string, token: string): Promise<void> {
  await updateDoc(doc(db, "users", userId), { fcmTokens: arrayRemove(token) })
}

/**
 * Listen for foreground FCM messages (app is in focus).
 * Shows a notification if the app is open. Returns unsubscribe function.
 */
export function onForegroundMessage(
  callback: (title: string, body: string) => void
): () => void {
  if (typeof window === "undefined") return () => {}
  return onMessage(getMsg(), (payload) => {
    callback(
      payload.notification?.title ?? "SVC",
      payload.notification?.body ?? "New message"
    )
  })
}
