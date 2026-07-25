import assert from "node:assert/strict"
import test from "node:test"
import { PDFDocument } from "pdf-lib"
import { sealAgreementPdf } from "../features/applications/agreement-pdf"
import { OPERATING_AGREEMENT_TEMPLATE } from "../lib/applications-core"

/** A 1x1 transparent PNG. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

test("seals a valid PDF that embeds the signature and opens", async () => {
  const bytes = await sealAgreementPdf({
    template: OPERATING_AGREEMENT_TEMPLATE,
    candidateName: "Benjamin Lopez",
    jobName: "RW Dake Construction",
    typedName: "Benjamin Lopez",
    signedAtIso: "2026-07-25T15:30:00.000Z",
    signaturePng: new Uint8Array(TINY_PNG),
  })

  assert.ok(bytes.byteLength > 800, "PDF should have real content")
  // %PDF- magic header.
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")

  // It must be a parseable PDF with at least one page.
  const reloaded = await PDFDocument.load(bytes)
  assert.ok(reloaded.getPageCount() >= 1)
})

test("non-Latin characters don't crash the standard fonts", async () => {
  const bytes = await sealAgreementPdf({
    template: OPERATING_AGREEMENT_TEMPLATE,
    candidateName: "José Ramírez",
    jobName: "Pine Ridge — Utilities",
    typedName: "José Ramírez",
    signedAtIso: "2026-07-25T15:30:00.000Z",
    signaturePng: new Uint8Array(TINY_PNG),
  })
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-")
})
