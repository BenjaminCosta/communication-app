# SVC — Design System & Visual Identity Context

> Single reference for **visual identity, color tokens, and UI conventions across every module.**
> Read this before maquetando/building any new screen, component, or module so the result matches
> the existing app instead of inventing a new look. This file describes what *exists in code today*
> — verify against the referenced files if something looks stale.
>
> Last generated: 2026-08-05, from a full audit of `app/globals.css`, `components.json`,
> `app/layout.tsx`, `lib/utils.ts`, and representative screens in every module.

---

## 0. TL;DR

- **One dark core app** ("Communications" / Stream) + **one dark nested module** (SVC Directory)
  + **three light standalone modules** (Applications, Quest Coral, ByeByeDPR). All five share
  the *same* component primitives (`components/ui/*`, shadcn "new-york" style) and the *same*
  theming mechanism — only the CSS custom-property values change per module. ByeByeDPR (added
  2026-08-07) is UI-mockup-only so far — see `docs/svc-bye-bye-dpr-module.md` — not wired to its
  own backend yet and not one of `app/page.tsx`'s internal screens; it lives at its own route
  (`/byebye-dpr`) and is reached from the module switcher via a real navigation, not the in-app
  screen-switch the other four modules use.
- **Theming mechanism**: `app/globals.css` defines base tokens (`--background`, `--primary`, …)
  once, and `@theme inline` maps them to Tailwind color utilities (`bg-background`,
  `text-primary`, …). Each light module is a wrapper class (`.applications-scope`,
  `.quest-coral-scope`) that **redefines those same custom properties** for everything nested
  inside it. No component fork, no `dark:` variants — the identical `<Button>` renders blue-on-dark
  in Stream and blue-on-white in Applications automatically.
- **Active stylesheet is `app/globals.css`** (imported from `app/layout.tsx`). **`styles/globals.css`
  is dead code** — default shadcn boilerplate (oklch grayscale, Geist font), not imported
  anywhere. Do not reference it, do not "fix" it, ignore it unless asked to delete it.
- **Font**: Sora (sans, weights 300–700, loaded via `@fontsource/sora` in `app/layout.tsx`) +
  JetBrains Mono. **Icons**: `lucide-react`, used exclusively (111+ files). **No JS animation
  library** — every animation is a hand-written CSS `@keyframes` + Tailwind `animate-*` utility class
  in `app/globals.css`, transform/opacity only, with `prefers-reduced-motion` guards.
- **Base radius**: `--radius: 0.625rem` (10px), scaled via `--radius-sm/md/lg/xl`. In practice
  `rounded-full` is the single most common radius in the app (pills, avatars, icon buttons),
  followed by `rounded-xl` / `rounded-2xl` for cards and sheets.
- **Dark modules (Stream, Directory) = glassmorphism.** Frosted, translucent, blurred panels over
  radial-gradient backgrounds, with glow shadows on primary actions.
- **Light modules (Applications, Quest Coral) = flat elevation.** Solid white cards, a single soft
  drop shadow, "never glassy" by explicit design comment in the CSS.

---

## 1. How theming works (read this before styling anything)

```
app/globals.css
├─ :root { --background, --primary, --card, ... }   ← dark base tokens (Stream/Directory)
├─ @theme inline { --color-background: var(--background); ... } ← wires tokens → Tailwind utilities
├─ .applications-scope { --background: #F5F8FC; --primary: #2563EB; ... } ← re-theme for light module
└─ .quest-coral-scope  { --background: #FFFFFF;  --primary: #FF7A59; ... } ← re-theme for light module
```

Because Tailwind utility classes like `bg-background`, `text-foreground`, `border-border`,
`bg-primary` all resolve through `@theme inline` to `var(--token)`, wrapping a subtree in
`.applications-scope` or `.quest-coral-scope` re-themes **every shadcn primitive rendered inside
it** — `<Button>`, `<Card>`, `<Input>`, `<Dialog>` — with zero per-component changes. This is *the*
pattern to follow if a new light-themed module is ever added: create a new `.{module}-scope` class,
redefine the base tokens + a handful of `--{module}-*` identity tokens, done.

**Rule for agents:** never hardcode a color that already exists as a token. Reference
`var(--token)` (inside module-specific `--apps-*`/`--coral-*`/`--directory-*` custom properties) or
the corresponding Tailwind utility (`bg-primary`, `text-muted-foreground`, etc.). Only use a raw hex
when the CSS itself does (state/identity accents not exposed as a semantic token).

