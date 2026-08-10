# Design

Distilled from `docs/svc-design-system.md` (the full audit — read that for depth) plus the new ByeByeDPR module tokens defined in this pass. Four modules already exist; ByeByeDPR is the fifth, and the second light/flat one alongside Applications and Quest Coral.

## Theme mechanism

`app/globals.css` defines base tokens once (`:root`), wires them to Tailwind via `@theme inline`, and each module is a `.{module}-scope` wrapper class that redefines the same token set. Shared shadcn primitives (`components/ui/*`) theme automatically inside any scope — never hardcode a color that already exists as a token.

## Font

Sora (sans, weights 300-700) + JetBrains Mono. Icons: `lucide-react` only.

## Dark modules (Stream, Directory) — glassmorphism

Frosted `.glass-*` panels over a radial-gradient canvas. Not used by ByeByeDPR.

## Light modules (Applications, Quest Coral, **ByeByeDPR**) — flat elevation, never glassy

Solid white cards, one soft shadow (`0 1px 2px rgba(15,23,42,.04), 0 6px 16px rgba(15,23,42,.045)`), a barely-there identity-tinted radial wash on the canvas. Glass is explicitly rejected for the base surface in this family — see each module's own CSS comment.

## ByeByeDPR — new module tokens

Wrapper class: `.byebye-dpr-scope`. One identity hue (purple/violet) — deliberately calmer than the reference mockups' higher-saturation purple, per the "Restrained" color strategy: this is a utility tool used for seconds at a time, not a brand moment.

| Token | Value | Use |
|---|---|---|
| `--background` | `#FAFAFC` | canvas |
| `--card` / `--popover` | `#FFFFFF` | elevated surfaces |
| `--primary` | `#6D5BD0` | primary actions (Clock In/Out, Submit) |
| `--primary-hover` | `#5C4BB8` | primary hover/active |
| `--border` / `--input` | `#E7E5F0` | hairlines (warm-violet-tinted neutral, not cool gray) |
| text | `#18142B` on `#6B6580` muted | body / secondary text |
| `--byebye-purple` | `#6D5BD0` | identity accent (same as primary) |
| `--byebye-purple-soft` | `#F1EEFB` | icon-chip / status-card backgrounds |
| `--byebye-sky` | `#2563EB` | links, location info, "Change" affordance |

Reuses the app-wide 5-tone semantic vocabulary for status (never invents new hex values):
- `complete` (green `#15803D`/`#22C55E`) — Present, submitted, confirmed.
- `missing` (coral-red `#DC5A5A`/`#F97373`) — Absent.
- `pending` (amber `#B45309`/`#F59E0B`) — Late, in-progress recording.
- `info` (blue `#2563EB`) — location/links.
- `ai` — this module keeps its own purple identity for AI-generated content, same reasoning Quest Coral gives for reusing coral: no second competing accent.

## Motion

`cubic-bezier(0.16, 1, 0.3, 1)` ease-out, 150ms tap feedback (`active:scale-[0.98]`), 250-340ms entrances. No bounce/elastic. `prefers-reduced-motion` guard on every custom keyframe.

## Radius / density

`rounded-full` for pills/avatars/icon-buttons, `rounded-2xl` for cards/sheets, `rounded-lg`/`md` for inputs/chips. Compact density: `text-sm`/`text-xs` dominate, `font-semibold` default emphasis — but ByeByeDPR's primary CTA and status label run one step larger than the rest of the app (`text-base`/`text-lg`) since this module is used one-handed, often outdoors, at a glance.

## Components

Full shadcn set already installed (`components/ui/*`, style "new-york"). Bottom sheets: `vaul`-based (see `components/tag-sheet.tsx` for the existing in-app pattern) — ByeByeDPR's "minimal touch of glass" lives here (sheet backdrop only), never on the base screen.
