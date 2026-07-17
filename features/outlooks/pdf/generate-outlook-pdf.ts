import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib"
import {
  formatOutlookDate,
  formatOutlookRange,
  outlookDates,
  taskStatusLabel,
  type OutlookTask,
  type OutlookWindow,
} from "@/lib/outlook-core"

export interface GenerateOutlookPdfInput {
  jobName: string
  companyName?: string | null
  location?: string | null
  window: OutlookWindow
  versionNumber: number
  tasks: OutlookTask[]
}

interface LegendTone {
  border: RGB
  fill: RGB
  text: RGB
}

interface LegendEntry {
  key: string
  label: string
  tone: LegendTone
}

const PAGE = { width: 792, height: 612 }
const MARGIN = 30
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.045, 0.075, 0.14)
const NAVY = rgb(0.075, 0.12, 0.21)
const BLUE = rgb(0.025, 0.49, 0.74)
const MUTED = rgb(0.36, 0.42, 0.51)
const PALE = rgb(0.91, 0.94, 0.97)
const LINE = rgb(0.78, 0.83, 0.89)
const SHEET = rgb(0.975, 0.982, 0.99)
const WHITE = rgb(1, 1, 1)
const LEGEND_TONES: LegendTone[] = [
  { border: rgb(1, 0.35, 0.07), fill: rgb(1, 0.93, 0.84), text: rgb(0.76, 0.2, 0.02) },
  { border: rgb(0.95, 0.62, 0), fill: rgb(1, 0.96, 0.78), text: rgb(0.62, 0.39, 0) },
  { border: rgb(0.1, 0.72, 0.36), fill: rgb(0.86, 0.98, 0.9), text: rgb(0.06, 0.48, 0.22) },
  { border: rgb(0.03, 0.61, 0.8), fill: rgb(0.84, 0.96, 0.99), text: rgb(0.01, 0.42, 0.61) },
  { border: rgb(0.5, 0.34, 0.82), fill: rgb(0.93, 0.89, 0.99), text: rgb(0.35, 0.2, 0.67) },
]
const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
const FIRST_PAGE_ROWS = 4
const CONTINUATION_ROWS = 17

export async function generateOutlookPdf(input: GenerateOutlookPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`3-Week Outlook - ${asciiText(input.jobName)}`)
  pdf.setSubject(asciiText(formatOutlookRange(input.window)))
  pdf.setCreator("SVC Directory")
  pdf.setProducer("SVC Directory")
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const totalPages = 1 + Math.ceil(Math.max(0, input.tasks.length - FIRST_PAGE_ROWS) / CONTINUATION_ROWS)
  const legend = buildLegend(input.tasks)

  const calendarPage = pdf.addPage([PAGE.width, PAGE.height])
  drawSheet(calendarPage)
  drawHeader(calendarPage, regular, bold, input)
  drawLegend(calendarPage, regular, bold, legend)
  drawCalendar(calendarPage, regular, bold, italic, input, legend)
  drawRegistry(calendarPage, regular, bold, input, input.tasks.slice(0, FIRST_PAGE_ROWS), 147)
  drawFooter(calendarPage, regular, input.versionNumber, 1, totalPages)

  drawRegistryContinuationPages(pdf, regular, bold, input, totalPages)
  return pdf.save()
}

function drawSheet(page: PDFPage) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: SHEET })
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, input: GenerateOutlookPdfInput) {
  const jobName = fitText(input.jobName.toUpperCase(), bold, 20, 420)
  page.drawText(jobName, { x: MARGIN, y: 566, size: 20, font: bold, color: INK })

  const company = input.companyName?.trim() || "SVC Directory"
  const subtitle = fitText(`${company} - 3-Week Master Construction Schedule`, regular, 10.5, 460)
  page.drawText(subtitle, { x: MARGIN, y: 548, size: 10.5, font: regular, color: MUTED })

  const schedule = `Schedule Window: ${formatOutlookRange(input.window)}`
  const scheduleText = fitText(schedule, bold, 9, 255)
  page.drawText(scheduleText, {
    x: PAGE.width - MARGIN - bold.widthOfTextAtSize(scheduleText, 9),
    y: 576,
    size: 9,
    font: bold,
    color: MUTED,
  })
  if (input.location) {
    const location = fitText(input.location, regular, 7.5, 220)
    page.drawText(location, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(location, 7.5),
      y: 545,
      size: 7.5,
      font: regular,
      color: MUTED,
    })
  }
  page.drawRectangle({ x: MARGIN, y: 531, width: CONTENT_WIDTH, height: 2, color: BLUE })
}

