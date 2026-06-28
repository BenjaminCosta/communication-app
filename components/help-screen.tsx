"use client"

import { useState, useRef } from "react"
import {
  ArrowLeft, ChevronLeft, ChevronRight, Check,
  MessageCircle, CornerDownLeft, Tag, Hash, Users, CalendarDays,
  Image, Search, Star, Bell, Sparkles, Shield, MessageSquare,
  Pencil, UserPlus, Filter, Eye, Smartphone, Pin, MoreVertical,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface HelpScreenProps {
  onBack: () => void
  className?: string
}

/* ── colour system ────────────────────────────────────────── */

type SlideColor = "blue" | "violet" | "purple" | "emerald" | "sky" | "amber" | "pink" | "indigo" | "yellow" | "orange"

const C: Record<SlideColor, { text: string; bg: string; dot: string; border: string; glow: string }> = {
  blue:    { text: "text-blue-400",    bg: "bg-blue-500/15",    dot: "bg-blue-500",    border: "rgba(59,130,246,0.22)",  glow: "rgba(59,130,246,0.07)" },
  violet:  { text: "text-violet-400",  bg: "bg-violet-500/15",  dot: "bg-violet-500",  border: "rgba(139,92,246,0.22)",  glow: "rgba(139,92,246,0.07)" },
  purple:  { text: "text-purple-400",  bg: "bg-purple-500/15",  dot: "bg-purple-500",  border: "rgba(168,85,247,0.22)",  glow: "rgba(168,85,247,0.07)" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500/15", dot: "bg-emerald-500", border: "rgba(16,185,129,0.22)",  glow: "rgba(16,185,129,0.07)" },
  sky:     { text: "text-sky-400",     bg: "bg-sky-500/15",     dot: "bg-sky-500",     border: "rgba(14,165,233,0.22)",  glow: "rgba(14,165,233,0.07)" },
  amber:   { text: "text-amber-400",   bg: "bg-amber-500/15",   dot: "bg-amber-500",   border: "rgba(245,158,11,0.22)",  glow: "rgba(245,158,11,0.07)" },
  pink:    { text: "text-pink-400",    bg: "bg-pink-500/15",    dot: "bg-pink-500",    border: "rgba(236,72,153,0.22)",  glow: "rgba(236,72,153,0.07)" },
  indigo:  { text: "text-indigo-400",  bg: "bg-indigo-500/15",  dot: "bg-indigo-500",  border: "rgba(99,102,241,0.22)",  glow: "rgba(99,102,241,0.07)" },
  yellow:  { text: "text-yellow-400",  bg: "bg-yellow-500/15",  dot: "bg-yellow-500",  border: "rgba(234,179,8,0.22)",   glow: "rgba(234,179,8,0.07)" },
  orange:  { text: "text-orange-400",  bg: "bg-orange-500/15",  dot: "bg-orange-500",  border: "rgba(249,115,22,0.22)",  glow: "rgba(249,115,22,0.07)" },
}

/* point-row icon styles */
const P = {
  blue:    "bg-blue-500/12 text-blue-400",
  violet:  "bg-violet-500/12 text-violet-400",
  purple:  "bg-purple-500/12 text-purple-400",
  emerald: "bg-emerald-500/12 text-emerald-400",
  sky:     "bg-sky-500/12 text-sky-400",
  amber:   "bg-amber-500/12 text-amber-400",
  pink:    "bg-pink-500/12 text-pink-400",
  indigo:  "bg-indigo-500/12 text-indigo-400",
  yellow:  "bg-yellow-500/12 text-yellow-400",
  orange:  "bg-orange-500/12 text-orange-400",
  teal:    "bg-teal-500/12 text-teal-400",
}

/* ── slide data ───────────────────────────────────────────── */

interface SlidePoint { icon: React.ReactNode; s: string; text: string }

interface GuideSlide {
  icon: React.ReactNode
  color: SlideColor
  title: string
  headline: string
  highlight: string
  visual: React.ReactNode
  points: SlidePoint[]
}

const SLIDES: GuideSlide[] = [
  /* 1 — Messages */
  {
    icon: <MessageCircle className="w-7 h-7" />,
    color: "blue",
    title: "Messages",
    headline: "Send updates to the",
    highlight: "right people.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-purple-500/80 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-white">JD</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-white/30">Today, 9:41 AM</p>
            <p className="text-xs text-white/70">Need to follow up with Joseph</p>
          </div>
          <MoreVertical className="w-3.5 h-3.5 text-white/20 shrink-0" />
        </div>
        <div className="flex gap-1.5 mt-2 ml-[42px]">
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400/80 border border-amber-500/20 flex items-center gap-1">
            <Users className="w-2.5 h-2.5" /> Joseph
          </span>
          <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-400/10 text-violet-300 border border-violet-400/25 flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" /> Follow Up
          </span>
        </div>
      </div>
    ),
    points: [
      { icon: <Shield className="w-4 h-4" />, s: P.blue, text: "Only the author and chosen recipients can see it." },
      { icon: <Tag className="w-4 h-4" />, s: P.violet, text: "Add tags or context to stay organized." },
      { icon: <MessageSquare className="w-4 h-4" />, s: P.teal, text: "Tap a message to update or manage it." },
    ],
  },
  /* 2 — Replies */
  {
    icon: <CornerDownLeft className="w-7 h-7" />,
    color: "violet",
    title: "Replies",
    headline: "Respond with a",
    highlight: "quick swipe.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-violet-400/60 shrink-0">
          <CornerDownLeft className="w-4 h-4" />
          <span className="text-[10px] font-medium tracking-wide">swipe</span>
        </div>
        <div className="flex-1 rounded-lg bg-white/[0.04] border border-white/6 px-3 py-2">
          <p className="text-[11px] text-white/50">Project update for next week</p>
        </div>
      </div>
    ),
    points: [
      { icon: <Users className="w-4 h-4" />, s: P.blue, text: "Includes original recipients and tags." },
      { icon: <MessageSquare className="w-4 h-4" />, s: P.violet, text: "Tap a reply quote to jump to the original." },
      { icon: <CornerDownLeft className="w-4 h-4" />, s: P.teal, text: "On desktop, right-click for the action menu." },
    ],
  },
  /* 3 — Tags */
  {
    icon: <Tag className="w-7 h-7" />,
    color: "violet",
    title: "Tags",
    headline: "Keep your messages",
    highlight: "organized.",
    visual: (
      <div className="flex flex-wrap gap-1.5">
        {["Task", "Follow Up", "Important", "Question"].map((label) => (
          <span key={label} className="text-[10px] px-2.5 py-1 rounded-full bg-violet-400/10 text-violet-300 border border-violet-400/25 flex items-center gap-1">
            <Tag className="w-2.5 h-2.5" /> {label}
          </span>
        ))}
      </div>
    ),
    points: [
      { icon: <Tag className="w-4 h-4" />, s: P.violet, text: "Classify messages: Task, Follow Up, Important..." },
      { icon: <Filter className="w-4 h-4" />, s: P.blue, text: "Organized by category: task, status, priority..." },
      { icon: <Star className="w-4 h-4" />, s: P.amber, text: "Long-press a tag to pin, view, or delete." },
    ],
  },
  /* 4 — Contexts */
  {
    icon: <Hash className="w-7 h-7" />,
    color: "emerald",
    title: "Contexts",
    headline: "Link messages to",
    highlight: "what they're about.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <Hash className="w-3.5 h-3.5 text-emerald-400/60" />
          <span className="text-xs font-medium text-white/70">Acme Corp</span>
        </div>
        <div className="flex flex-col gap-1.5 ml-[22px]">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-white/25 w-14">Phone</span>
            <span className="text-white/50">+1 555-0123</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-white/25 w-14">Website</span>
            <span className="text-white/50">acme.com</span>
          </div>
        </div>
      </div>
    ),
    points: [
      { icon: <Pencil className="w-4 h-4" />, s: P.emerald, text: "Add custom fields like phone, address, or notes." },
      { icon: <Shield className="w-4 h-4" />, s: P.blue, text: "Don't affect who can see the message." },
      { icon: <Hash className="w-4 h-4" />, s: P.teal, text: "Use for projects, clients, topics, or workflows." },
    ],
  },
  /* 5 — People */
  {
    icon: <Users className="w-7 h-7" />,
    color: "amber",
    title: "People & Contacts",
    headline: "Manage your",
    highlight: "contacts & team.",
    visual: (
      <div className="flex items-center justify-center gap-5">
        {(
          [
            { i: "JD", c: "bg-purple-500/80", n: "Joseph" },
            { i: "MR", c: "bg-sky-500/80", n: "Maria" },
            { i: "AT", c: "bg-amber-500/80", n: "Alex" },
          ] as const
        ).map((p) => (
          <div key={p.n} className="flex flex-col items-center gap-1.5">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", p.c)}>
              <span className="text-[11px] font-bold text-white">{p.i}</span>
            </div>
            <span className="text-[10px] text-white/40">{p.n}</span>
          </div>
        ))}
      </div>
    ),
    points: [
      { icon: <UserPlus className="w-4 h-4" />, s: P.amber, text: "Import contacts from your phone." },
      { icon: <Pencil className="w-4 h-4" />, s: P.emerald, text: "Edit email, phone, or tags on any contact." },
      { icon: <Eye className="w-4 h-4" />, s: P.violet, text: "Switch between private and global visibility." },
    ],
  },
  /* 6 — Dates */
  {
    icon: <CalendarDays className="w-7 h-7" />,
    color: "sky",
    title: "Dates & Calendar",
    headline: "Track what needs",
    highlight: "follow-up.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
        <div className="grid grid-cols-7 gap-1 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="text-[9px] text-white/20 py-0.5">{d}</span>
          ))}
          {[14, 15, 16, 17, 18, 19, 20].map((d) => (
            <span
              key={d}
              className={cn(
                "text-[10px] py-1 rounded-md",
                d === 17 ? "bg-sky-400/25 text-sky-400 font-medium" : "text-white/30"
              )}
            >
              {d}
            </span>
          ))}
        </div>
      </div>
    ),
    points: [
      { icon: <CalendarDays className="w-4 h-4" />, s: P.sky, text: "Add one or more dates to any message." },
      { icon: <Search className="w-4 h-4" />, s: P.blue, text: "View all dated messages on the calendar." },
      { icon: <MessageCircle className="w-4 h-4" />, s: P.teal, text: "Tap a day to compose a new message." },
    ],
  },
  /* 7 — Images */
  {
    icon: <Image className="w-7 h-7" />,
    color: "pink",
    title: "Images",
    headline: "Add photos for",
    highlight: "more context.",
    visual: (
      <div className="flex items-center justify-center">
        <div className="w-24 h-[72px] rounded-xl bg-white/[0.05] border border-white/8 flex items-center justify-center relative">
          <Image className="w-7 h-7 text-pink-400/30" />
          <div className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
            <Search className="w-2.5 h-2.5 text-white/40" />
          </div>
        </div>
      </div>
    ),
    points: [
      { icon: <Eye className="w-4 h-4" />, s: P.pink, text: "Tap an image to view it full-screen." },
      { icon: <Search className="w-4 h-4" />, s: P.blue, text: "Pinch to zoom, drag to pan, double-tap to reset." },
      { icon: <Check className="w-4 h-4" />, s: P.emerald, text: "Auto-compressed before uploading." },
    ],
  },
  /* 8 — Search */
  {
    icon: <Search className="w-7 h-7" />,
    color: "indigo",
    title: "Search & Filters",
    headline: "Find anything",
    highlight: "in seconds.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3">
        <div className="flex items-center gap-2 bg-white/[0.04] rounded-lg border border-white/8 px-2.5 py-1.5 mb-2.5">
          <Search className="w-3 h-3 text-white/20" />
          <span className="text-[10px] text-white/25">Search messages, people, tags...</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-5 rounded-full bg-blue-500/60 flex items-center justify-center">
              <span className="text-[7px] font-bold text-white">JD</span>
            </div>
            <span className="text-[10px] text-white/40">Need to follow up...</span>
          </div>
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-5 rounded-full bg-emerald-500/60 flex items-center justify-center">
              <span className="text-[7px] font-bold text-white">MR</span>
            </div>
            <span className="text-[10px] text-white/40">Project review completed</span>
          </div>
        </div>
      </div>
    ),
    points: [
      { icon: <Filter className="w-4 h-4" />, s: P.indigo, text: "Combine filters: people, tags, dates, contexts." },
      { icon: <Search className="w-4 h-4" />, s: P.blue, text: "Search across messages, contacts, and more." },
      { icon: <Users className="w-4 h-4" />, s: P.teal, text: "Use the \"Me\" filter for messages you sent." },
    ],
  },
  /* 9 — Favorites */
  {
    icon: <Star className="w-7 h-7" />,
    color: "yellow",
    title: "Favorites & Pins",
    headline: "Save and pin",
    highlight: "what matters.",
    visual: (
      <div className="flex items-center justify-center gap-8">
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-11 h-11 rounded-full bg-yellow-500/12 flex items-center justify-center">
            <Star className="w-5 h-5 text-yellow-400" />
          </div>
          <span className="text-[10px] text-white/35">Star</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-11 h-11 rounded-full bg-violet-500/12 flex items-center justify-center">
            <Pin className="w-5 h-5 text-violet-400" />
          </div>
          <span className="text-[10px] text-white/35">Pin</span>
        </div>
      </div>
    ),
    points: [
      { icon: <Star className="w-4 h-4" />, s: P.yellow, text: "Long-press a message, then star it." },
      { icon: <Pin className="w-4 h-4" />, s: P.violet, text: "Pin a tag to keep it at the top." },
      { icon: <Shield className="w-4 h-4" />, s: P.blue, text: "Delete always asks for confirmation." },
    ],
  },
  /* 10 — Notifications */
  {
    icon: <Bell className="w-7 h-7" />,
    color: "orange",
    title: "Notifications",
    headline: "Stay in",
    highlight: "the loop.",
    visual: (
      <div className="rounded-xl bg-white/[0.04] border border-white/8 p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0 relative">
          <Bell className="w-4 h-4 text-orange-400" />
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-[rgba(8,14,28,0.8)]" />
        </div>
        <div>
          <p className="text-[10px] text-white/25">Just now</p>
          <p className="text-[11px] text-white/55">New message from Joseph</p>
        </div>
      </div>
    ),
    points: [
      { icon: <Bell className="w-4 h-4" />, s: P.orange, text: "Get alerted about new messages." },
      { icon: <Smartphone className="w-4 h-4" />, s: P.blue, text: "On iOS, add to Home Screen first." },
      { icon: <Check className="w-4 h-4" />, s: P.emerald, text: "Then enable from the Notifications screen." },
    ],
  },
]

