/**
 * Candidate application export PDF.
 *
 * This module deliberately only accepts plain data. The API route is
 * responsible for authorization and reading Firestore; keeping rendering pure
 * lets us verify the exported record without an Admin SDK or a browser.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

const PAGE = { width: 612, height: 792 } // US Letter, portrait
const MARGIN = 48
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const BLUE = rgb(0.145, 0.388, 0.921)
const GREEN = rgb(0.08, 0.5, 0.24)
const AMBER = rgb(0.71, 0.33, 0.04)
const CORAL = rgb(0.79, 0.2, 0.2)
const LINE = rgb(0.82, 0.86, 0.91)
const SOFT_BLUE = rgb(0.94, 0.97, 1)

export interface ApplicationProfilePdfDocument {
  label: string
  status: string
  required: boolean
  fileName: string | null
  uploadedAt: string | null
  helper: string | null
}

export interface ApplicationProfilePdfActivity {
  actor: string
  message: string
  at: string | null
}

export interface ApplicationProfilePdfInput {
  generatedAtIso: string
  candidate: {
    name: string
    trade: string
    status: string
    submittedAt: string | null
    createdAt: string | null
  }
  job: {
    name: string
    location: string
    companyName: string
  }
  application: {
    fullName: string
    phone: string
    email: string
    cityState: string
    yearsExperience: string
    primaryTrade: string
    resumeFileName: string | null
    workReference: string | null
  }
  video: {
    state: string
    source: string | null
    fileName: string | null
    durationSeconds: number | null
    capturedAt: string | null
    transcript: string | null
    summary: string | null
  }
  documents: ApplicationProfilePdfDocument[]
  agreement: {
    status: string
    sentAt: string | null
    expiresAt: string | null
    signedAt: string | null
    signedName: string | null
    signedVersion: string | null
  }
  activity: ApplicationProfilePdfActivity[]
}

/** Only Latin-1 survives the standard PDF fonts; strip unsupported glyphs. */
function ascii(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF]/g, "")
}

function present(value: string | null | undefined, fallback = "Not provided"): string {
  return value?.trim() || fallback
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Not provided"
}

function dateLabel(value: string | null): string {
  if (!value) return "Not provided"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}

function durationLabel(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "Not provided"
  const wholeSeconds = Math.round(seconds)
  return `${Math.floor(wholeSeconds / 60)}m ${String(wholeSeconds % 60).padStart(2, "0")}s`
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]

  const lines: string[] = []
  let line = ""
  const splitLongWord = (word: string) => {
    let chunk = ""
    for (const character of word) {
      if (font.widthOfTextAtSize(`${chunk}${character}`, size) > maxWidth && chunk) {
        lines.push(chunk)
        chunk = character
      } else {
        chunk += character
      }
    }
    return chunk
  }

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = font.widthOfTextAtSize(word, size) > maxWidth ? splitLongWord(word) : word
  }
  if (line) lines.push(line)
  return lines
}

function statusColor(status: string) {
  const normalized = status.toLowerCase()
  if (normalized.includes("hired") || normalized.includes("signed") || normalized.includes("verified") || normalized.includes("uploaded")) return GREEN
  if (normalized.includes("missing") || normalized.includes("expired")) return CORAL
  if (normalized.includes("pending") || normalized.includes("awaiting")) return AMBER
  return BLUE
}

