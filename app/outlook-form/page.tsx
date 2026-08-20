import type { Metadata } from "next"
import { OutlookFormScreen } from "@/components/outlook-form/outlook-form-screen"

export const metadata: Metadata = {
  title: "3-Week Outlook | Courtney Roberts",
  description: "Submit your 3-Week Outlook for review — no login needed.",
}

export default function OutlookFormPage() {
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <OutlookFormScreen />
    </main>
  )
}
