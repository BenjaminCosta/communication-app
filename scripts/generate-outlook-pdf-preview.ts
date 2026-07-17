import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { generateOutlookPdf } from "../features/outlooks/pdf/generate-outlook-pdf"
import { createOutlookTask, outlookWindow, scheduleOutlookTasks } from "../lib/outlook-core"

async function main() {
  const output = resolve(process.argv[2] ?? "tmp/pdfs/outlook-preview.pdf")
  const window = outlookWindow("2026-07-13")
  const tasks = scheduleOutlookTasks([
    createOutlookTask({ id: "ada", title: "ADA Ramp", description: "Form, reinforce and pour accessible ramp.", trade: "Concrete", companyName: "74 Construction", startDate: "2026-07-16", durationDays: 3 }),
    createOutlookTask({ id: "dock", title: "Dock Levelers", description: "Set equipment and complete final alignment.", trade: "Equipment", companyName: "Summit Concrete", dependencyTaskId: "ada", durationDays: 2 }),
    createOutlookTask({ id: "gas", title: "Gas Main Install", description: "Install, pressure test and prepare inspection.", trade: "MEP", companyName: "Prime MEP", startDate: "2026-07-24", durationDays: 5 }),
    createOutlookTask({ id: "steel", title: "Canopy Steel", trade: "Structural", companyName: "Ironworks North", startDate: "2026-07-28", durationDays: 4, status: "in_progress", completionPercent: 35 }),
  ], window).tasks

  const bytes = await generateOutlookPdf({
    jobName: "Annapolosa Terminal Improvements",
    companyName: "74 Construction",
    location: "Newark, NJ",
    window,
    versionNumber: 3,
    tasks,
  })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, bytes)
  console.log(output)
}

void main()