---

## 2. Global dark base tokens (Communications / Stream / Directory)

Defined in `app/globals.css` `:root`. This is the *default* theme — what renders when no
`-scope` wrapper is present.

| Token | Value | Use |
|---|---|---|
| `--background` | `#0B0F14` | app canvas (near-black, slightly blue) |
| `--foreground` | `#F9FAFB` | primary text |
| `--card` / `--popover` | `#121821` | elevated surfaces |
| `--primary` | `#2563EB` | primary actions, links, focus accents |
| `--primary-hover` | `#1D4ED8` | primary hover/active |
| `--secondary` / `--muted` / `--accent` | `#1F2937` | low-emphasis surfaces |
| `--muted-foreground` / `--secondary-foreground` | `#9CA3AF` | secondary text |
| `--border` / `--input` | `#1F2937` | hairlines |
| `--ring` | `#2563EB` | focus rings |
| `--destructive` | `#EF4444` | destructive actions |
| `--radius` | `0.625rem` (10px) | base corner radius |

**Message/status state colors** (used across Stream for tag-later categories, badges, etc. — see
`--color-progress` etc. in `@theme inline` and the topic file `tag-categories`):

| Token | Value | Meaning |
|---|---|---|
| `--progress` | `#22C55E` (green) | in progress |
| `--problem` | `#EF4444` (red) | blocker/problem |
| `--feedback` | `#F59E0B` (amber) | needs feedback |
| `--decision` | `#3B82F6` (blue) | needs decision |

Utility classes `.bg-progress/.text-progress/.border-progress` (and problem/feedback/decision
equivalents) are hand-declared right below the base tokens — use these rather than re-deriving the
hex.

**Deterministic avatar palette** (`lib/utils.ts`, `getUserAvatarColor(userId)` — hashes the id into
one of 7 solid Tailwind colors, always the same color for the same user):
`bg-blue-600`, `bg-violet-600`, `bg-cyan-600`, `bg-emerald-600`, `bg-amber-600`, `bg-rose-600`,
`bg-orange-600`.

---

## 3. Module-by-module

### 3.1 Communications / Stream — the core app (dark, glassmorphism)

The default module (Compose, People, Projects, Calendar, Contexts). Visual language is
**frosted glass over a moody radial-gradient canvas**, not flat cards.

- **Screen background**: `.stream-glass-screen` — three overlapping radial gradients (blue
  `rgba(37,99,235,.18)` top-left, violet `rgba(124,58,237,.13)` bottom-right, cyan
  `rgba(14,165,233,.08)` bottom-center) over a near-black `#05090f` base.
- **Glass surface family** (`app/globals.css` `@layer utilities`), all `backdrop-filter: blur(…)
  saturate(…)` + a translucent fill + an `inset 0 1px 0 rgba(255,255,255,…)` top highlight for the
  "glass edge" look:
  - `.glass-panel` — generic elevated panel (topbar, cards).
  - `.glass-button` — icon/action buttons, hover brightens fill + border.
  - `.glass-pill` / `.glass-pill-active` — filter/segment pills (blue active state).
  - `.glass-pill-people` / `.glass-pill-people-active` — same pill mechanic, amber-tinted variant
    for people-related filters.
  - `.glass-modal` — dialogs/sheets, more opaque than panels for legibility.
  - `.glass-menu-panel` / `.glass-menu-item` — the grid nav menu.
  - `.glass-compose` / `.glass-compose-pill` — the compose bar docked at the bottom.
  - `.glass-message` / `.glass-message-me` / `.glass-message-selected` /
    `.glass-message-highlighted` — chat bubbles; "me" bubbles get a blue tint, selected/highlighted
    get a blue/cyan ring.
- **Primary glow**: `.glow-blue` (`box-shadow: 0 10px 28px rgba(37,99,235,.28)`), `.glow-purple`,
  and the FAB-style `animate-glow` keyframe (pulsing blue shadow, 2.5s loop) — reserved for the
  single most prominent CTA on a screen (send/compose).