/* ── component ────────────────────────────────────────────── */

export function HelpScreen({ onBack, className }: HelpScreenProps) {
  const [current, setCurrent] = useState(0)
  const touchX = useRef(0)

  const slide = SLIDES[current]
  const c = C[slide.color]

  const prev = () => setCurrent((i) => Math.max(0, i - 1))
  const next = () => setCurrent((i) => Math.min(SLIDES.length - 1, i + 1))

  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = touchX.current - e.changedTouches[0].clientX
    if (diff > 50) next()
    else if (diff < -50) prev()
  }

  return (
    <div className={`flex-1 flex flex-col stream-glass-screen ${className ?? "animate-fade-in"}`}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight">How it works</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto px-5 md:px-6 py-7 flex flex-col items-center">

          {/* Slide icon + title */}
          <div key={`hdr-${current}`} className="flex flex-col items-center mb-5" style={{ animation: "tooltip-in 180ms ease-out" }}>
            <span className={cn("w-16 h-16 rounded-2xl flex items-center justify-center mb-3 backdrop-blur-sm", c.bg, c.text)}>
              {slide.icon}
            </span>
            <h2 className="text-xl font-bold tracking-tight">{slide.title}</h2>
            <p className="text-xs text-muted-foreground/45 mt-1">
              {current + 1} of {SLIDES.length}
            </p>
          </div>

          {/* Main glass card */}
          <div
            key={`card-${current}`}
            className="w-full rounded-3xl border bg-[rgba(8,14,28,0.55)] backdrop-blur-xl overflow-hidden"
            style={{
              borderColor: c.border,
              boxShadow: `0 0 40px ${c.glow}, inset 0 1px 0 rgba(255,255,255,0.04)`,
              animation: "tooltip-in 200ms ease-out",
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* Headline */}
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start gap-2.5">
                <Sparkles className={cn("w-[18px] h-[18px] mt-0.5 shrink-0", c.text)} />
                <p className="text-[17px] font-semibold leading-snug">
                  {slide.headline}{" "}
                  <span className={c.text}>{slide.highlight}</span>
                </p>
              </div>
            </div>

            {/* Visual mockup */}
            <div className="px-5 pb-4">
              {slide.visual}
            </div>

            {/* Points */}
            <div className="px-5 pb-5">
              {slide.points.map((pt, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 py-3",
                    i < slide.points.length - 1 && "border-b border-white/[0.06]"
                  )}
                >
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", pt.s)}>
                    {pt.icon}
                  </div>
                  <p className="text-[13px] leading-snug text-white/55">{pt.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5 mt-5">
            {SLIDES.map((s, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={cn(
                  "rounded-full transition-all duration-200",
                  i === current
                    ? cn("w-5 h-1.5", C[s.color].dot)
                    : "w-1.5 h-1.5 bg-white/15 hover:bg-white/25"
                )}
              />
            ))}
          </div>

          {/* Bottom nav */}
          <div className="flex items-center justify-between w-full mt-5 mb-2">
            <button
              onClick={prev}
              disabled={current === 0}
              className={cn(
                "w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-150",
                current === 0
                  ? "border-white/8 text-white/15 cursor-default"
                  : "border-white/16 active:scale-90 hover:bg-white/5 " + c.text
              )}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <p className="text-xs text-muted-foreground/30">Swipe to explore</p>

            {current < SLIDES.length - 1 ? (
              <button
                onClick={next}
                className={cn("w-12 h-12 rounded-full border border-white/16 flex items-center justify-center active:scale-90 transition-all duration-150 hover:bg-white/5", c.text)}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={onBack}
                className="w-12 h-12 rounded-full border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center active:scale-90 transition-all duration-150 text-emerald-400 hover:bg-emerald-500/15"
              >
                <Check className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
