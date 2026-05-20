import { initializeApp } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
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
