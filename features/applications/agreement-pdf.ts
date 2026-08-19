/**
 * Sealed operating-agreement PDF.
 *
 * Renders the exact agreement text the candidate accepted, the typed name, the
 * drawn signature and the server timestamp into a single document. Pure
 * pdf-lib + inputs so it runs on the server (and can be unit-tested).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib"
import type { AgreementTemplate } from "@/lib/applications-core"
import { formatDateTimeInAppZone } from "@/lib/datetime"

const PAGE = { width: 612, height: 792 } // US Letter, portrait
const MARGIN = 56
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const BLUE = rgb(0.145, 0.388, 0.921)
const LINE = rgb(0.78, 0.83, 0.89)

export interface SealAgreementInput {
  template: AgreementTemplate
  candidateName: string
  candidateTrade?: string | null
  candidateLocation?: string | null
  companyName?: string | null
  jobName: string
  typedName: string
  signedAtIso: string
  /** PNG bytes of the drawn signature. */
  signaturePng: Uint8Array
}

/** Only Latin-1 survives the standard PDF fonts; strip the rest. */
function ascii(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF]/g, "")
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

export async function sealAgreementPdf(input: SealAgreementInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(ascii(`${input.template.title} v${input.template.version} — ${input.candidateName}`))
  pdf.setProducer("SVC Applications")
  pdf.setCreator("SVC Applications")

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let signatureImage: PDFImage | null = null
  try {
    signatureImage = await pdf.embedPng(input.signaturePng)
  } catch {
    // The formal signature block below makes the missing image explicit.
  }

  let page = pdf.addPage([PAGE.width, PAGE.height])
  let y = PAGE.height - MARGIN

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = pdf.addPage([PAGE.width, PAGE.height])
      y = PAGE.height - MARGIN
    }
  }

  const drawText = (text: string, size: number, font: PDFFont, color = INK, gap = 4) => {
    for (const line of wrap(text, font, size, CONTENT_WIDTH)) {
      ensureSpace(size + gap)
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color })
      y -= size + gap
    }
  }

  const signedDate = new Date(input.signedAtIso)
  const dateLabel = Number.isNaN(signedDate.getTime())
    ? input.signedAtIso
    : formatDateTimeInAppZone(signedDate, { dateStyle: "long", timeStyle: "short" })

  const drawSignature = (maxWidth: number, maxHeight: number, caption: string) => {
    if (!signatureImage) {
      page.drawText("[signature image could not be embedded]", {
        x: MARGIN,
        y: y - 10,
        size: 10,
        font: regular,
        color: MUTED,
      })
      y -= 22
      return
    }

    const scale = Math.min(1, maxWidth / signatureImage.width, maxHeight / signatureImage.height)
    const width = signatureImage.width * scale
    const height = signatureImage.height * scale
    ensureSpace(height + 22)
    page.drawImage(signatureImage, { x: MARGIN, y: y - height, width, height })
    y -= height + 4
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + maxWidth, y }, thickness: 0.8, color: LINE })
    y -= 12
    page.drawText(caption, { x: MARGIN, y: y - 9, size: 9, font: regular, color: MUTED })
    y -= 13
  }

  // Header
  page.drawText(ascii(input.template.title), { x: MARGIN, y: y - 20, size: 20, font: bold, color: INK })
  y -= 30
  page.drawText(ascii(`Version ${input.template.version}  ·  ${input.jobName}`), {
    x: MARGIN,
    y: y - 11,
    size: 11,
    font: regular,
    color: MUTED,
  })
  y -= 26
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: LINE })
  y -= 22

  // This compact record is intentionally first: mobile PDF viewers frequently
  // open on page one, so a reviewer can verify the candidate and drawn
  // signature before scrolling through the full agreement text.
  page.drawText("Sealed candidate signature record", { x: MARGIN, y: y - 12, size: 12, font: bold, color: BLUE })
  y -= 23
  const candidateDetails = [
    ["Candidate", input.candidateName],
    ["Trade", input.candidateTrade],
    ["Job", input.jobName],
    ["Company", input.companyName],
    ["Location", input.candidateLocation],
    ["Signed by", input.typedName],
    ["Signed", dateLabel],
  ].filter(([, value]) => Boolean(value && value.trim())) as Array<[string, string]>
  for (const [label, value] of candidateDetails) {
    drawText(`${label}: ${value}`, 10.5, regular, label === "Signed by" ? INK : MUTED, 3)
  }
  y -= 4
  drawSignature(220, 70, "Candidate signature - sealed copy")
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: LINE })
  y -= 22

  drawText(input.template.intro, 11, regular, MUTED, 5)
  y -= 10

  for (const section of input.template.sections) {
    ensureSpace(30)
    y -= 6
    drawText(section.heading, 12, bold, INK, 5)
    drawText(section.body, 10.5, regular, INK, 4)
    y -= 6
  }

  // Signature block — always on its own footing.
  ensureSpace(170)
  y -= 14
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: LINE })
  y -= 24
  page.drawText("Electronic signature", { x: MARGIN, y: y - 13, size: 13, font: bold, color: BLUE })
  y -= 30

  page.drawText(ascii(`Signed by: ${input.typedName}`), { x: MARGIN, y: y - 11, size: 11, font: regular, color: INK })
  y -= 18
  page.drawText(ascii(`Date: ${dateLabel}`), { x: MARGIN, y: y - 11, size: 11, font: regular, color: INK })
  y -= 28

  drawSignature(220, 140, "Signature")

  return pdf.save()
}