function buildLegend(tasks: OutlookTask[]): LegendEntry[] {
  const entries: LegendEntry[] = []
  for (const task of tasks) {
    const company = task.companyName.trim()
    const trade = task.trade.trim()
    const key = company || trade || "General"
    if (entries.some((entry) => entry.key.toLowerCase() === key.toLowerCase())) continue
    const label = company && trade && company.toLowerCase() !== trade.toLowerCase()
      ? `${company} (${trade})`
      : key
    entries.push({ key, label, tone: LEGEND_TONES[entries.length % LEGEND_TONES.length] })
  }
  return entries
}

function legendKey(task: OutlookTask): string {
  return task.companyName.trim() || task.trade.trim() || "General"
}

function toneForTask(task: OutlookTask, legend: LegendEntry[]): LegendTone {
  return legend.find((entry) => entry.key.toLowerCase() === legendKey(task).toLowerCase())?.tone ?? LEGEND_TONES[0]
}

function drawLegend(page: PDFPage, regular: PDFFont, bold: PDFFont, legend: LegendEntry[]) {
  const y = 498
  const height = 23
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_WIDTH, height, color: WHITE, borderColor: PALE, borderWidth: 0.8 })
  page.drawText("SUBTRADE LEGEND:", { x: MARGIN + 9, y: y + 8, size: 7.5, font: bold, color: INK })

  const visible = legend.slice(0, 4)
  if (visible.length === 0) {
    page.drawText("No scheduled tasks", { x: MARGIN + 105, y: y + 8, size: 7.5, font: regular, color: MUTED })
    return
  }
  const startX = MARGIN + 112
  const slotWidth = (CONTENT_WIDTH - 121) / visible.length
  visible.forEach((entry, index) => {
    const x = startX + index * slotWidth
    page.drawRectangle({ x, y: y + 7, width: 8, height: 8, color: entry.tone.fill, borderColor: entry.tone.border, borderWidth: 0.9 })
    const overflow = index === visible.length - 1 && legend.length > visible.length ? ` (+${legend.length - visible.length} more)` : ""
    page.drawText(fitText(`${entry.label}${overflow}`, bold, 7.2, slotWidth - 15), { x: x + 13, y: y + 8, size: 7.2, font: bold, color: INK })
  })
}

