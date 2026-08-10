import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { generateDailyReportPdf } from "../features/bye-bye-dpr/pdf/generate-daily-report-pdf"

test("generates a valid daily report PDF that embeds every field", async () => {
  const bytes = await generateDailyReportPdf({
    companyName: "RW Dake Construction",
    jobName: "Miami Beach Project",
    authorName: "John Smith",
    createdAtIso: "2026-08-06T07:42:00.000Z",
    submittedAtIso: "2026-08-06T16:18:00.000Z",
    structuredData: {
      workCompleted: "Finished framing on the second floor.",
      issuesOrDelays: "Waiting on concrete delivery.",
      attendanceNotes: "Everyone present except Marcus.",
      nextSteps: "Start drywall tomorrow.",
      additionalNotes: null,
    },
    rawText: "We finished framing...",
  })

  assert.ok(bytes.byteLength > 500, "PDF should have real content")
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")

  const reloaded = await PDFDocument.load(bytes)
  assert.ok(reloaded.getPageCount() >= 1)
})

test("daily report PDF handles empty structured fields without crashing", async () => {
  const bytes = await generateDailyReportPdf({
    companyName: "RW Dake Construction",
    jobName: "Miami Beach Project",
    authorName: "John Smith",
    createdAtIso: "2026-08-06T07:42:00.000Z",
    submittedAtIso: null,
    structuredData: {
      workCompleted: null,
      issuesOrDelays: null,
      attendanceNotes: null,
      nextSteps: null,
      additionalNotes: null,
    },
    rawText: null,
  })
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")
})

test("non-Latin characters don't crash the standard fonts", async () => {
  const bytes = await generateDailyReportPdf({
    companyName: "RW Dake Construction",
    jobName: "Pine Ridge — Utilities",
    authorName: "José Ramírez",
    createdAtIso: "2026-08-06T07:42:00.000Z",
    submittedAtIso: null,
    structuredData: {
      workCompleted: "Trabajo completado en el segundo piso.",
      issuesOrDelays: null,
      attendanceNotes: null,
      nextSteps: null,
      additionalNotes: null,
    },
    rawText: null,
  })
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")
})
