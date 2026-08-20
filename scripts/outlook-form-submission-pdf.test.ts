import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { createOutlookFormSubmissionPdf } from "../lib/outlook-form-submissions/pdf"

test("exports a parseable outlook form submission PDF with tasks and notes", async () => {
  const bytes = await createOutlookFormSubmissionPdf({
    generatedAtIso: "2026-08-20T15:30:00.000Z",
    jobName: "Appaloosa",
    submittedByName: "John Smith",
    submittedByPhone: "(555) 123-4567",
    submittedByCompany: "74 Construction",
    submittedByRole: "site_super",
    submittedAtIso: "2026-08-20T12:00:00.000Z",
    window: { start: "2026-08-17", end: "2026-09-06" },
    tasks: [
      {
        title: "Framing second floor",
        trade: "Carpentry",
        companyName: "74 Construction",
        startDate: "2026-08-18",
        durationDays: 5,
        description: "Needs crane access Tuesday.",
      },
    ],
    generalNotes: "Material delivery delayed a day.",
    status: "new",
  })

  assert.ok(bytes.length > 0)
  const doc = await PDFDocument.load(bytes)
  assert.equal(doc.getPageCount() >= 1, true)
})

test("exports a valid PDF even with no tasks and no notes", async () => {
  const bytes = await createOutlookFormSubmissionPdf({
    generatedAtIso: "2026-08-20T15:30:00.000Z",
    jobName: "Warehouse Expansion",
    submittedByName: "",
    submittedByPhone: "",
    submittedByCompany: "",
    submittedByRole: "pm",
    submittedAtIso: "2026-08-20T12:00:00.000Z",
    window: { start: "2026-08-17", end: "2026-09-06" },
    tasks: [],
    generalNotes: "",
    status: "reviewed",
  })

  assert.ok(bytes.length > 0)
  const doc = await PDFDocument.load(bytes)
  assert.equal(doc.getPageCount() >= 1, true)
})