function drawCalendar(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
  input: GenerateOutlookPdfInput,
  legend: LegendEntry[],
) {
  const dates = outlookDates(input.window.start)
  const gridX = MARGIN
  const gridBottom = 204
  const gridTop = 482
  const weekdayHeight = 23
  const dayTop = gridTop - weekdayHeight
  const cellWidth = CONTENT_WIDTH / 7
  const cellHeight = (dayTop - gridBottom) / 3

  page.drawRectangle({ x: gridX, y: dayTop, width: CONTENT_WIDTH, height: weekdayHeight, color: NAVY })
  WEEKDAYS.forEach((weekday, index) => {
    const labelWidth = bold.widthOfTextAtSize(weekday, 7.5)
    page.drawText(weekday, {
      x: gridX + index * cellWidth + (cellWidth - labelWidth) / 2,
      y: dayTop + 8,
      size: 7.5,
      font: bold,
      color: WHITE,
    })
  })

  dates.forEach((date, index) => {
    const column = index % 7
    const row = Math.floor(index / 7)
    const x = gridX + column * cellWidth
    const y = dayTop - (row + 1) * cellHeight
    page.drawRectangle({
      x,
      y,
      width: cellWidth,
      height: cellHeight,
      color: row % 2 === 0 ? WHITE : rgb(0.985, 0.989, 0.995),
      borderColor: LINE,
      borderWidth: 0.55,
    })
    page.drawText(formatOutlookDate(date), { x: x + 5, y: y + cellHeight - 13, size: 7.5, font: bold, color: BLUE })

    const active = input.tasks.filter((task) => task.startDate && task.endDate && task.startDate <= date && task.endDate >= date)
    if (active.length === 0) {
      page.drawText("No tasks scheduled", { x: x + 5, y: y + cellHeight - 28, size: 6.3, font: italic, color: rgb(0.6, 0.66, 0.74) })
      return
    }

    const maxPills = 3
    active.slice(0, maxPills).forEach((task, taskIndex) => {
      const tone = toneForTask(task, legend)
      const pillX = x + 5
      const pillY = y + cellHeight - 31 - taskIndex * 17
      const pillWidth = cellWidth - 10
      const suffix = task.startDate ? ` (${dayNumber(task.startDate, date)}/${task.durationDays})` : ""
      const suffixWidth = bold.widthOfTextAtSize(suffix, 6.4)
      const title = fitText(task.title || "Untitled", bold, 6.4, Math.max(20, pillWidth - suffixWidth - 8))
      page.drawRectangle({ x: pillX, y: pillY, width: pillWidth, height: 14, color: tone.fill, borderColor: tone.border, borderWidth: 0.75 })
      page.drawText(`${title}${suffix}`, { x: pillX + 4, y: pillY + 4.2, size: 6.4, font: bold, color: tone.text })
    })
    if (active.length > maxPills) {
      page.drawText(`+${active.length - maxPills} more`, { x: x + 6, y: y + 5, size: 6.2, font: bold, color: MUTED })
    }
  })
}

function drawRegistry(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  input: GenerateOutlookPdfInput,
  tasks: OutlookTask[],
  tableTop: number,
) {
  const titleY = tableTop + 26
  page.drawRectangle({ x: MARGIN, y: titleY - 3, width: 2.5, height: 13, color: BLUE })
  page.drawText("TASK REGISTRY DETAILS", { x: MARGIN + 7, y: titleY, size: 9.5, font: bold, color: INK })

  const columns = registryColumns()
  page.drawRectangle({ x: MARGIN, y: tableTop, width: CONTENT_WIDTH, height: 20, color: rgb(0.92, 0.945, 0.975) })
  columns.forEach((column) => page.drawText(column.label, { x: column.x + 5, y: tableTop + 7, size: 6.6, font: bold, color: MUTED }))

  if (tasks.length === 0) {
    page.drawRectangle({ x: MARGIN, y: tableTop - 22, width: CONTENT_WIDTH, height: 22, color: WHITE, borderColor: LINE, borderWidth: 0.4 })
    page.drawText("No tasks scheduled", { x: MARGIN + 6, y: tableTop - 14, size: 7.5, font: regular, color: MUTED })
    return
  }

  tasks.forEach((task, index) => drawRegistryRow(page, regular, bold, input, task, index, tableTop - (index + 1) * 22))
}

function registryColumns() {
  return [
    { label: "ID", x: 30, width: 56 },
    { label: "SUBTRADE", x: 86, width: 108 },
    { label: "TASK DESCRIPTION", x: 194, width: 180 },
    { label: "START DATE", x: 374, width: 82 },
    { label: "DURATION", x: 456, width: 70 },
    { label: "DEPENDENCY", x: 526, width: 128 },
    { label: "STATUS", x: 654, width: 108 },
  ]
}

