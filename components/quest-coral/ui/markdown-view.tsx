"use client"

/**
 * Minimal Markdown renderer for Quest Coral's project context — headings,
 * bullet/numbered lists, bold and paragraphs only. Project context is
 * short-form structured notes, not arbitrary documents, so a hand-rolled
 * line-scanner is enough and keeps this dependency-free.
 */

import { Fragment, memo, useMemo } from "react"
import { cn } from "@/lib/utils"

type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let index = 0

  const isBullet = (line: string) => /^[-*]\s+/.test(line)
  const isNumbered = (line: string) => /^\d+\.\s+/.test(line)

  while (index < lines.length) {
    const line = (lines[index] ?? "").trim()
    if (!line) {
      index += 1
      continue
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() })
      index += 1
      continue
    }
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() })
      index += 1
      continue
    }
    if (isBullet(line)) {
      const items: string[] = []
      while (index < lines.length && isBullet((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""))
        index += 1
      }
      blocks.push({ type: "ul", items })
      continue
    }
    if (isNumbered(line)) {
      const items: string[] = []
      while (index < lines.length && isNumbered((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""))
        index += 1
      }
      blocks.push({ type: "ol", items })
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !(lines[index] ?? "").trim().startsWith("## ") &&
      !(lines[index] ?? "").trim().startsWith("### ") &&
      !isBullet((lines[index] ?? "").trim()) &&
      !isNumbered((lines[index] ?? "").trim())
    ) {
      paragraph.push((lines[index] ?? "").trim())
      index += 1
    }
    blocks.push({ type: "p", text: paragraph.join(" ") })
  }

  return blocks
}

function renderInline(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-[var(--coral-text)]">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <Fragment key={`${keyPrefix}-${index}`}>{part}</Fragment>
  })
}

export const MarkdownView = memo(function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  // This is shared, multi-user data — a teammate posting an update elsewhere
  // in the project re-renders this component too (new `updates` prop from
  // the parent's Firestore listener), even though the context text itself
  // didn't change. Re-parsing only when `markdown` actually changes avoids
  // redoing the line-scan on every unrelated re-render.
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown])

  if (blocks.length === 0) {
    return <p className={cn("text-[0.8125rem] text-[var(--coral-text-muted)]", className)}>Nothing written yet.</p>
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`
        if (block.type === "h2") {
          return (
            <h3
              key={key}
              className={cn(
                "text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-strong)]",
                blockIndex > 0 && "mt-2",
              )}
            >
              {block.text}
            </h3>
          )
        }
        if (block.type === "h3") {
          return (
            <h4 key={key} className="text-[0.8125rem] font-semibold text-[var(--coral-text)]">
              {block.text}
            </h4>
          )
        }
        if (block.type === "ul") {
          return (
            <ul key={key} className="flex flex-col gap-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="quest-coral-reading-copy flex items-start gap-2 text-[0.8125rem]">
                  <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[#94A3B8]" aria-hidden="true" />
                  <span>{renderInline(item, `${key}-li-${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === "ol") {
          return (
            <ol key={key} className="flex flex-col gap-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="quest-coral-reading-copy flex items-start gap-2 text-[0.8125rem]">
                  <span className="shrink-0 text-[0.75rem] font-semibold text-[var(--coral-text)]">{itemIndex + 1}.</span>
                  <span>{renderInline(item, `${key}-ol-${itemIndex}`)}</span>
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={key} className="quest-coral-reading-copy text-[0.8125rem]">
            {renderInline(block.text, key)}
          </p>
        )
      })}
    </div>
  )
})
