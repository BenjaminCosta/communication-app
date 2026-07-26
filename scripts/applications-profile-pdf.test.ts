import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { createApplicationProfilePdf } from "../features/applications/application-profile-pdf"

test("exports a parseable candidate profile PDF with a multipage transcript", async () => {
  const bytes = await createApplicationProfilePdf({
    generatedAtIso: "2026-07-26T15:30:00.000Z",
    candidate: {
      name: "Benjamin Lopez",
      trade: "Carpenter",
      status: "hired",
      submittedAt: "2026-07-21T15:30:00.000Z",
      createdAt: "2026-07-20T15:30:00.000Z",
    },
    job: { name: "RW Dake Construction", location: "Morrow, GA", companyName: "RW Dake Construction" },
    application: {
      fullName: "Benjamin Lopez",
      phone: "(770) 555-0142",
      email: "benjamin.lopez@example.com",
      cityState: "Morrow, GA",
      yearsExperience: "6",
      primaryTrade: "Carpenter",
      resumeFileName: "benjamin-lopez-resume.pdf",
      workReference: "Maria Garcia, project manager",
    },
    video: {
      state: "ready",
      source: "record",
      fileName: "intro-video.mp4",
      durationSeconds: 62,
      capturedAt: "2026-07-21T15:30:00.000Z",
      transcript: Array.from({ length: 90 }, (_, index) => `Transcript sentence ${index + 1} about construction experience and jobsite safety.`).join(" "),
      summary: "Experienced carpenter with framing and commercial construction experience.",
    },
    documents: [
      {
        label: "Driver's license",
        status: "verified",
        required: true,
        fileName: "drivers-license.jpg",
        uploadedAt: "2026-07-21T15:30:00.000Z",
        helper: "Front side, clearly readable.",
      },
    ],
    agreement: {
      status: "signed",
      sentAt: "2026-07-22T15:30:00.000Z",
      expiresAt: "2026-07-25T15:30:00.000Z",
      signedAt: "2026-07-23T15:30:00.000Z",
      signedName: "Benjamin Lopez",
      signedVersion: "1.0",
    },
    activity: [{ actor: "Benjamin Lopez", message: "Signed the operating agreement", at: "2026-07-23T15:30:00.000Z" }],
  })

  assert.ok(bytes.byteLength > 3_000, "profile export should contain substantive content")
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")
  const reloaded = await PDFDocument.load(bytes)
  assert.ok(reloaded.getPageCount() >= 2, "a long transcript should paginate")
})
