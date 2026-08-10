"use client"

/**
 * Standalone preview route for the ByeByeDPR worker MVP UI mockup.
 * Deliberately isolated from app/page.tsx's real navigation/backend wiring
 * (per the request: mock data only, no context). Root wrapper mirrors
 * app/page.tsx's own root exactly so the fixed-viewport/safe-area system
 * from app/layout.tsx behaves identically here.
 */

import { ByeByeDprApp } from "@/components/bye-bye-dpr/byebye-dpr-app"

export default function ByeByeDprPreviewPage() {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <ByeByeDprApp />
    </div>
  )
}