function drawRegistryRow(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  input: GenerateOutlookPdfInput,
  task: OutlookTask,
  absoluteIndex: number,
  y: number,
) {
  const columns = registryColumns()
  page.drawRectangle({
    x: MARGIN,
    y,
    width: CONTENT_WIDTH,
    height: 22,
    color: absoluteIndex % 2 === 0 ? WHITE : rgb(0.982, 0.987, 0.994),
    borderColor: LINE,
    borderWidth: 0.35,
  })
  const dependency = input.tasks.find((candidate) => candidate.id === task.dependencyTaskId)?.title ?? "None"
  const subtrade = task.companyName || task.trade || "General"
  const duration = `${task.durationDays} ${task.durationDays === 1 ? "Day" : "Days"}`
  const values = [
    String(task.sortOrder + 1),
    subtrade,
    task.title || "Untitled",
    task.startDate ? formatOutlookDate(task.startDate) : "Missing",
    duration,
    dependency,
  ]
  columns.slice(0, 6).forEach((column, index) => {
    page.drawText(fitText(values[index], index === 0 ? bold : regular, 7.1, column.width - 10), {
      x: column.x + 5,
      y: y + 8,
      size: 7.1,
      font: index === 0 ? bold : regular,
      color: index === 0 ? INK : MUTED,
    })
  })
  drawStatusPill(page, bold, task, columns[6].x + 5, y + 5, columns[6].width - 10)
}

function drawStatusPill(page: PDFPage, bold: PDFFont, task: OutlookTask, x: number, y: number, maxWidth: number) {
  const styles = {
    not_started: { fill: rgb(0.86, 0.94, 1), text: rgb(0.03, 0.38, 0.68) },
    in_progress: { fill: rgb(1, 0.94, 0.76), text: rgb(0.65, 0.4, 0) },
    blocked: { fill: rgb(1, 0.87, 0.87), text: rgb(0.72, 0.12, 0.12) },
    complete: { fill: rgb(0.84, 0.97, 0.88), text: rgb(0.05, 0.49, 0.22) },
  } as const
  const style = styles[task.status]
  const completion = task.completionPercent > 0 && task.completionPercent < 100 ? ` ${task.completionPercent}%` : ""
  const label = fitText(`${taskStatusLabel(task.status)}${completion}`, bold, 6.5, maxWidth - 8)
  const width = Math.min(maxWidth, bold.widthOfTextAtSize(label, 6.5) + 10)
  page.drawRectangle({ x, y, width, height: 12, color: style.fill })
  page.drawText(label, { x: x + 5, y: y + 3.5, size: 6.5, font: bold, color: style.text })
}

function drawRegistryContinuationPages(
  pdf: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  input: GenerateOutlookPdfInput,
  totalPages: number,
) {
  const remaining = input.tasks.slice(FIRST_PAGE_ROWS)
  for (let pageIndex = 0; pageIndex * CONTINUATION_ROWS < remaining.length; pageIndex += 1) {
    const page = pdf.addPage([PAGE.width, PAGE.height])
    drawSheet(page)
    drawHeader(page, regular, bold, input)
    const rows = remaining.slice(pageIndex * CONTINUATION_ROWS, (pageIndex + 1) * CONTINUATION_ROWS)
    drawRegistry(page, regular, bold, input, rows, 492)
    drawFooter(page, regular, input.versionNumber, pageIndex + 2, totalPages)
  }
}

function drawFooter(page: PDFPage, font: PDFFont, versionNumber: number, pageNumber: number, totalPages: number) {
  page.drawText(`Generated by SVC Directory - Version ${versionNumber}`, { x: MARGIN, y: 18, size: 6.5, font, color: MUTED })
  const label = `Page ${pageNumber} of ${totalPages}`
  page.drawText(label, { x: PAGE.width - MARGIN - font.widthOfTextAtSize(label, 6.5), y: 18, size: 6.5, font, color: MUTED })
}

function dayNumber(startDate: string, date: string): number {
  const start = Date.UTC(Number(startDate.slice(0, 4)), Number(startDate.slice(5, 7)) - 1, Number(startDate.slice(8, 10)))
  const current = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  return Math.max(1, Math.round((current - start) / 86_400_000) + 1)
}

function asciiText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[^\x20-\x7E]/g, "?")
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = asciiText(text).replace(/[\r\n]+/g, " ").trim()
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean
  let value = clean
  while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) value = value.slice(0, -1)
  return `${value.trim()}...`
}
