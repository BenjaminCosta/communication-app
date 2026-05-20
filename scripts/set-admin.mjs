// scripts/set-admin.mjs
// Sets isAdmin: true on the Firestore /users/{uid} document for a given email.
// Usage: node scripts/set-admin.mjs
//
// Requires service-account.json in the project root.

import { initializeApp, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(
  readFileSync(resolve(__dirname, "../service-account.json"), "utf8")
)

initializeApp({ credential: cert(serviceAccount) })

const ADMIN_EMAIL = "benjacostm100@gmail.com"

const auth = getAuth()
const db = getFirestore()

const user = await auth.getUserByEmail(ADMIN_EMAIL)
console.log(`Found user: ${user.displayName ?? user.email} (${user.uid})`)

await db.doc(`users/${user.uid}`).set({ isAdmin: true }, { merge: true })
console.log(`✅ isAdmin: true set on users/${user.uid}`)