- **Topbar convention**: `.glass-panel` + the shared `.app-topbar` utility (`padding-top: 6px;
  padding-bottom: 10px` — "single source of truth for all screen headers", per its own comment) +
  `border-b` + `animate-slide-down` entrance. Reuse `.app-topbar` for any new screen header instead
  of inventing padding.
- **Reply quote block** (`.reply-quote*`): small nested quote-preview inside a message bubble,
  darkened background, 2-line clamp, blue author name.
- **Icon buttons / avatars**: near-universally `rounded-full`, `9×9` (`w-9 h-9`) for topbar/FAB
  buttons, `active:scale-[0.98]` tap feedback, `transition-all duration-150`.

### 3.2 SVC Directory — dark, nested inside the Stream shell

Directory reuses the Stream glass system wholesale (same `glass-*` classes, same font/radius) but
layers its **own identity accent + a deliberately different, flatter row/list style** on top. Full
build context: `docs/svc-directory-ui-context.md`.

- **Screen background**: `.directory-glass-screen` — orange top-left + faint cyan bottom-right
  radial wash over `#070b11` (darker/warmer than Stream's blue/violet wash).
- **Identity tokens** (`:root`, prefixed `--directory-*`):

  | Token | Value | Use |
  |---|---|---|
  | `--directory-title` | `#FDBA74` (soft orange) | Directory branding/title text |
  | `--directory-focus` | `#F97316` (orange) | focus/active accents |
  | `--directory-person` | `#F59E0B` (amber) | person-type entities |
  | `--directory-company` | `#22D3EE` (cyan) | company-type entities |
  | `--directory-job` | `#A78BFA` (violet) | job-type entities |
  | `*-soft` variants | ~9% alpha of the above | icon-chip / row backgrounds |
  | `*-border` variants | 28–32% alpha | icon-chip borders |

  Consumed via `lib/directory-config.ts` → `DIRECTORY_ENTITY_META` (`color` / `softBackground` /
  `border` per type) — **use this map**, don't re-pick colors for a new entity-type surface.
- **"Ask SVC Directory" AI feature** — its own purple accent, separate from the entity colors:
  `--directory-ai: #A78BFA`, `--directory-ai-action: #7651bd`, plus soft/border variants. Has its
  own screen background (`.directory-ask-screen`), header, dock, compose box, suggestion chips, and
  a `.directory-ask-orb` conic-gradient pulsing listening indicator.
- **AI-generated content treatment** — `.directory-ai-shimmer` (amber→violet→cyan gradient sweep,
  1.6s loop) for loading placeholders, `.directory-ai-text` (same 3-color gradient clipped to text)
  for "narrative" copy the AI composed. This 3-accent (amber/violet/cyan) sweep is Directory's
  visual signature for "AI is generating this" — reuse it for any new AI-authored content inside
  Directory rather than the plain shimmer.
- **Row/list style is deliberately NOT glass-card**: per §9 of the Directory UI doc, results read
  "Google-Search-like" — 32px icons (circular initials for people, rounded-square for
  company/job), no chevrons, **no `divide-y`/`border-t` dividers**, separation is spacing + a light
  `hover:bg-white/3` only. Don't reintroduce card backgrounds/dividers here.
- **Outlooks sub-feature** (`components/directory/outlooks`, "3-Week Outlook" voice+AI capture)
  lives *inside* Directory's dark theme, no scope of its own. Its only bespoke classes are generic
  form primitives: `.outlook-label` (uppercase, 10px, tracked, muted) and `.outlook-input` (subtle
  white-on-transparent bordered field, violet focus ring `rgba(167,139,250,.35)` — matches
  Directory's job/AI violet), plus `.outlook-wave-bar` for the recording-state waveform animation.

### 3.3 SVC Applications — light module (candidate flow + reviewer dashboard)

The first "light" module. Wrapper: `.applications-scope` (`app/globals.css`, ~line 1096, with an
explanatory comment on the token-swap mechanism — read it if extending this module).

- **Base re-theme**: `--background: #F5F8FC`, `--card`/`--popover`: white, `--primary: #2563EB`
  (same blue as Stream/Directory's primary — intentional brand thread across dark and light), text
  `#0F172A` on `#64748B` muted.
- **Identity tokens** (`--apps-*`): `--apps-blue: #2563EB` / `--apps-blue-strong: #1D4ED8` /
  `--apps-sky: #38BDF8` / `--apps-blue-soft: #DBEAFE`.
- **Shared semantic "tone" vocabulary** — `components/applications/ui/tone.ts` exports
  `TONE_STYLES` for `neutral | info | pending | missing | complete | ai`, each giving a
  `pill`/`text`/`solid`/`soft` class bundle:

  | Tone | Color | Token |
  |---|---|---|
  | `info` | blue | `--apps-blue*` |
  | `pending` | amber `#B45309`/`#F59E0B` | `--apps-pending*` |
  | `missing` | coral-red `#DC5A5A`/`#F97373` | `--apps-missing*` |
  | `complete` | green `#15803D`/`#22C55E` | `--apps-complete*` |
  | `ai` | violet `#6D3EE0`/`#8B5CF6` | `--apps-ai*` |

  **This exact 5-tone vocabulary (info/pending/missing/complete/ai) is the app-wide semantic
  language for "state" colors in light modules** — Quest Coral reuses it verbatim (see 3.4). Use it
  for any new status/badge/progress UI instead of inventing new state colors.
- **Elevation, not glass**: `.applications-canvas` (barely-there blue radial wash on `#F5F8FC`),
  `.applications-card` — solid white, `1px solid var(--apps-border)`, a single soft shadow (`0 1px
  2px rgba(15,23,42,.04), 0 6px 16px rgba(15,23,42,.045)`). The CSS comment is explicit: *"Single
  elevation step — subtle, never glassy."* Do not add `backdrop-filter`/glass treatment here.
- **Primary button**: `.applications-primary-button` — vertical blue gradient
  (`var(--apps-blue)`→`var(--apps-blue-strong)`), `active:scale-[0.985]`, disabled → flat gray
  `#CBD8E6`.
- **Tap feedback**: `.applications-tap` (`active:scale-[0.99]`), consistent with the rest of the
  app's `transform`-only micro-interactions.
- **Loading screen**: `.applications-loading-screen` — white base + cyan/blue radial glints +
  animated diagonal "sky glint" sweep (`applications-sky-glint`), logo breathes via
  `.animate-applications-logo-breathe`.

### 3.4 SVC Quest Coral — light module (project tracking)

Second light module, same mechanism as Applications. Wrapper: `.quest-coral-scope`.

- **Base re-theme**: `--background`/`--card`: pure white `#FFFFFF`, `--primary: #FF7A59` (coral),
  `--primary-hover: #E8593A`, border `#E7E2DF` (warm neutral, not cool gray like Applications).
- **Identity tokens** (`--coral-*`): `--coral: #FF7A59` / `--coral-strong: #E8593A` /
  `--coral-soft: #FFF8F5` / `--coral-teal: #14B8A6` (secondary accent, used sparingly). Per the CSS
  comment, this is *"a soft, warm coral (closer to salmon than a saturated red-orange)"* —
  deliberately restrained, not a loud brand red.
- **Same 5-tone semantic vocabulary as Applications** (`components/quest-coral/ui/tone.ts`,
  `TONE_STYLES`), with one deliberate difference: `ai` reuses **coral itself**
  (`--coral-ai: #FF7A59`) instead of introducing violet — per its own code comment, *"AI keeps the
  coral identity in this module rather than introducing a second, competing accent colour."*
  `pending`/`missing`/`complete` reuse the exact same amber/red/green hex values as Applications
  (`#B45309`/`#DC5A5A`/`#15803D`) — these three are effectively app-wide constants, not
  module-specific.
- **Project status accent system** (`components/quest-coral/ui/project-accent.ts`,
  `projectAccent(project)`) — a *second*, independent status palette specifically for project
  cards/rings, keyed off `effectiveProjectStatus`:

  | Status | Ring/accent | Text |
  |---|---|---|
  | `completed` | `#35B868` (green) | `#229654` |
  | `at_risk` | `#F2A93B` (amber) | `#B76A04` |
  | `planning` | `#5B91F1` (blue) | `#3E78D5` |
  | *(active/default)* | `#FF6B52` (coral) | `#E8593A` |

  Note these are close-but-not-identical to the `TONE_STYLES` semantic colors — don't conflate the
  two systems; `project-accent.ts` is specifically for project-status rings/cards.
- **Elevation, not glass**: `.quest-coral-card` mirrors `.applications-card` exactly in mechanism
  (solid surface + single soft shadow), same "never glassy" rule.
- **Reading-copy treatment**: `.quest-coral-reading-copy` — for long-form AI answers/project
  context text specifically: darker neutral `#334155`, `font-weight: 500`, `line-height: 1.65`,
  `text-wrap: pretty`. Use this class (not the default body text style) for any new long-form
  prose block in this module.
- **Custom range slider** (`.quest-coral-range` + WebKit/Moz thumb pseudo-elements) — coral fill
  track, white thumb with coral border. Reuse if adding another slider control anywhere in the app.
- **AI-generating treatment**: `.quest-coral-ai-shimmer` / `.quest-coral-ask-generating-orb` mirror
  Directory's "AI is generating" pattern (sweep + pulsing orb + fade-in copy) but **re-skinned to
  coral-only** instead of Directory's 3-accent amber/violet/cyan — consistent with the
  single-accent-per-module philosophy above.
- **Loading screen**: `.quest-coral-loading-screen` — same sky-glint mechanism as Applications'
  loading screen, coral/teal radial glints instead of cyan/blue.

### 3.5 SVC ByeByeDPR — light module (field clock-in & reports)

Third light module, same mechanism as `.applications-scope`/`.quest-coral-scope`. Different
audience from every other module: field crew workers on a phone at a job site, not office/ops
staff — see `docs/svc-bye-bye-dpr-module.md` and its `PRODUCT.md`/`DESIGN.md`. Wrapper class:
`.byebye-dpr-scope`.

- **Base re-theme**: `--background: #FAFAFC`, `--card`/`--popover`: white, `--primary: #6D5BD0`
  (a restrained purple/violet — deliberately calmer than a saturated brand purple, since this
  module is used for seconds at a time, not a brand moment), border `#E7E5F0`.
- **Identity tokens** (`--bd-*`): `--bd-purple: #6D5BD0` / `--bd-purple-strong: #5C4BB8` /
  `--bd-purple-soft: #F1EEFB` / `--bd-sky: #2563EB` (links, location, the "Change job" affordance
  — not part of the identity hue, borrowed from the app-wide `info` blue).
- **Same 5-tone semantic vocabulary as Applications/Quest Coral** — `ai` keeps this module's own
  purple identity rather than introducing a second accent, same reasoning as Quest Coral keeping
  coral for `ai`.
- **Elevation, not glass**: same "single soft shadow, never glassy" rule as the other two light
  modules — `.byebye-dpr-card`. The one deliberate exception is sheets/drawers
  (`.byebye-dpr-sheet-glass`), per the module's own product brief ("a minimal touch of glass only
  in sheets/dropdowns, never the base screen").
- **"AI is generating" treatment** — `ByeByeDprAiGenerating` (`components/bye-bye-dpr/ui/`)
  mirrors Quest Coral's `QuestCoralAskGenerating` exactly (pulsing orb + rotating status copy +
  shimmer skeleton bars, `.byebye-dpr-ai-shimmer`/`-ai-generating-orb`/`-ai-generation-copy`),
  re-skinned to this module's purple instead of coral. Two sizes: `hero` (replaces a big focal
  element, e.g. the record button while a report is being structured) and `compact` (inline in a
  row). Reuse this rather than a generic spinner for any future "AI working" moment in this
  module.
- **Empty states** — `BdEmptyState` primitive, same shape as Quest Coral's "No projects match" /
  Applications' "No applications match": muted icon circle + bold title + muted description +
  optional action, in a flat card. Reuse this rather than hand-rolling a new empty-state layout.
---

## 4. Shared cross-module conventions (apply everywhere, any module)

- **Component library**: `components/ui/*` — full shadcn/ui set (`button`, `card`, `dialog`,
  `sheet`, `input`, `select`, `tabs`, `badge`, `skeleton`, `sonner`, …), style `"new-york"`,
  `baseColor: "neutral"`, configured in `components.json`. **Use these before building a new
  primitive.** Because of the token-swap mechanism (§1), they render correctly in every module
  without modification.
- **Icons**: `lucide-react` exclusively. No other icon set is used anywhere in the codebase.
- **No animation library**: every transition/entrance is a hand-rolled CSS `@keyframes` +
  `animate-*` utility class living in `app/globals.css`. Motion is `transform`/`opacity` only
  (GPU-cheap), and essentially every custom animation has a matching
  `@media (prefers-reduced-motion: reduce)` override that disables it. Follow this pattern for any
  new animation — don't reach for a JS animation library.
- **Motion signature**: entrance/exit easing is consistently `cubic-bezier(0.16, 1, 0.3, 1)` (soft
  overshoot-free ease-out) or `cubic-bezier(0.22, 1, 0.36, 1)`; durations cluster at **150ms**
  (micro tap feedback), **250–340ms** (element entrances), **400–600ms** (screen-level/logo
  entrances). Tap feedback is near-universally `active:scale-[0.98]` / `[0.985]` / `[0.99]` +
  `transition-all duration-150`.
- **Radius scale in practice** (measured frequency across `components/`, `app/`, `features/`):
  `rounded-full` (499 uses) ≫ `rounded-xl` (291) > `rounded-2xl` (146) > `rounded-lg` (69) ≈
  `rounded-md` (63) > `rounded-3xl` (19) > `rounded-sm` (18). Read: **pills/avatars/icon-buttons
  default to fully round; cards/sheets default to `xl`/`2xl`; small chips/inputs use `lg`/`md`.**
  All ultimately derive from the single `--radius: 0.625rem` token via `--radius-sm/md/lg/xl`.
- **Typography scale in practice**: `text-xs` (349) ≈ `text-sm` (336) dominate — this is a
  compact, mobile-first, information-dense UI, not a spacious marketing layout. `text-base` is
  occasional (form inputs), `text-lg`/`text-xl`/`text-2xl` are rare (screen titles, empty states
  only). Weight: `font-semibold` (479) is the default emphasis weight; `font-medium` (189) for
  secondary emphasis; `font-bold` (169) reserved for numbers/counters/strong headlines; avoid
  `font-light`/`font-normal` except for genuinely de-emphasized body copy.
- **Safe-area / viewport handling**: `--sab` custom property (safe-area-inset-bottom, with an
  Android PWA JS correction in `app/layout.tsx`), `.safe-area-pb` utility, `body` is
  `position: fixed` and sized via `visualViewport`-synced CSS vars (`--app-x/y/w/h`, see the
  `scroll-zoom` memory topic) — real scrolling happens only inside `overflow-y-auto` containers.
  Any new full-screen surface should follow this pattern, not rely on natural document scroll.
- **PWA brand color**: `#0B0F14` (matches `--background`) is the `theme_color`/`background_color`
  in `public/manifest.json` and the `<meta viewport>` `themeColor` in `app/layout.tsx` — this is
  the canonical "app chrome" color or the OS/browser UI around the app. If it's ever changed, keep
  it in sync with `--background`.

---

## 5. Rules for AI agents building new UI (maquetación checklist)

1. **Identify the module first.** Is this screen inside Stream/Directory (dark, glass) or
   Applications/Quest Coral (light, flat)? That decision drives every other choice below.
2. **Dark modules**: use the `.glass-*` utility classes (§3.1) for surfaces — don't paint a flat
   `bg-card` panel with a border where a `glass-panel`/`glass-modal` is expected. Use
   `.stream-glass-screen` or `.directory-glass-screen` as the screen root background, not a plain
   color.
3. **Light modules**: use the module's `-scope` wrapper + its `-canvas`/`-card`/`-topbar` classes.
   **Never add `backdrop-filter`/glass treatment here** — both light modules explicitly reject it
   ("never glassy"). A single soft shadow is the entire elevation vocabulary.
4. **State/status colors**: reuse the `info | pending | missing | complete | ai` tone vocabulary
   (`tone.ts` in the relevant module) rather than inventing a new badge color. If Directory-style
   entity-type colors are needed, use `DIRECTORY_ENTITY_META`. Never hand-pick a fresh hex for a
   "new" status meaning — map it onto the existing 5 tones or extend the tone table itself if it's
   genuinely a new semantic category.
5. **New light-themed module?** Copy the `.applications-scope`/`.quest-coral-scope` pattern:
   redefine the same base token set (`--background`, `--card`, `--primary`, `--border`, …), pick
   **one** identity hue, and reuse the shared tone vocabulary rather than inventing a parallel
   state-color system.
6. **Icons**: `lucide-react` only. **Fonts**: don't introduce a new font — Sora (UI) / JetBrains
   Mono (code/mono) covers the whole app.
7. **Animations**: write a CSS `@keyframes` + `animate-*` class in `app/globals.css` (or the
   module's own block), transform/opacity only, and add a `prefers-reduced-motion` override. Match
   the existing easing/duration signature (§4) rather than picking arbitrary values.
8. **Before adding a new shadcn primitive**, check `components/ui/` — the full set is already
   installed and will theme correctly in any module for free.
9. **Radius/type/spacing**: default to `rounded-full` for round elements, `rounded-xl`/`2xl` for
   cards/sheets; default to `text-xs`/`text-sm` + `font-semibold` for UI chrome, reserving larger
   sizes for genuine headings/empty-states.

---

## 6. File map

| File | Role |
|---|---|
| `app/globals.css` | **the** stylesheet — active tokens, `@theme inline`, all glass/module utility classes, all `@keyframes` |
| `styles/globals.css` | dead shadcn boilerplate, **not imported anywhere** — ignore |
| `app/layout.tsx` | font loading (`@fontsource/sora`, `@fontsource/jetbrains-mono`), PWA meta/viewport, safe-area JS, body positioning |
| `components.json` | shadcn config: style `new-york`, baseColor `neutral`, icon lib `lucide` |
| `components/ui/*` | shared shadcn primitives, theme automatically via CSS custom properties |
| `lib/utils.ts` | `cn()` helper, `getUserAvatarColor()` deterministic avatar palette |
| `lib/directory-config.ts` | `DIRECTORY_ENTITY_META` — person/company/job color+icon map |
| `components/applications/ui/tone.ts` | Applications' `TONE_STYLES` (info/pending/missing/complete/ai) |
| `components/quest-coral/ui/tone.ts` | Quest Coral's `TONE_STYLES` (same vocabulary, coral-flavored) |
| `components/quest-coral/ui/project-accent.ts` | project-status ring/card color system (separate from tone.ts) |
| `components/applications/ui/apps-primitives.tsx` | Applications-specific building blocks (cards, form fields, sheet) |
| `components/quest-coral/ui/quest-coral-primitives.tsx` | Quest Coral-specific building blocks |
| `components/bye-bye-dpr/ui/byebye-dpr-primitives.tsx` | ByeByeDPR-specific building blocks (`BdButton`/`BdCard`/`BdEmptyState`/…) |
| `components/bye-bye-dpr/ui/tone.ts` | ByeByeDPR's `TONE_STYLES` (same vocabulary, purple-flavored `ai`) |
| `components/bye-bye-dpr/ui/byebye-dpr-ai-generating.tsx` | ByeByeDPR's "AI is generating" component (mirrors Quest Coral's) |
| `public/manifest.json` | PWA theme/background color (`#0B0F14`, must match `--background`) |
| `docs/svc-directory-ui-context.md` | deep build context for Directory specifically (data model, screens, pending work) |
| `docs/svc-bye-bye-dpr-module.md` | build context for ByeByeDPR (backend + UI mockup progress, both phases) |

---

## 7. Known gaps / caveats

- This audit covers **visual identity/tokens/CSS conventions**, not full component-by-component UX
  specs. For Directory's screen-by-screen structure, read `docs/svc-directory-ui-context.md`
  directly — don't infer it from this file.
- `styles/globals.css` is confirmed unused (no import found anywhere in `app/`, `components/`,
  `lib/`, `features/`) as of this audit — flagged here rather than deleted since it wasn't part of
  the ask; safe to delete in a future cleanup pass with explicit confirmation.
- Applications and Quest Coral currently duplicate the `pending`/`missing`/`complete` hex values
  independently in their own `tone.ts` rather than sharing a single constant — if a third light
  module is added, consider whether those three should be promoted to true global tokens instead
  of being copy-pasted a third time.
- **ByeByeDPR (§3.5) is UI-mockup-only as of this update (2026-08-07)** — the screens exist and
  are visually consistent with the rest of the app, but run entirely on mock state (no calls to
  its own backend, which was built separately and is not deployed). Don't assume the module is
  "live" the way Applications/Quest Coral are; check `docs/svc-bye-bye-dpr-module.md` for current
  phase status before building on top of it.
- This file should be **updated whenever a new module/scope is added, or when the token values in
  `app/globals.css` change** — it will drift otherwise. Re-run the audit rather than hand-editing
  stale values in.
