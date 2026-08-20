/**
 * 3-Week Outlook form submission PDF — a convenience export for Courtney
 * Roberts Center reviewers, not the source of truth (the Firestore doc is).
 * Deliberately only accepts plain data, same discipline as
 * features/applications/application-profile-pdf.ts: keeps rendering pure and
 * testable without an Admin SDK or a browser.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { formatOutlookDate } from "@/lib/outlook-core"
import { formatDateTimeInAppZone } from "@/lib/datetime"

const PAGE = { width: 612, height: 792 } // US Letter, portrait
const MARGIN = 48
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const GREEN = rgb(0.08, 0.5, 0.24)
const AMBER = rgb(0.71, 0.33, 0.04)
const LINE = rgb(0.82, 0.86, 0.91)
const SOFT_GREEN = rgb(0.91, 0.97, 0.93)

export interface OutlookFormSubmissionPdfTask {
  title: string
  trade: string
  companyName: string
  startDate: string | null
  durationDays: number
  description: string
}

export interface OutlookFormSubmissionPdfInput {
  generatedAtIso: string
  jobName: string
  submittedByName: string
  submittedByPhone: string
  submittedByCompany: string
  submittedByRole: string
  submittedAtIso: string
  window: { start: string; end: string }
  tasks: OutlookFormSubmissionPdfTask[]
  generalNotes: string
  status: string
}

/** Only Latin-1 survives the standard PDF fonts; strip unsupported glyphs. */
function ascii(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\x00-\xFF]/g, "")
}

function present(value: string | null | undefined, fallback = "Not provided"): string {
  return value?.trim() || fallback
}

function dateLabel(value: string | null): string {
  if (!value) return "Not provided"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : formatDateTimeInAppZone(date, { dateStyle: "medium", timeStyle: "short" })
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = ascii(text).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]

  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

export async function createOutlookFormSubmissionPdf(input: OutlookFormSubmissionPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(ascii(`${present(input.jobName, "Job")} - 3-Week Outlook form submission`))
  pdf.setAuthor("SVC Courtney Roberts Center")
  pdf.setCreator("SVC Courtney Roberts Center")
  pdf.setProducer("SVC Courtney Roberts Center")

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page!: PDFPage
  let y = 0

  const startPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height])
    y = PAGE.height - MARGIN
    page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_WIDTH, height: 32, color: SOFT_GREEN })
    page.drawText("COURTNEY ROBERTS CENTER", { x: MARGIN + 12, y: y - 20, size: 10, font: bold, color: GREEN })
    page.drawText("3-Week Outlook form submission", { x: MARGIN + 175, y: y - 20, size: 10, font: regular, color: INK })
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

  const section = (title: string) => {
    ensureSpace(34)
    y -= 4
    page.drawText(ascii(title), { x: MARGIN, y: y - 13, size: 13, font: bold, color: INK })
    y -= 21
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.8, color: LINE })
    y -= 12
  }

  const field = (label: string, value: string | null | undefined) => {
    paragraph(`${label}: ${present(value)}`, 9.5, regular, INK, 4)
  }

  startPage()
  page.drawText(ascii(present(input.jobName, "Job")), { x: MARGIN, y: y - 24, size: 22, font: bold, color: INK })
  y -= 34
  page.drawText(ascii(`Submitted by ${present(input.submittedByName, "Unknown")} - ${dateLabel(input.submittedAtIso)}`), {
    x: MARGIN,
    y: y - 11,
    size: 11,
    font: regular,
    color: MUTED,
  })
  y -= 25
  page.drawRectangle({ x: MARGIN, y: y - 27, width: CONTENT_WIDTH, height: 27, color: input.status === "reviewed" ? SOFT_GREEN : rgb(1, 0.96, 0.87) })
  page.drawText(`Status: ${input.status === "reviewed" ? "Reviewed" : "New"}`, {
    x: MARGIN + 10,
    y: y - 17,
    size: 10,
    font: bold,
    color: input.status === "reviewed" ? GREEN : AMBER,
  })
  y -= 43
  paragraph(`Exported ${dateLabel(input.generatedAtIso)}.`, 9, regular, MUTED, 4)

  section("Window")
  field("Week starting", formatOutlookDate(input.window.start, { month: "long", day: "numeric", year: "numeric" }))
  field("Week ending", formatOutlookDate(input.window.end, { month: "long", day: "numeric", year: "numeric" }))
  field("Submitted by (role)", present(input.submittedByRole))
  field("Phone", present(input.submittedByPhone))
  field("Company", present(input.submittedByCompany))

  section("Tasks")
  if (input.tasks.length === 0) {
    paragraph("No tasks were listed.", 9.5, regular, MUTED)
  }
  for (const task of input.tasks) {
    ensureSpace(48)
    paragraph(task.title || "Untitled task", 10, bold, INK, 3)
    const details = [
      task.trade ? `Trade: ${task.trade}` : null,
      task.companyName ? `Company: ${task.companyName}` : null,
      task.startDate ? `Start: ${formatOutlookDate(task.startDate)}` : null,
      `Duration: ${task.durationDays} day(s)`,
    ].filter(Boolean)
    paragraph(details.join("  |  "), 9, regular, MUTED, task.description ? 3 : 8)
    if (task.description) paragraph(task.description, 9, regular, INK, 8)
  }

  section("Notes / issues")
  paragraph(input.generalNotes.trim() || "No additional notes.", 9.5, regular, INK, 5)

  const pages = pdf.getPages()
  pages.forEach((footerPage, index) => {
    footerPage.drawLine({ start: { x: MARGIN, y: MARGIN - 8 }, end: { x: PAGE.width - MARGIN, y: MARGIN - 8 }, thickness: 0.7, color: LINE })
    footerPage.drawText("SVC Courtney Roberts Center - Outlook form submission", {
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
