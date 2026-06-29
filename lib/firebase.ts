import { initializeApp, getApps } from "firebase/app"
import { getAuth, connectAuthEmulator } from "firebase/auth"
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore"
import { getStorage } from "firebase/storage"
import { getFunctions, connectFunctionsEmulator } from "firebase/functions"

const firebaseConfig = {
  apiKey: "AIzaSyAt2oVZ9ec3bc_b6QjCBn6ZZ-4IxgVpn8o",
  authDomain: "svc-comms.firebaseapp.com",
  projectId: "svc-comms",
  storageBucket: "svc-comms.firebasestorage.app",
  messagingSenderId: "56869436768",
  appId: "1:56869436768:web:c19a0c0d6825fc309af205",
  measurementId: "G-46JMV7LQCP",
}

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})
export const storage = getStorage(app)
export const functions = getFunctions(app)

// Connect to Firebase Emulators only when NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.
// typeof window check prevents SSR issues (emulators are browser-only).
// __EMULATORS_INITIALIZED__ guard prevents double-connecting on hot-reload.
// If the env var is NOT set, everything works exactly as before (production).
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (!w.__EMULATORS_INITIALIZED__) {
    w.__EMULATORS_INITIALIZED__ = true
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true })
    connectFirestoreEmulator(db, "localhost", 8080)
    connectFunctionsEmulator(functions, "localhost", 5001)
    console.info("[Emulator] Connected to Firebase Emulators — Auth :9099, Firestore :8080, Functions :5001")
  }
}
