/**
 * Daily report PDF.
 *
 * Pure pdf-lib + inputs so it runs on the server (and can be unit-tested),
 * mirroring the drawing style of `features/applications/agreement-pdf.ts`
 * and `features/outlooks/pdf/generate-outlook-pdf.ts`: hand-drawn text with
 * pdf-lib, no HTML/CSS-to-PDF step.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import type { DailyReportStructuredData } from "@/lib/bye-bye-dpr-core"

const PAGE = { width: 612, height: 792 } // US Letter, portrait
const MARGIN = 56
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const BLUE = rgb(0.145, 0.388, 0.921)
const LINE = rgb(0.78, 0.83, 0.89)

export interface GenerateDailyReportPdfInput {
  companyName: string
  jobName: string
  authorName: string
  createdAtIso: string
  submittedAtIso: string | null
  structuredData: DailyReportStructuredData
  rawText: string | null
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

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })
}

const FIELD_LABELS: Array<{ key: keyof DailyReportStructuredData; label: string }> = [
  { key: "workCompleted", label: "Work Completed" },
  { key: "issuesOrDelays", label: "Issues / Delays" },
  { key: "nextSteps", label: "Next Steps" },
]

export async function generateDailyReportPdf(input: GenerateDailyReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(ascii(`Daily Report — ${input.jobName}`))
  pdf.setProducer("ByeByeDPR")
  pdf.setCreator("ByeByeDPR")

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

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

  // Header
  page.drawText("Daily Report", { x: MARGIN, y: y - 20, size: 20, font: bold, color: INK })
  y -= 30
  page.drawText(ascii(`${input.jobName}  ·  ${input.companyName}`), {
    x: MARGIN,
    y: y - 11,
    size: 11,
    font: regular,
    color: MUTED,
  })
  y -= 26
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: LINE })
  y -= 22

  const meta: Array<[string, string]> = [
    ["Submitted by", input.authorName],
    ["Created", formatDate(input.createdAtIso)],
    ["Submitted", formatDate(input.submittedAtIso)],
  ]
  for (const [label, value] of meta) {
    drawText(`${label}: ${value}`, 10.5, regular, MUTED, 3)
  }
  y -= 10

  for (const field of FIELD_LABELS) {
    const value = input.structuredData[field.key]
    if (!value?.trim()) continue
    ensureSpace(30)
    y -= 6
    drawText(field.label, 12, bold, BLUE, 5)
    drawText(value, 10.5, regular, INK, 4)
    y -= 6
  }

  if (input.rawText && input.rawText.trim()) {
    ensureSpace(40)
    y -= 10
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 1, color: LINE })
    y -= 20
    drawText("Original note", 11, bold, MUTED, 5)
    drawText(input.rawText, 9.5, regular, MUTED, 3)
  }

  return pdf.save()
}