/** Render the entire internal profile, including the reviewer-visible video transcript. */
export async function createApplicationProfilePdf(input: ApplicationProfilePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(ascii(`${present(input.candidate.name, "Candidate")} - SVC application`))
  pdf.setAuthor("SVC Applications")
  pdf.setCreator("SVC Applications")
  pdf.setProducer("SVC Applications")

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page!: PDFPage
  let y = 0

  const startPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height])
    y = PAGE.height - MARGIN
    page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_WIDTH, height: 32, color: SOFT_BLUE })
    page.drawText("SVC APPLICATIONS", { x: MARGIN + 12, y: y - 20, size: 10, font: bold, color: BLUE })
    page.drawText("Candidate application profile", { x: MARGIN + 120, y: y - 20, size: 10, font: regular, color: INK })
    y -= 50
  }

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 32) startPage()
  }

  const paragraph = (text: string, size = 10, font: PDFFont = regular, color = INK, gap = 4) => {
    for (const line of wrap(text, font, size, CONTENT_WIDTH)) {
      ensureSpace(size + gap)
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color })
      y -= size + gap
    }
  }

  const section = (title: string, detail?: string) => {
    ensureSpace(detail ? 52 : 34)
    y -= 4
    page.drawText(ascii(title), { x: MARGIN, y: y - 13, size: 13, font: bold, color: INK })
    y -= 21
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.8, color: LINE })
    y -= 12
    if (detail) {
      paragraph(detail, 9, regular, MUTED, 3)
      y -= 4
    }
  }

  const field = (label: string, value: string | null | undefined) => {
    paragraph(`${label}: ${present(value)}`, 9.5, regular, INK, 4)
  }

  startPage()
  page.drawText(ascii(present(input.candidate.name, "Candidate")), { x: MARGIN, y: y - 24, size: 22, font: bold, color: INK })
  y -= 34
  page.drawText(ascii(`${present(input.candidate.trade, "Trade not set")} | ${present(input.job.name, "Job not set")}`), {
    x: MARGIN,
    y: y - 11,
    size: 11,
    font: regular,
    color: MUTED,
  })
  y -= 25
  page.drawRectangle({ x: MARGIN, y: y - 27, width: CONTENT_WIDTH, height: 27, color: SOFT_BLUE })
  page.drawText(`Status: ${titleCase(input.candidate.status)}`, { x: MARGIN + 10, y: y - 17, size: 10, font: bold, color: statusColor(input.candidate.status) })
  y -= 43
  paragraph(`Exported ${dateLabel(input.generatedAtIso)}. This reviewer-only export contains candidate-provided information and should be handled according to SVC's PII policy.`, 9, regular, MUTED, 4)

  section("Candidate and job")
  field("Candidate", input.candidate.name)
  field("Trade", input.candidate.trade)
  field("Status", titleCase(input.candidate.status))
  field("Linked job", input.job.name)
  field("Company", input.job.companyName)
  field("Job location", input.job.location)
  field("Application started", dateLabel(input.candidate.createdAt))
  field("Application submitted", dateLabel(input.candidate.submittedAt))

  section("Application information")
  field("Full name", input.application.fullName)
  field("Phone", input.application.phone)
  field("Email", input.application.email)
  field("City and state", input.application.cityState)
  field("Years of experience", input.application.yearsExperience)
  field("Primary trade", input.application.primaryTrade)
  field("Resume", input.application.resumeFileName)
  field("Work reference", input.application.workReference)

  section("Documents", input.documents.length ? "File names are included for review. Use the dashboard to open the original upload." : "No document checklist is available yet.")
  if (input.documents.length === 0) {
    paragraph("No documents were requested.", 9.5, regular, MUTED)
  }
  for (const document of input.documents) {
    const details = [
      `Status: ${titleCase(document.status)}`,
      document.required ? "Required" : "Not required",
      `File: ${present(document.fileName)}`,
      `Uploaded: ${dateLabel(document.uploadedAt)}`,
      document.helper?.trim() ? `Note: ${document.helper.trim()}` : null,
    ].filter(Boolean)
    ensureSpace(36)
    paragraph(document.label || "Untitled document", 10, bold, INK, 3)
    paragraph(details.join(" | "), 9, regular, statusColor(document.status), 6)
  }

  section("Intro video")
  field("Video status", titleCase(input.video.state))
  field("Source", input.video.source ? titleCase(input.video.source) : null)
  field("File", input.video.fileName)
  field("Duration", durationLabel(input.video.durationSeconds))
  field("Captured", dateLabel(input.video.capturedAt))
  if (input.video.summary?.trim()) {
    paragraph("AI video summary", 10, bold, rgb(0.43, 0.24, 0.88), 3)
    paragraph(input.video.summary, 9.5, regular, rgb(0.32, 0.2, 0.63), 7)
  }
  paragraph("Video transcript", 10, bold, INK, 3)
  paragraph(input.video.transcript?.trim() || "Transcript not available yet.", 9.5, regular, INK, 5)

  section("Operating agreement")
  field("Agreement status", titleCase(input.agreement.status))
  field("Sent", dateLabel(input.agreement.sentAt))
  field("Signing deadline", dateLabel(input.agreement.expiresAt))
  field("Signed", dateLabel(input.agreement.signedAt))
  field("Signed by", input.agreement.signedName)
  field("Signed version", input.agreement.signedVersion)

  section("Activity timeline")
  if (input.activity.length === 0) {
    paragraph("No activity has been recorded yet.", 9.5, regular, MUTED)
  }
  for (const event of input.activity) {
    ensureSpace(32)
    paragraph(`${dateLabel(event.at)} - ${present(event.actor, "Someone")}`, 9, bold, BLUE, 2)
    paragraph(present(event.message), 9.5, regular, INK, 6)
  }

  const pages = pdf.getPages()
  pages.forEach((footerPage, index) => {
    footerPage.drawLine({
      start: { x: MARGIN, y: MARGIN - 8 },
      end: { x: PAGE.width - MARGIN, y: MARGIN - 8 },
      thickness: 0.7,
      color: LINE,
    })
    footerPage.drawText("SVC Applications - Confidential candidate profile", {
      x: MARGIN,
      y: MARGIN - 23,
      size: 8,
      font: regular,
      color: MUTED,
    })
    const pageLabel = `Page ${index + 1} of ${pages.length}`
    footerPage.drawText(pageLabel, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(pageLabel, 8),
      y: MARGIN - 23,
      size: 8,
      font: regular,
      color: MUTED,
    })
  })

  return pdf.save()
}
