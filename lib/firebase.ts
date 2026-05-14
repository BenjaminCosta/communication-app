import { initializeApp, getApps } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey: "AIzaSyAt2oVZ9ec3bc_b6QjCBn6ZZ-4IxgVpn8o",
  authDomain: "svc-comms.firebaseapp.com",
  projectId: "svc-comms",
  storageBucket: "svc-comms.firebasestorage.app",
  messagingSenderId: "56869436768",
  appId: "1:56869436768:web:c19a0c0d6825fc309af205",
  measurementId: "G-46JMV7LQCP",
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
