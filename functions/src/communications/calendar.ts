import { FieldValue, getFirestore } from "firebase-admin/firestore"
import * as functionsV1 from "firebase-functions/v1"
import { mapWithConcurrency } from "../shared/batches"
import { sendNotificationsToUsers } from "./notifications"
import { todayIsoInAppZone } from "../datetime"

export const onDailyCalendarReminders = functionsV1.pubsub
  .schedule("0 8 * * *")
  .timeZone("America/New_York")
  .onRun(async () => {
    const today = todayIsoInAppZone()
    const db = getFirestore()
    const snapshot = await db
      .collection("messages")
      .where("calendarDateStrings", "array-contains", today)
      .get()

    if (snapshot.empty) {
      functionsV1.logger.info(`[calendarReminders] ${today}: no messages`)
      return
    }

    let notified = 0
    let skipped = 0
    await mapWithConcurrency(snapshot.docs, 20, async (messageDocument) => {
      const data = messageDocument.data()
      const alreadySent: string[] = Array.isArray(data.reminderSentDates) ? data.reminderSentDates : []
      if (alreadySent.includes(today)) {
        skipped += 1
        return
      }

      const senderId: string = data.senderId ?? data.authorId ?? ""
      const visibleToUserIds: string[] = Array.isArray(data.visibleToUserIds) ? data.visibleToUserIds : []
      if (!senderId || visibleToUserIds.length === 0) return

      await sendNotificationsToUsers(
        db,
        visibleToUserIds,
        senderId,
        messageDocument.id,
        "You have a message scheduled for today",
      )
      await messageDocument.ref.update({ reminderSentDates: FieldValue.arrayUnion(today) })
      notified += 1
    })

    functionsV1.logger.info(`[calendarReminders] ${today}: notified=${notified} skipped=${skipped}`)
  })
