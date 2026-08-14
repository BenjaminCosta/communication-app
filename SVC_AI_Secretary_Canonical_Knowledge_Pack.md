---
title: "SVC AI Secretary — Canonical Company & Product Knowledge Pack"
audience: "internal"
language: "en"
status: "audited-v3.2 / code-grounded product knowledge + restored human-confirmed company context + Messages read layer + company/mission companion document"
last_updated: "2026-08-14"
purpose: "Stable company, product, workflow, and tutorial knowledge for the SVC AI Secretary"
audit_note: >
  v2 (2026-08-13) was produced by reading the actual current code, Firebase rules,
  and every docs/svc-*.md file in the repository, replacing an earlier draft that
  mixed project-conversation context with product behavior under one label. v3
  (2026-08-14) restored the genuine company/organizational/strategy context that
  v2 had downgraded solely because application code has no way to encode a
  company's name or mission — that content is back under its own explicit
  PROJECT CONTEXT / HUMAN-CONFIRMED label (see §1), distinct from
  CODE / PRODUCT VERIFIED, without reopening any of v2's code-grounded product
  corrections. This document is also now the Secretary's actual live Company
  Knowledge source (§13), parsed and retrieved by lib/knowledge-pack.ts. v3.1
  (same day) documents the new Messages/Communications read layer (§13, §21) —
  the one remaining structurally-excluded module through v3 — now a real,
  deliberately privacy-split capability: automatic operational posts open to
  any internal sender, human-written messages scoped to the requester's own
  visibleToUserIds. v3.2 (same day) integrates a second knowledge document,
  SVC_Company_Mission_Operating_Framework_Knowledge.md, into the same
  lib/knowledge-pack.ts retrieval pool (§1, §13) — deeper company/mission
  context (Site Supervision, Provide and Guide, the Vision->Mission->Operation
  ->Objective->Goal->Task->Action framework, Cool Breeze, Operation Major Kong,
  the Adventure Map) than this pack's own §2 previously carried, with its own
  independent evidence-label vocabulary and an explicit HISTORICAL /
  TIME-SENSITIVE distinction this pack did not previously have a label for.
  This pack's own §2 was not rewritten, only cross-referenced, to avoid
  disturbing already-audited content.
---

# SVC AI Secretary — Canonical Company & Product Knowledge Pack

# 0. Purpose of this document

This document is intended to become a **trusted internal knowledge source** for the SVC AI Secretary.

It is not a database dump and it is not a replacement for live SVC data.

Use this document for relatively stable knowledge such as:

- what SVC is;
- how SVC operates;
- what each SVC application/module is for;
- when an employee should use each module;
- how the main workflows work;
- how the modules relate to each other;
- internal terminology;
- onboarding guidance;
- common user questions;
- known product rules and boundaries.

Use **live application data/tools** for changing information such as:

- current people;
- current phone numbers or emails;
- jobs;
- project status;
- recent updates;
- applications;
- reports;
- clock-ins;
- outlooks;
- current dates or deadlines.

Do not treat this document as authority when current code, Firebase data, or live SVC configuration clearly says otherwise.

---

# 1. Reliability and source-of-truth rules

This pack combines two things, kept clearly distinguishable throughout: product/technical knowledge rebuilt by directly auditing the current repository (every route, component, Firestore rule, and `docs/svc-*.md` file cited below was actually read, not inherited from prior conversation summaries), and company/organizational knowledge restored from the accumulated SVC project conversations with the person who built and runs SVC, which code was never going to contain in the first place.

## Evidence labels

### CODE / PRODUCT VERIFIED
Directly observed in current code, current Firestore/Storage rules, or a current `docs/svc-*.md` file that itself matches the code. The strongest label for *how the product behaves*.

### PROJECT CONTEXT / HUMAN-CONFIRMED
Explicitly stated by the person who built and runs SVC, in the accumulated project conversations that produced this pack — company identity, business model, organizational language, mission/strategy framing, and the "why" behind a product decision. This is genuine company knowledge, not a guess and not an invention: application code simply has no mechanism to encode a company's name, mission, or org structure, so the absence of a code trail does not weaken this label the way it would weaken a *product-behavior* claim. Use this label for company/business/strategy facts; use CODE / PRODUCT VERIFIED for how the app actually works. Where the two describe the same thing from different angles (e.g. "SVC's apps should work as one connected system" as a stated strategy vs. as an observed architecture), both labels are cited together.

### PRODUCT DIRECTION
A real, implemented feature that is still evolving, partially wired, gated behind a feature flag, or — in one specific case this pass (see §8) — present only as **uncommitted work-in-progress** on the current branch. Treat the described behavior as the intended direction, not necessarily what every environment is currently running.

### NEEDS VERIFICATION
Neither reliable current-code evidence nor an explicit human-confirmed project statement exists. Do not invent the missing behavior. Most of these are things that live outside the repository (Vercel production environment variables, actual Firebase Functions deployment state) and cannot be settled by reading code alone.

## Authority order

For **product/technical behavior** (what a screen does, what a field is called, what a rule enforces):

1. Current production code and current Firebase/data model.
2. Current Firestore/Storage security rules (they define what is *actually* enforced, which sometimes differs from what a doc or the UI implies).
3. Current `docs/svc-*.md` files, cross-checked against the code above.
4. This knowledge pack.
5. Older project discussions not reflected in any of the above.

For **company/business/strategy context** (what SVC is, why it exists, how it organizes itself), code has no authority to confer or withhold — it was never going to contain a mission statement. There, PROJECT CONTEXT / HUMAN-CONFIRMED entries in this pack (§2) are themselves the authoritative source, not a fallback below code.

If a *product-behavior* question cannot be verified, the Secretary should say that it does not have enough reliable information rather than inventing an answer. That standard does not apply to company-identity questions answered from PROJECT CONTEXT / HUMAN-CONFIRMED material — the Secretary should answer those directly.

## Companion document: company/mission framework

**Status: CODE / PRODUCT VERIFIED** (that the companion document exists and is wired into retrieval — its own content is source-labeled independently, below)

`SVC_Company_Mission_Operating_Framework_Knowledge.md` (repo root) is a second knowledge document, parsed and scored together with this one by the same `lib/knowledge-pack.ts` pipeline (§13) — one retrieval system, two source files, not a separate knowledge system. It covers what this pack's §2 only summarizes: Site Supervision and the Site Supervisor role in depth, "Provide and Guide," the Suits/Boots technology philosophy, the full Vision → Mission → Operation → Objective → Goal → Task → Action hierarchy with planning-horizon heuristics, Cool Breeze, Operation Major Kong, the sales/job progression milestone framework, and the SVC Adventure Map tutorial link.

It uses its own, independent evidence-label vocabulary rather than this pack's four labels — **COMPANY-SOURCE CONFIRMED**, **PRODUCT / CODE CONFIRMED**, **HISTORICAL / TIME-SENSITIVE**, and **NEEDS CLARIFICATION** — because it draws on different source material (Joseph's onboarding notes and SVC's own internal presentation decks, not this pack's code-audit + project-conversation mix). Treat both label sets the same way: relay whichever label and wording a chunk actually carries, faithfully, rather than trying to force one document's vocabulary onto the other's. Its **HISTORICAL / TIME-SENSITIVE** label is the important one to never collapse into settled fact — see its own §17/§19/§22 (Cool Breeze, Operation Major Kong, company history/scale): a concept being real, confirmed company knowledge is not the same as it being confirmed as SVC's currently active Mission/Operation/target today. Current active-status should come from live evidence, not from this document set alone.

---

# 2. SVC company overview

This section blends two evidence types, labeled per paragraph: what current code/product can verify, and what the person who built and runs SVC has explicitly stated about the company itself in project conversations. Code was never going to contain a mission statement, so absence from the repository does not weaken the second kind of claim — see §1's label definitions.

## What SVC is

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED**

SVC stands for **Supervision Company**.

SVC is a U.S. construction-site supervision company. Its core business is not software itself — the technology exists to support and scale the supervision service. SVC operates around the problem of getting qualified site supervisors onto construction projects and supporting those supervisors and clients throughout the job.

The service has been described as a full-service supervision model that can include:

- finding, recruiting, and evaluating/vetting supervisors;
- placing supervisors on jobs;
- supporting and training supervisors;
- managing active supervision and replacing supervisors when required;
- supporting field operations;
- helping contractors and construction companies keep projects supervised.

A site supervisor is the person responsible for coordinating and overseeing onsite construction activity — trades, schedule, quality, safety, daily issues, and communication with the project/client side.

**Status: CODE / PRODUCT VERIFIED** — Independently, the product surface is unambiguously built around **construction-site field operations**: job sites, daily reports, clock-in/out, trades, and site-supervision language appear throughout the code (ByeByeDPR's own product brief in `PRODUCT.md` describes its users as "field crew workers (carpenters, electricians, laborers, foremen)... on a job site"). This is consistent with, and corroborates, the supervision-company framing above, even though the app code has no mechanism to state a company mission and doesn't need one to confirm this much.

## Business operating areas

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED**

The SVC operating model has repeatedly been discussed around three core areas:

- **Sales**
- **Recruiting**
- **Field Operations**

Other connected operational areas discussed alongside the platform include preconstruction/forecasting, finance, applications/candidate onboarding, project tracking, communications, reporting, and clocking/attendance.

A high-level company lifecycle, end to end:

```text
Lead / Client
→ Job opportunity
→ Forecast / coverage need
→ Recruit / match supervisor
→ Candidate onboarding
→ Supervisor placement
→ Active field operations
→ Daily reporting / planning / project tracking
→ Issues / updates / replacement if required
→ Billing / closeout / continued relationship
```

This is the business-level flow behind the product-level cross-module workflows documented in §16 — Sales/Recruiting produce the candidate who goes through Applications (§9/§16.1), and Field Operations is the world ByeByeDPR, 3-Week Outlooks, and Quest Coral operate in day to day (§16.2).

## Organizational language

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED**

SVC has used the planning hierarchy:

```text
Vision
→ Mission
→ Operation
→ Objective
→ Goal
→ Task
```

The stated vision is:

> Lift everybody up.

The mission discussed in the project has been:

> Cool Breeze.

The organizational framework called **Operation Major Kong** has been discussed as grouping Sales, Recruiting, and Field Operations together.

This language is company-specific and should be preserved when answering questions about SVC's planning or organizational structure — it is genuine company context from the people who run SVC, not a claim this pack is asking the reader to independently verify against the codebase. For what it's worth as a minor, non-dispositive data point: a repo-wide search found the string `"Cool Breeze"` used once as a placeholder example inside a Quest Coral project-name input field (`components/create-project-modal.tsx:73`, `placeholder="e.g. Cool Breeze Phase 2"`) — a UI hint text, not proof of the mission framing, but consistent with the name being one a developer had actually heard in use at SVC.

For the full depth on this framework — planning-horizon heuristics for each level, Cool Breeze's stated target, how Operation Major Kong's objectives break down, the sales/job progression milestone model, and the important distinction between "this is real company knowledge" and "this is confirmed as SVC's currently active Mission/Operation today" — see the companion document `SVC_Company_Mission_Operating_Framework_Knowledge.md` (§1 above). Don't assume Cool Breeze or Major Kong are still active without live confirmation; this pack's brief mention here shouldn't be read as more current or more authoritative than that document's own careful treatment.

## Strategic product principle

**Status: CODE / PRODUCT VERIFIED, and independently PROJECT CONTEXT / HUMAN-CONFIRMED as intent**

The SVC software platform is intended to become an internal operating system connecting the company rather than a collection of unrelated apps — the apps should increasingly share the same people, companies, jobs, relationships, and operational context, with the AI Secretary sitting above them as a conversational access layer that doesn't require a user to know where a given piece of information lives.

The *engineering* reality independently backs this up — this is not just stated intent:

- All five modules run inside one Next.js app, share one Firebase project (`svc-comms`), one Auth session, and one module switcher (`components/module-switcher.tsx`).
- Directory exists specifically to be the shared people/company/job layer other modules increasingly reference (ByeByeDPR jobs link to Directory contexts via `directoryContextId`; Quest Coral people are real Directory/Communications contacts, not free text; the WhatsApp Secretary resolves entities through Directory first before falling back to a module's own data).
- Cross-module bridges exist at the data layer, not just conceptually: Quest Coral Feedback mirrors into Communications; ByeByeDPR Daily Reports mirror into both Communications and Directory Files/Notes; clock-in/out events post to Communications.

So "SVC's apps are meant to work as one connected system, not silos" is both a stated company strategy and an observed architectural fact — a case where the two evidence types reinforce each other.

---

# 3. Platform architecture — technical map

**Status: CODE / PRODUCT VERIFIED**

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React 19, TypeScript, Tailwind CSS 4 |
| UI primitives | Radix UI / shadcn ("new-york" style), Lucide icons, Sora + JetBrains Mono fonts |
| Backend | Firebase Auth, Firestore, Storage, Cloud Functions (v1 API), FCM push |
| AI | OpenAI models via a shared server-side client (`lib/ai/openai/client.ts`), different default models per module |
| Search | MiniSearch built client-side in a Web Worker, cached in IndexedDB (Directory) |
| PWA | `public/manifest.json`, custom service worker `public/sw.js` |
| Package manager | pnpm |

Despite using the Next.js **App Router**, the app is functionally a client-side SPA: almost all business logic, auth, listeners, and screen state live in one large client component, `app/page.tsx`, which drives navigation through an internal `Screen` union rather than real per-screen URLs. `app/api/*` routes exist, but only as backend endpoints (webhooks, AI calls, server-authoritative writes) — not as page routes for the five modules.

## The five modules

```text
SVC user (one Firebase Auth session)
   │
   ├── Communications ("Stream") — messages, recipients, tags, contexts, calendar
   ├── Directory — people / companies / jobs / contexts search + profiles + Ask AI
   ├── Applications — candidate application → review → agreement → hired
   ├── Quest Coral — project tracking (status, updates, feedback, timeline)
   └── ByeByeDPR — field clock-in/out + Daily Reports
```

Module switching happens via `ModuleSwitcher` in the header of every module; the last module used is remembered (`localStorage`/cookie key `svc-last-module`) and reopened on next login. Directory's 3-Week Outlook is **not** a sixth module — it's a tab inside a Directory job profile (see §8).

## Design language

Two visually distinct families, by design (`docs/svc-design-system.md`, distilled in `DESIGN.md`):

- **Dark, glassmorphic** (frosted `.glass-*` panels over a radial-gradient canvas): Communications/Stream, Directory.
- **Light, flat elevation** (solid white cards, no glass on the base surface): Applications, Quest Coral, ByeByeDPR. Each has its own single identity accent hue (e.g. ByeByeDPR's purple/violet `--byebye-purple: #6D5BD0`) layered over a shared 5-tone semantic status vocabulary (complete/missing/pending/info/ai) reused across all light modules rather than each inventing new colors.

---

# 4. Core data concepts

## 4.1 Recipients / visibility

**Status: CODE / PRODUCT VERIFIED**

`visibleToUserIds` is the current source of truth for who can read a Communications message. It is computed as exactly:

```text
message author + explicit selected recipients (registered contacts + linked imported contacts)
```

Tag/project membership, context links, and contact linkage do **not** grant read access on their own. This is enforced twice: in `firestore.rules` (read/update require the caller's uid to be in `visibleToUserIds`, falling back to the legacy `participants` field only when `visibleToUserIds` is absent) and again client-side after merging listener results (`features/communications/messages/message-feed-model.ts`), which drops any message the current uid isn't actually authorized for even if a stale/legacy query returned it.

One real nuance worth knowing: editing a message's recipients later (via the message detail "Tag" sheet) **recomputes `visibleToUserIds` from scratch** — so removing someone from a message's people list can genuinely revoke their read access, not just stop adding new access. The legacy `participants` field, by contrast, is deliberately append-only and never shrinks. Do not conflate the two.

## 4.2 People

**Status: CODE / PRODUCT VERIFIED**

People are stored as `/contacts` documents. Contacts are **global-read**: any authenticated SVC user can read the full contacts collection; writes are scoped to the contact's `ownerUserId`. There is no private/global toggle anymore (removed as of 2026-07-10).

When a person with a verified email registers or updates their email, a Cloud Function (`autoLinkOnRegister` / `autoLinkOnUserEmailUpdate`) matches them against existing `/contacts` records by normalized email and links the new Firebase uid to the existing imported contact — including back-filling that uid onto every message that already referenced the contact — rather than creating a duplicate identity.

## 4.3 Companies and Jobs

**Status: CODE / PRODUCT VERIFIED**

Companies, jobs, and other business entities live in `/contexts`. Unlike `/contacts`, any authenticated user can **update** a context document (only the original creator can delete it) — this is a real, intentional asymmetry in the current rules, not an oversight, and it means Directory's company/job edit permission is broader than its person edit permission.

Jobs are the connective entity across modules: a Directory job (`/contexts` doc, `directoryType: "job"`) can be the same job a ByeByeDPR `Job` document links to via `directoryContextId`, and the same job a 3-Week Outlook is attached to via that job's `sourceId`.

## 4.4 Contexts

**Status: CODE / PRODUCT VERIFIED**

In Communications, a "Context" (`AppContext`) is a lightweight, freely-editable record representing a company, project, or topic that a message can be linked to for organizational purposes (`Message.contextIds`). Contexts **never affect message visibility** — this is explicit in the code (`lib/store.ts`, `contextIds` doc-comment: "never affects visibility") and in the Contexts screen's own empty-state copy: *"Contexts help connect messages to a project, company, or topic."*

Do not confuse a Communications "Context" with Directory's "other" entity type or with Quest Coral's "Project Context" (a per-project Markdown brief — see §7) — three different concepts that happen to share the word "context."

## 4.5 Tags

**Status: CODE / PRODUCT VERIFIED**

Tags are backed by the `/projects` collection — there is no separate `/tags` collection. What the UI calls "Tags" is a merge of:

1. Five fixed **system type tags**: `type:progress | type:problem | type:feedback | type:decision | type:none`, labeled Progress / Problem / Feedback / Decision / **Unassigned**.
2. Every document in `/projects`, each rendered as a user-created tag.

`TagCategory` and `CATEGORY_CONFIG` still exist as real, actively-used types in the code (they gate things like whether selecting a tag auto-opens the date picker) — they were not deleted. What actually changed is that the **create-tag UI no longer lets a user pick a category**: every quick-created tag is hardcoded to category `"custom"`. So "categories were removed" is only true at the tag-creation UI level, not at the data-model level — an important distinction if the Secretary is ever asked whether tag categories exist.

The screen a user experiences as "Tags" is literally titled **"Tags"** (component `ProjectListScreen`), with search placeholder "Search tags..." and an "Edit tag" modal.

Conceptually, unchanged from before:

```text
Recipients = who sees it
Contexts   = what/who it's about (organizational, not access control)
Tags       = lightweight classification (type + project/tag)
Dates      = when (Calendar)
Messages   = the actual content
```

---

# 5. Communications (Stream)

**Status: CODE / PRODUCT VERIFIED — this section was re-audited end-to-end against current code**

## Purpose

Communications — internally also called **Stream** — is SVC's shared messaging layer: directed operational messages with explicit recipients, optional tags, contexts, calendar dates, replies, and image/file attachments. It is the module a fresh login lands in by default in the absence of a remembered module, though technically it lands on **Compose** first (see "Landing screen" below), not the Stream feed itself.

## Message model

A Message record can carry: sender/author id, explicit recipients (`recipientIds`/`peopleIds`, resolved to real Firebase uids), the computed `visibleToUserIds` ACL, a message `type` (`progress | problem | feedback | decision | none`), free text, tags (`tagIds`, plus legacy `projectId`/`projectIds`), imported-contact links (`contactIds`), Contexts (`contextIds`), one or more calendar dates (`calendarDates`), an image (with BlurHash placeholder + dimensions) or a non-image file attachment, and reply threading (`replyToId` + a lightweight `replyPreview`). Messages created by the Quest Coral Feedback bridge additionally carry `sourceModule: "quest-coral"` and related ids — these are automatically read-only in the Communications UI (delete/tag-edit/favorite are disabled with an explicit toast explaining why).

## Compose flow (exact, current UI)

Screen header: **"New Message."** Body, top to bottom: a search bar to jump to people/tags/contexts, a "What's on your mind?" prompt, the message text box, then a row of option chips in this literal order:

1. **Who** — *"Recipients are the people who can see this message."*
2. **Tag** — *"Tags help classify messages, like Task, Follow Up, Question, or Important."*
3. **Image** — *"Attach a photo to give more context to the message."*
4. **Date** — *"Add a date when this message needs follow-up, action, or attention."*
5. **Context** — *"Contexts show what a message is related to, like a project, company, topic, or workflow."*

Tapping **Send →** uploads/compresses any image (max 5 MB, auto-resized to a 1600px long edge and re-encoded to WebP where possible, with a BlurHash generated client-side), computes `visibleToUserIds`, writes the message, and returns to Stream.

There are actually **two independent send surfaces** that both call the same underlying send function: the full-screen Compose above, and an always-docked **quick-compose bar** at the bottom of the Stream feed itself (tap the same Who/Tag/Date/Context/Image controls in a compact sheet without leaving Stream). If a tag/project filter is currently active in Stream, quick-sending without picking a tag auto-applies that filter's tag to the new message — worth knowing so a user isn't surprised their message picked up a tag they didn't explicitly choose.

## Stream (the feed)

Messages are grouped by day (**Today / Yesterday / weekday name / "Mon D"**). Filters: People, Tag, Date, Context, plus an "All" chip that clears everything. The **"Me"** people-filter specifically means *"messages I sent"*, not *"messages I'm a recipient on"* — a common point of confusion worth pre-empting in a tutorial.

Swiping a message reveals a reply action; the first reply in a thread auto-seeds the quick-composer's recipients from the original message's recipients. Long text (>360 characters) is clamped with a "Read more"/"Read less" toggle. Long-press (or right-click on desktop) opens a selection menu for favoriting a message or pinning a tag chip.

Tapping a message opens its detail/tag sheet (internally the `"tag"` screen, component `TagSheet`) — this is where Who/Tag/Date/Context are edited after the fact, and where a message actually gets deleted or favorited.

## Calendar

Any message can carry one or more calendar dates. The Calendar screen groups messages by date, shows up to 3 dots per day, and a day-detail panel lists that day's messages. A separate, deliberately minimal composer (`CalendarComposeSheet` — text + people + tags only, no image/context) is used when adding a message directly from Calendar's "Add" button.

A daily cron (`onDailyCalendarReminders`, 08:00 UTC — not the user's local time zone) sends one deduplicated reminder push per message-with-a-today-date to everyone in that message's `visibleToUserIds`.

## Notifications

Every message create/update fires an FCM push (`onMessageCreated` / `onMessageUpdated` Cloud Functions) to the newly-visible recipients, respecting each user's own notification preference ("instant" vs "muted," set in the **Notifications** screen). Invalid/stale device tokens are pruned automatically. The service worker (`public/sw.js`) handles background push display and deliberately never caches `/_next/` build assets, to avoid serving stale app code.

## Tags/Contexts/People screens

- **Tags** (`ProjectListScreen`) — browse/search/create/edit the `/projects` tag catalog.
- **Contexts** (`ContextsScreen`) — browse/search/create/edit `/contexts` links used purely for organizing messages (see §4.4 — never a visibility mechanism).
- **People** (`PeopleScreen`) — contacts, including VCF import.

## PWA / landing behavior

**Not previously documented, and easy to get wrong**: a fresh sign-in with no remembered last-used module lands directly on the full-screen **Compose** screen — not the Stream feed. This is deliberate (`composeMode` initializes to `"fullscreen"`), and it's worth the Secretary knowing so it doesn't describe "opening Communications" as "seeing your messages" for a brand-new session.

In-app onboarding (`HelpScreen`, titled **"How it works"**) is a 10-slide swipeable guide (Messages, Replies, Tags, Contexts, People & Contacts, Dates & Calendar, Images, Search & Filters, Favorites & Pins, Notifications) reachable from the user's Profile — it is **not** shown automatically on first login. It's a strong source of exact, SVC-approved user-facing phrasing for tutorials, since it's literally what SVC already tells its own users.

PWA install prompting (`components/pwa-install.tsx`) auto-appears ~1.8s after Stream settles if the app is installable and the user hasn't snoozed it (7-day snooze on dismiss), with separate instructions for Chrome/Edge, iOS "Add to Home Screen," and macOS Safari "Add to Dock." iOS specifically requires installing to the home screen before push notifications can be enabled.

## Relationship to other modules

- **Quest Coral → Communications**: only **Feedback**-type Quest Coral activity (not Update, Blocker, or Red Team Review) is automatically mirrored into Communications as a read-only message, addressed to the project owner plus any project people who are registered SVC users. Replies to that mirrored message route through a server API (not a normal client write) and thread back into Quest Coral's own feedback-reply record. See §7.
- **ByeByeDPR → Communications**: submitting a Daily Report, and clocking in/out, each automatically post a short factual message into Communications (recipients: the job's configured `notifyUserIds`, or every registered user if none are configured). See §10.
- **3-Week Outlook → Communications**: as of the last **committed** code, publishing an Outlook update opens Compose with a pre-filled draft that a human must explicitly send — it does not post silently. **A different, uncommitted, in-progress change exists on the current working branch that would make this fully automatic instead; see §8 for why that must not yet be treated as shipped behavior.**

---

# 6. Directory

**Status: CODE / PRODUCT VERIFIED — re-audited end-to-end against current code**

## Purpose

Directory is SVC's structured discovery layer for people, companies, jobs, and other business entities, derived from `/contacts` and `/contexts` and enriched by a master data-reconciliation pipeline. It exists because a flat contact list stopped being usable once SVC's contact base grew into the thousands.

## Entity types and visual language

`DirectoryType = person | company | job | other`. The UI only ever exposes **person / company / job** as browsable scopes (`other` is excluded from the scope tabs, though it can still appear as a relationship target). Visually: a person is a circular avatar with initials; a company or job is a rounded-square icon (`Building2` / `BriefcaseBusiness`), each with its own type color.

## Home / search UX (exact, current)

Directory's Home headline literally reads **"Find people, companies and jobs."** Below the search bar sits an **"Ask AI"** entry pill (feature-flagged) and three scope pills — **People / Companies / Jobs** (there is no "All" pill on Home itself). With an empty query, tapping a scope pill browses that type alphabetically, most-recent-first; with a submitted query, the view switches to **Results**, which does show a full **All/People/Companies/Jobs** tab set plus an "About N results" count and a "Load 50 more" pagination pattern. Results are a single relevance-ranked list within the active scope — they are **not** grouped into separate People/Companies/Jobs sections the way "grouped results" might imply; only Home's type-browse mode is single-type.

Favorites is a dedicated full-screen overlay (title **"Favorites"**), not a modal. There is no separate module-nav icon inside Directory — switching to another module happens only through the header's `ModuleSwitcher`.

## Profile screen

The live profile component is `DirectoryProfileScreen`; an older `directory-detail-screen.tsx` file still exists in the repo but is dead code, imported nowhere. Tabs, in order: **Overview → Outlook (job entities only) → Related → Notes → Files.**

The profile header shows the entity's type, name, an optional headline, location, and status badges — a person can show "Internal user"/"External contact" plus Active/Inactive; a job additionally shows a computed **Health pill** (Healthy / Needs attention / At risk), derived from whether it has a supervisor, a confirmed start date, an address, and whether it's flagged legacy/needs-review.

An **"AI summary"** paragraph appears near the top of most profiles. **This is not a language-model call** — it's a deterministic, template-based sentence generator (`lib/directory-descriptions.ts`, whose own header comment says "no LLM call") that picks among a handful of pre-written phrasings seeded by a hash of the entity's own fields. Do not describe this as GPT-generated; that's a different feature entirely (Ask AI, below). This distinction matters because a user could reasonably — and incorrectly — assume the "AI summary" badge means the same thing as "Ask SVC Directory."

Quick actions (Call / Email / Directions / Website / Open Drive / Edit) only appear when the underlying data supports them. **There is no "Message"/"Compose" quick action on a Directory profile** — Directory does not offer a way to jump directly into composing a Communications message to a person from their profile. The two modules share underlying contact data, but there's no UI bridge between viewing a profile and starting a conversation about that person.

The **Related** tab groups differently per entity type: a person shows Company / Jobs / Related people; a company shows People / Jobs; a job shows Company / Project Manager / Project Lead / Supervisors / Related contacts. These relationships come from a pre-computed, confidence-gated `/directoryRelations` collection — low-confidence/ambiguous matches never surface here; they sit in an admin-only review queue instead, so what's shown is meant to already be reasonably trustworthy.

Editable fields are type-specific: a person can edit Name/Role/Company/Primary phone/Primary email/Address/Notes; a company can edit Name/Phone/Address/Website/Description; a job can edit Name/Status/Address/Location/Duration/Project type/Report cadence/Operational notes. Edits always write back to the source `/contacts` or `/contexts` document, never to the derived `/directoryIndex`.

One asymmetry worth knowing for a tutorial: **any authenticated user can edit a company or job**, but **only the contact's own owner can edit a person** — so "Edit" always appears on a person profile, but a non-owner's save attempt will fail with a generic error.

## Notes and Files

Both are separate collections keyed to an entity by id, globally readable, but only the author (Notes) or uploader (Files) can edit/delete their own entries — everyone else's are read-only to you. Files cap at 15 MB with automatic image compression.

Directory notes do **not** currently have semantic (embedding-based) search wired into production, despite an embeddings pipeline existing for a related purpose. A Cloud Function embeds each entity's derived summary text (`askContext.aiText`) for Ask AI's own retrieval — but the specific "search notes by meaning" code path (`searchNotesSemantic`) is defined in the provider interface and never implemented by the real production provider, whose own comment says semantic note retrieval is "intentionally absent until the askContext backfill + embeddings land." In practice, note search today is always lexical keyword scoring, not vector search — if the Secretary is asked whether it can find notes "about roughly this idea" rather than by matching words, the honest answer is not yet.

## Ask SVC Directory

A feature-flagged natural-language assistant, entry point an "Ask AI" pill on Directory's Home (not shown once you've typed a search query). Screen title: **"Ask SVC Directory."** Retrieval is fully server-side: the question is analyzed, a query plan is built, a bounded set of read-only tools run (search people/companies/jobs, get entity details, get relationships for a company/job/person, find shared contacts/jobs between two entities, find a connecting path between two entities via a bounded graph search, and search notes — lexically, per above), and the model answers only from what those tools actually returned.

Phone numbers, emails, addresses, and pay rates are deliberately **never sent to the underlying model** at all — they're stripped before the context text is even built. This is a hard architectural boundary, not a prompt instruction. If a question is ambiguous between two same-named people, the assistant asks the user to pick one before proceeding, rather than guessing. A "Focus on" chip lets a user pin one entity so a follow-up question stays scoped to it.

## Deep links

Directory profile/Outlook URLs follow the shape `?directory=<compositeId>&view=profile` or `&view=outlook`. Directory itself has no in-app "share/copy link" button that produces this URL — the only current producer of these deep links is the WhatsApp Secretary's own guidance module, which builds them server-side when it wants to hand a user a CTA button back into the app.

## Relationship to other modules

- **Directory ↔ Quest Coral**: no code-level linkage exists at all today — not even a shared id. Switching between them is a full module switch, nothing entity-specific.
- **Directory (job) → Outlook**: this is Directory's own "Outlook" tab, described fully in §8 — it is not a separate module.
- **Directory → Communications**: no direct entity-level jump; the two modules simply read overlapping underlying `/contacts`/`/contexts` data.

---

# 7. Quest Coral

**Status: CODE / PRODUCT VERIFIED — re-audited end-to-end against current code**

## Purpose

Quest Coral is SVC's shared project tracker: status, progress, people involved, a "next step," a past/present/future timeline, and a running feed of Update / Feedback / Blocker / Red Team Review activity. It is a permanent module (not behind any UI flag) reachable from the module switcher.

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED** — Quest Coral's requested project concepts, per the person who specified the module, were: project name, people involved, project description, mission connection, next step, timeline, and a project dashboard — with the "mission connection" field meant to answer *"how does this project support the SVC mission?"* concretely, explicitly **not** meant to be a vague score like "High." That framing explains why the field exists at all, even though — see the shipped field below — it landed as a 1-5 number rather than the originally-intended free-text explanation. The **next step** field was called out as particularly important, specifically so a project can't become a passive description with no obvious action; the Secretary should surface it when relevant.

## Project fields (exact)

**Status: CODE / PRODUCT VERIFIED**

A Project has: `name`, `description`, `status`, `progress` (0-100), `missionFitScore` (an integer **1 through 5**, displayed as Low/Medium/High via a label mapping — there is no free-text "why this supports the mission" field, unlike what was originally requested — see above), `ownerId`/`ownerName`, `people[]` (each a real Directory/Communications contact id, never a free-text name), `nextStep` + optional `nextStepDue`, and a `timeline` object.

`ProjectStatus` is exactly one of: `planning | on_track | at_risk | completed` (labels "Planning" / "On track" / "At risk" / "Completed"). One normalization rule worth knowing: whenever `progress` reaches 100, the project is *displayed* as "Completed" regardless of what the stored `status` field says — read-side, not a database migration.

`timeline` is `{ past: { range, items[] }, present: { range, items[] }, future: { range, items[] } }` — exactly matching the intended Past→Present→Future concept, editable per-phase via a dedicated Timeline sheet.

## Dashboard ("Projects" home)

Stat tiles: Active, At risk, Completed, Blockers (open, excluding completed projects). Filters are status + free-text name search only — there is no owner or priority filter. A project card shows a progress ring, status badge, up to 4 people avatars, a mission-fit dot row, and the next step with its due date.

## Activity / updates

Adding activity is a two-step flow: pick one of four types in a 2×2 grid (**Update / Feedback / Blocker / Red Team Review**), then fill a type-specific form. Each type has its own extra fields (e.g. Blocker: impact level, what's needed, owner, target date; Red Team Review: what to challenge, recommended action, severity), which get serialized as labeled lines inside the same free-text `body` — there's no separate schema per type. One optional attachment (image or document, ≤15 MB) is allowed per activity entry. Activity is append-only once posted — only its own author can delete it.

**Red Team Review is not a separate feature or entity — it is literally the 4th value of the same `UpdateType` union**, distinguished only by a badge in the same activity feed. Don't describe it as a distinct workflow.

## Project Context

A per-project, human-authored (or uploaded) Markdown brief, capped at 12,000 characters, with 10 suggested headings (Purpose, Problem it solves, Key question, Users, How it works, Flows, Features, Decisions, Current state, Pending). It's a real, currently-live feature — write it directly or upload a `.md`/`.txt` file — and it's included as grounding context in both Ask AI and the AI Project Brief. This is distinct from the project's activity history and distinct from the auto-generated AI Brief described next.

## AI Project Brief and Ask AI

Two separate AI surfaces, both Quest-Coral-specific (not shared with Directory's Ask AI):

- **AI Project Brief** — an always-visible, auto-generated 2-4 sentence summary shown on the project detail screen, cached per-project by a content fingerprint so reopening an unchanged project costs nothing.
- **Ask AI** — a typed question, answered only from the project's (or, on the portfolio Home screen, all projects') already-loaded data — description, status, progress, mission fit, next step, timeline, activity, and Project Context. There is no server-side tool-calling here (unlike Directory's Ask AI); the client sends what it already has, and the model is instructed never to invent people, dates, numbers, or projects beyond that payload.

## Feedback → Communications bridge

This is the one place a Quest Coral activity entry automatically becomes a Communications message — and only for the **Feedback** type specifically. Clients are actually blocked by Firestore rules from writing a raw `feedback`-type activity document directly; only a secure server command can, and that same server command atomically also creates (or reuses) a Communications message and — the first time — a linked Communications "Project" context for that Quest Coral project. Recipients are the project owner plus any project people who are registered SVC users. Replying to that mirrored message from inside Communications routes through another server API rather than a normal client write, and threads back into Quest Coral's own feedback-reply record. Update, Blocker, and Red Team Review activity are **not** mirrored anywhere — only Feedback is.

## Relationship to Directory and 3-Week Outlooks

A project references real people (Directory/Communications contact ids) but does **not** store a Directory job or company id — a project is not yet linked to a specific Directory job/company entity. There is zero code-level connection to 3-Week Outlooks in either direction; the two remain genuinely distinct surfaces, matching the conceptual distinction stated elsewhere in this pack (Quest Coral = broader project state/next-step tracking; Outlook = near-term task scheduling for a specific job).

## WhatsApp Secretary integration

The Secretary already has four dedicated, read-only Quest Coral tools: search projects, get one project's full detail (including its written Project Context), get a project's updates with real date-range/cursor pagination (not just "the latest few"), and a cross-project "recent activity" feed for portfolio-style questions.

## Step-by-step: creating and maintaining a project

1. Open Quest Coral from the module switcher → lands on **Projects** (dashboard).
2. Tap **New project** → a 5-step sheet: **Basics** (name, description, mission fit 1-5) → **People** (you're auto-added as owner; search and add real contacts) → **Next step** (text + optional due date) → **Timeline** (one optional free-text note, becomes the Present-phase item) → **Start tracking** (pick a starting status). The new project opens directly into its detail screen.
3. **Add activity** via the "Add" quick action: choose Update / Feedback / Blocker / Red Team Review, fill the type-specific form, optionally attach a file, save. Posting Feedback also messages the project owner and registered people involved in Communications.
4. **Add a Project Context** from the "Project context" card: write Markdown (optionally starting from the 10-heading template) or upload a `.md`/`.txt` file.
5. **Ask a question** from the AI Brief card's footer (or the portfolio-wide Ask AI card on Home for cross-project questions).
6. **Maintain**: edit people involved, edit timeline milestones per phase, mark the next step complete (this posts an automatic Update entry and clears the field), share a text summary, or delete the project (owner only — deleting never deletes its activity history).

---

# 8. 3-Week Outlooks

**Status: CODE / PRODUCT VERIFIED for the deterministic core; the "publish → Communications" step is currently PRODUCT DIRECTION with an important WIP caveat — read the callout below before describing it**

## Purpose and location

A 3-Week Outlook is a short-term (21-day) task-planning tool attached to a single Directory job. It lives inside Directory: open a job profile → the **Outlook** tab (that literal label). It is not a separate module and has no dashboard of its own outside a given job's profile.

## Task data model (exact)

Each task has: `id`, `sortOrder`, `title`, `description`, `trade`, `companyName` (+ an optional resolved `companyContextId`), `startDate`, `durationDays`, a `status` of `not_started | in_progress | blocked | complete`, and `completionPercent` (0-100). `endDate` is always computed from start date + duration by the scheduler — it's never trusted as raw input, even from AI. There is **no individual "responsible person" field** — only a company/trade, not a named assignee — and no separate free-text notes field beyond `description`. Up to 60 tasks per outlook window.

There is no separate draft/published status on the outlook document itself; a job's outlook is a live mutable **draft** document, and any confirmed, valid task list can be turned into an immutable **version** (a frozen snapshot with its own generated PDF).

Scheduling and validation happen deterministically: dependency-only tasks start the day after their dependency ends; blocking issues (missing title/date/duration, a dependency cycle, a dependency pointing to a nonexistent task, or an explicit date conflicting with a dependency) prevent publishing; a task falling outside the 3-week window is only a non-blocking warning.

## Voice/AI capture

A supervisor can type or record a natural-language update. Voice is transcribed (`gpt-4o-mini-transcribe`), then the note plus known context (window dates, job name, known companies, existing tasks) is sent to a structuring model (`gpt-5-mini`) that returns **suggestions only** — never final tasks. Suggestions carry per-field confidence and provenance, and a mandatory review modal (footer copy: *"Every task is reviewed before it's saved"*) requires an explicit "Looks good" confirmation before anything is saved. This AI-proposes/human-confirms principle is real and enforced for **task content** — every task, whether typed or spoken, goes through the same editable review step before being written.

## PDF

A real, shipped feature: a landscape PDF combining a gantt-style view and a task registry, generated via `pdf-lib` and attached to a published version.

## No Google Calendar integration

Despite being discussed conceptually in the past, there is currently **zero code** implementing a Google Calendar or `.ics` export — this remains aspirational only.

## Relationship to Quest Coral

Confirmed, with zero code coupling in either direction: they remain genuinely distinct surfaces. Quest Coral tracks broader project state and "what's next" narratively; an Outlook schedules specific dated tasks for the next three weeks of a specific job. Do not describe one as containing or superseding the other.

## ⚠️ Important callout: uncommitted work-in-progress on the "publish → Communications" step

As of this audit (2026-08-13, on the currently checked-out branch `codex/outlook-auto-comms-share`), there are **uncommitted, untested changes in the working tree** that materially change what happens after a task list is confirmed as valid:

- **Last committed/stable behavior** (what should be treated as the shipped product today): publishing an Outlook update generates a PDF and opens Compose with a pre-filled draft message — a human must explicitly review and send it. This matches the "AI proposes, human confirms" principle end-to-end, including the publish step.
- **Uncommitted working-tree behavior** (not merged, not committed, not test-covered): every successful save of a valid task list — even a single-task edit — automatically publishes a new version, generates a new PDF, and posts a broadcast Communications message to **literally every user in the app** (not just job participants or people with any relationship to the job), with no confirmation step of any kind. The manual "Post update" action was removed entirely in this same uncommitted change.

This is genuinely in-progress code (it type-checks cleanly but has no automated test coverage and no design note describing intended final behavior), quite possibly not finished, and its current recipient scope in particular looks like it may not reflect final intent. **The knowledge pack should describe the committed manual-review behavior as current product behavior, and should not describe the auto-broadcast-to-everyone behavior as shipped.** If asked "does publishing an Outlook automatically message everyone," today's honest, code-grounded answer is: not in the last committed version; there is active, unreviewed work in progress that would change this, and it should not be relied on until it's been explicitly finished and merged.

## Step-by-step: creating an Outlook (manual path)

1. Directory → open a job's profile → **Outlook** tab. The embedded panel toggles between **Preview** (a compact summary) and **Quick Update** (a short manual add-task form: name, start date, duration, optional trade/company).
2. Tap "See full outlook" for the dedicated full-screen view, which has **Preview** (a 21-day gantt with Week 1/2/3 headers plus the task list) and **Advanced** (expandable per-task edit cards with every field) tabs.
3. Add/edit tasks in Advanced, or via the "Quick update" sheet from Preview.
4. Save. If the resulting task list has no blocking issues, a version and PDF are produced (committed behavior: a draft is opened in Compose for the user to review and send; see the WIP callout above for the uncommitted alternative currently on this branch).
5. Use "View PDF" or "Share" to access the latest published PDF.

## Step-by-step: creating an Outlook (voice/AI path)

1. From the Outlook tab, tap the AI capture entry ("Capture with AI"). Type or record a natural-language update describing the work; optional context chips (start date, trade, company, duration, dependency) only fill fields the note itself leaves blank.
2. Recording is transcribed and appears as editable text.
3. Tap "Generate Outlook" — the model returns suggested tasks with per-field confidence.
4. Review each suggested task in the review modal (a mini-gantt plus editable cards); edit or discard anything as needed.
5. Tap "Looks good" to confirm — this feeds into the exact same save path as the manual flow above, including the same publish behavior described in the WIP callout.

---

# 9. Applications and candidate onboarding

**Status: CODE / PRODUCT VERIFIED for the code itself; PRODUCT DIRECTION for how widely it's turned on — see the mock-vs-real callout**

## ⚠️ Mock vs. real: read this first

Whether Applications talks to real Firebase or a local browser-only mock is controlled by one build-time flag (`NEXT_PUBLIC_APPLICATIONS_BACKEND`), off by default. As of the most recent internal documentation, it was turned on only for a development preview environment — **not** for production. The code itself is real, not a prototype (real Firestore transactions, real Storage uploads, a real server-rendered signed PDF for the agreement), but whether any given deployment of SVC is actually running on live data or on a single browser's `localStorage` depends entirely on that flag's current value, which this repository audit cannot confirm for Vercel's production environment. Treat "is Applications live right now" as something to verify per-environment, not assume.

## Exact candidate status values

`draft → submitted → needs_information → ready_for_review → approved → payroll_in_progress → hired`, with a separate `archived` terminal state reachable at most points. (`agreement_pending` also exists as a status value but is legacy — current code leaves status at `approved` while a signing link is outstanding, rather than moving it to `agreement_pending`.)

`ready_for_review` is real and distinct from `submitted`: a reviewer must explicitly click "Start review" to move a submitted application there; it isn't automatic.

## Candidate access

Candidates use a secure link (`/?apply=<token>`) — only the token's hash is ever stored, never the raw token. Opening the link mints a scoped Firebase custom token; no normal SVC account/login is required. Links are purpose-specific and expire on their own schedule: 14 days for the initial application link, 7 days for a "please provide more info" step link, 3 days for the agreement-signing link.

The candidate flow is genuinely mobile-first with real autosave (roughly 700ms after each edit, with a save-state indicator) and real resume-later behavior (reopening the same link picks up at the first incomplete section).

## Candidate steps

Welcome → General application (name, phone, email, city/state, experience, trade, optional résumé/reference) → Intro video → Documents → Review & submit → Submitted confirmation. The Operating Agreement (consent, typed name matched against the application, drawn signature) is a separate step reached only via its own agreement-purpose link, after approval — not part of the initial 4-step flow.

## Intro video and AI

A candidate records or uploads a short intro video. **AI transcription and a structured summary are implemented in code** — a Cloud Function triggered on the application document, using `gpt-4o-mini-transcribe` for transcription and `gpt-5-mini` for a strict-schema summary (name, town, years of experience, one-paragraph summary, missing fields, a "needs review" flag). This is a real correction to any assumption that video AI is "not yet built" — it is built. Whether it is actually **deployed and running** in the live Firebase Functions environment could not be confirmed from the repository alone (no deployment record was found comparable to other features' explicit "-deployed" documentation) — treat as code-complete, deployment status unconfirmed.

## Documents

Only two standard documents currently exist in the actual flow: **Driver's license** and **OSHA 10 card**, both required. The data model and UI copy support conditional, job-specific required documents, but no code path currently produces one — this is scaffolding for a future feature, not something live today.

## Reviewer dashboard and actions

A reviewer can: search/filter/sort the candidate list; open a full profile (identity, job, contact quick-actions, checklist, video with playable transcript/summary, documents, activity timeline); **request info** (opens a pre-filled composer targeting the specific missing items, sends via a 7-day step link, moves status to `needs_information`); **start review**; **approve** (unlocks the agreement and immediately issues/share-sheets a 3-day signing link); **retry transcription** on a failed video; **mark hired** (only enabled once status is `payroll_in_progress` — approving does not itself mean hired); **archive/unarchive**; **delete** (a genuinely irreversible hard delete of the application, its documents, video, agreement record, and activity log — no undo); download a full application-profile PDF; and preview/download the signed agreement PDF.

## Approval → Operating Agreement → payroll

Approving atomically unlocks the agreement and issues the signing link. Signing (consent + fuzzy-matched typed name + drawn signature) is a real, transaction-safe server flow: it renders and stores a genuine signed PDF (`pdf-lib`, with a content hash and versioned filename) and, in the same transaction, advances status straight to `payroll_in_progress`. From there, **mark hired** is a manual reviewer action with no further automated logic behind it — there is no payroll-provider integration and no automatic Directory contact creation on hire. The agreement's legal text itself is explicitly commented in code as a **placeholder, not lawyer-reviewed** — do not present it as SVC's actual legal terms.

## A real security caveat worth knowing

Firestore/Storage rules for `/applications` and its uploaded files are currently broadly open to **any authenticated Firebase session**, not scoped to "only the candidate's own application" the way some documentation describes. Isolation is enforced only at the Next.js API-route layer (which checks the custom-token claims), not by the security rules themselves. This is an explicit, intentional "operational mode" choice documented in the rules' own comments while the workflow stabilizes — but the Secretary (and anyone reading this pack) should not describe candidate data as cryptographically isolated by Firestore rules; it currently isn't.

## WhatsApp Secretary integration

Three read-only tools exist today: search candidates by name, get the review queue (specifically the `submitted`, `ready_for_review`, and `needs_information` states), and get an application history for a given job. This directly means the Secretary **can** already answer basic Applications status questions — it is not limited to zero AI surface here.

## Step-by-step: candidate experience

1. Receive a link like `.../?apply=<token>` (sent manually by a reviewer — there is no automated invitation send).
2. Welcome screen → General application (autosaves as you go) → Intro video (record or upload; can be skipped and finished later) → Documents (driver's license + OSHA 10 card) → Review & submit.
3. Reopening the same link later resumes exactly where you left off.
4. After approval, a separate agreement link arrives: scroll-to-read the agreement, check consent, type your full name, draw a signature, submit — this seals a signed PDF and moves you to payroll processing automatically.

## Step-by-step: reviewer experience

1. Invite a candidate (name required; trade and a free-text job name optional — job assignment is not yet a Directory picker) → share the generated link.
2. Track progress on the list; open a candidate to see the full profile.
3. If something's missing, **Request info** — a pre-filled composer targeting exactly the missing items.
4. **Approve** when ready — this immediately issues the signing link.
5. Once signed, **Mark hired** when payroll/onboarding is complete outside the app (there's no integration to wait on).
6. **Archive** or **Delete** are available at any point except from a hired state; delete is permanent.

---

# 10. ByeByeDPR — Daily Reports

**Status: CODE / PRODUCT VERIFIED — re-audited end-to-end against current code**

## Purpose

ByeByeDPR is SVC's field module: quick job clock-in/out plus a Daily Report flow (typed or voice, optionally AI-structured) designed to be usable in under a minute by a field crew member. It uses a flat, single-organization model — there is no company/tenant scoping — any authenticated user can read/create any job.

## Data model (exact)

- **Job**: id, name, address, latitude/longitude, `directoryContextId` (a 1:1 link to a real Directory `/contexts` job entry — every ByeByeDPR job is Directory-linked, created if needed), `isActive`, `notifyUserIds`, createdBy/At, updatedAt.
- **ClockRecord**: userId, jobId, `status: "active" | "closed"`, clockInAt/clockOutAt, `durationMinutes` (computed on close), `clockInLocation`/`clockOutLocation`, `selectionSource: "manual" | "nearest" | "recent"`, `manuallyCorrected`, `correctionMetadata`, `idempotencyKey`.
- **Report**: jobId, authorId, `type: "daily_report"` (a single literal, not a union — there is no other report type today), `status: "draft" | "submitted"`, `rawText`, `transcription`, `transcriptionSource: "voice" | "typed"`, `structuredData`, `structuredDataSource: "manual" | "ai"`, `audioStoragePath`, `pdfStoragePath`, `commsMessageId`, `idempotencyKey`.

**`structuredData` currently has exactly three fields: `workCompleted`, `issuesOrDelays`, `nextSteps`.** There is no attendance field, no additional-notes field, and no other structured field today — a couple of stray code comments referencing "5 fields" are stale and should be ignored.

## Job selection

A worker can pick from up to 5 recently-used jobs, search all jobs (backed by Directory's own indexed job search), or let the app suggest the nearest job by geolocation (a deterministic distance calculation against both ByeByeDPR's own geocoded jobs and Directory's broader job catalog).

## Daily Report flow

Tapping "Daily Report" immediately creates a `status: "draft"` report document, then presents a capture screen:

- **Voice**: tap once to start recording, tap again to stop (not hold-to-record). The transcript comes back from `gpt-4o-mini-transcribe`; raw audio is uploaded to Storage best-effort.
- **Typed**: a plain text box, up to 4,000 characters.

Either path lands on a **Review & Submit** screen with the raw text editable. **"Organize report" is an optional, manually-triggered action** — AI structuring into the three fields (`gpt-5-mini`, a strict extractor that only returns verbatim excerpts of the actual input, never a paraphrase or summary) does not run automatically after transcription; the worker must tap it. Whether organized or left as raw text, everything remains editable before submit, and photos can be attached (images/PDF/Office docs, 15 MB per file, no enforced photo count limit found).

Submitting: generates a PDF (only non-empty fields shown, plus the original raw text as an "Original note" section), automatically posts a short factual message to Communications (*"{name} submitted a Daily Report for {job}."*, addressed to the job's `notifyUserIds` or every registered user if none are set), and — if the job is Directory-linked — best-effort files a copy of the report as both a Directory File (the PDF) and a Directory Note (a plain-text summary) on that job's profile. A submitted report becomes immutable to the client (rules-enforced): it cannot be edited or un-submitted from the app.

There is currently **no attendance-report or cross-worker attendance dashboard** — one existed and was fully removed on 2026-08-07. Don't describe ByeByeDPR as having an attendance-summary screen.

## WhatsApp Secretary integration

Per-job/global/per-author report search with real date-range/cursor pagination, plus a portfolio-wide "which active jobs don't have a recent report" tool. Raw report text, audio, and Communications message content stay out of what's sent to the model.

## Step-by-step: submitting a Daily Report (voice)

1. From Home (a job must be selected), tap **Daily Report** — this creates the draft report immediately.
2. Tap the mic once to start, again to stop.
3. Wait for transcription; you land on **Review & Submit** with the transcript as editable raw text.
4. Optionally tap **Organize report** to fill in Work completed / Issues or delays / Next steps — each remains individually editable.
5. Optionally attach photos.
6. Tap **Submit Report** — this generates the PDF, posts to Communications, and (if linked) files into Directory.

## Step-by-step: submitting a Daily Report (typed)

Same entry point, then tap **Type instead**, write up to 4,000 characters, tap **Continue** — lands directly on Review & Submit, then proceeds identically from step 4 above.

---

# 11. Clocking

**Status: CODE / PRODUCT VERIFIED — built fresh from code in this audit; the prior version of this pack had almost nothing reliable here**

## Clocking in

1. From ByeByeDPR Home, tap **Clock In**. This navigates to a job-selection screen that *is* the clock-in flow — nothing is written yet.
2. The app immediately requests browser geolocation (treated as implied by the explicit tap on "Clock In" — there's no separate permission-explanation step first).
   - If granted: the server suggests the nearest job (checked against both ByeByeDPR's own jobs and Directory's broader catalog), shown as a "Suggested"/"Nearest" badge, alongside Recent and searchable All-jobs lists.
   - If denied or unavailable: the worker simply picks manually from Recent/All/Search — nothing is blocked by a missing location.
3. Tap a job row to select it, then tap the sticky **"Use This Job"** button — this is the actual clock-in write.
4. The server rejects a second simultaneous active clock-in for the same worker (one active clock record per person at a time) and is idempotent against accidental double-taps.
5. On success, Home shows "Clocked in — Since {time}" and the button becomes **Clock Out**. A short factual message auto-posts to Communications.

**Worth knowing**: although geolocation is captured and used to *rank* nearby jobs, the actual clock-in/clock-out write from the real app UI currently always sends `location: null` — the `ClockRecord.clockInLocation`/`clockOutLocation` fields exist and are fully supported by the schema and API, but nothing in the shipped UI populates them today. If asked whether SVC records exactly where someone clocked in, the accurate answer is: the system is built to support it, but the current app does not actually save a location on a clock record.

## Clocking out

1. From Home (while clocked in), tap **Clock Out** → confirm in a short sheet ("Clock out from {job}?").
2. This computes and stores the session's `durationMinutes` and closes the record; a factual message auto-posts to Communications.

## Forgot to clock out (self-service correction)

If a worker forgot to clock out, a **"Forgot to clock out?"** link (visible only while still shown as clocked in) opens a time picker defaulted to the original clock-in time; the worker enters the actual finish time. This requires **no supervisor approval** — it's fully self-service, but every correction stamps audit metadata (previous value, corrected value, who corrected it, when) onto the record, and a corrected time must be after the clock-in time and not more than a minute in the future.

## What Clocking does not currently do

- No aggregation: there is no daily/weekly total-hours calculation anywhere — each `ClockRecord` stores only that one session's duration.
- No attendance dashboard: nothing in the app shows "who's clocked in right now" across all jobs (that removed feature is gone as of 2026-08-07).
- No raw location is ever exposed to the WhatsApp Secretary — its clocking tools only ever report *whether* a location was recorded (a boolean), never coordinates, and there is no WhatsApp capability to clock anyone in or out (its tools are strictly read-only). The closest cross-job visibility the Secretary has is a "most active jobs right now" ranking by currently-clocked-in count, not a literal roster of every clocked-in person.

---

# 12. Supply by DPR

**Status: CODE / PRODUCT VERIFIED — does not currently exist**

A thorough repo-wide search (routes, types, components, Firestore collections, and both ByeByeDPR product-context docs) found no trace of a "Supply by DPR" feature anywhere in the codebase — the only appearances of the word "supply" in the entire repository are inside the previous draft of this knowledge pack itself. This is not a thin or partially-built feature; it is entirely unimplemented. If asked about it, the Secretary should say plainly that Supply by DPR does not currently exist as a feature in the SVC app suite, rather than describing a plausible-sounding workflow.

---

# 13. AI Secretary (WhatsApp)

**Status: CODE / PRODUCT VERIFIED**

## What it is

The SVC AI Secretary is a conversational access layer reachable by texting one WhatsApp number (currently the official Meta WhatsApp Cloud API **test/sandbox number** — no production number has been purchased or migrated). It runs inside this same Next.js app (`app/api/whatsapp/webhook`) — there is no separate bot service.

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED** — The core stated concept: an employee should be able to text one WhatsApp number and ask SVC-related questions without first knowing which application contains the answer.

## Read-first product strategy

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED, and matched by what's actually shipped**

The stated priority order is:

```text
READ → UNDERSTAND → FIND → EXPLAIN → ROUTE
```

before expanding broadly into `DO / WRITE`. The goal is for the Secretary to become excellent at finding and explaining SVC information before it becomes an automation surface for every application. This matches the current implementation closely: the only write capability anywhere is the bounded Daily Report draft flow (§10), while read access spans seven modules, one of them (Messages) itself split across two different access rules (see "Model and orchestration" below).

## Access model (binary, enforced server-side)

Resolved once per sender, from `lib/whatsapp-access-policy.ts`:

- **Unknown/ambiguous number** → `public` scope: only curated public company-knowledge entries. No Directory, Quest Coral, Applications, Reports, Clocking, or Outlook access at all.
- **Uniquely identified SVC person** (resolved by exact phone match against `/contacts`/`/users`, never fuzzy/suffix matching) → `internal` scope: read access across Directory, Quest Coral, Applications, ByeByeDPR reports, Clocking, Outlooks, and Messages/Communications (with its own further split — see below).
- **Daily Report draft creation specifically requires more than identification** — the sender must also have a *linked Firebase user id* (`canCreateDailyReportDraft`), since a report needs a real author. An identified contact without a linked account can read, but cannot create a draft.
- **Messages/Communications is its own nested access decision**, not a flat boolean. `messages_searchOperationalHistory` (automatic, system-generated Communications posts — never human-typed text) is open to any internal sender, same as every other module. `messages_searchMyCommunications` (human-written Communications messages) is further scoped to `visibleToUserIds` — it only ever returns messages the requesting sender is already allowed to see in the app itself, resolved server-side from the access policy, never a model-supplied argument. A sender identified only by contact match (no linked Firebase user id) still gets `canReadMessages`, so the operational-history tool works for them, but the human-message tool returns an explained empty result — there is no uid to scope by.

This is enforced in the backend/tool-registration layer, not merely as a prompt instruction. Through 2026-08-13 the tool registry structurally refused to ever register any Messages/Communications-named tool at all. As of **2026-08-14** that exclusion was deliberately narrowed, not removed: the registry's guard (`assertOnlyAllowedMessagesTools`) still rejects any *unreviewed* tool name matching the Messages/Communications pattern — only the two tools above are allowlisted through it, and the human-message one enforces its own visibility scope in the query itself, not just in the prompt.

## Model and orchestration

The Secretary is a genuine cross-module tool-calling orchestrator (`runToolConversation`, up to 3 tool-rounds per turn) — the model itself decides which tools to call, across however many modules a question touches, before answering. Its own model default is `gpt-5.6-terra` (separate from Directory's and Quest Coral's own Ask AI, both default to `gpt-5-mini`), overridable via the `WHATSAPP_AI_MODEL` env var.

Per-module read tools currently registered (all read-only, all bounded/paginated, never a raw collection dump):

- **Directory**: the full tool stack — search people/companies/jobs, entity details, relationships, shared-contact/shared-job lookups, connecting-path search, and note search (with a keyword-fallback layer for partial/misspelled names). Includes a same-day fix that attaches phone/email onto person results specifically for WhatsApp, since every WhatsApp sender who can reach Directory tools at all is already a uniquely identified internal user by construction.
- **Quest Coral**: search projects, get one project (incl. its Project Context), get updates with real date-range/cursor pagination, cross-project recent-activity feed.
- **Applications**: search candidates, review queue, per-job application history.
- **Reports**: per-job/global/per-author search with pagination, plus a cross-job "jobs without a recent report" tool.
- **Clocking**: per-job history (never raw GPS, only whether a location was recorded), cross-job "most active jobs" ranking.
- **Outlooks**: per-job task reads, cross-job "active outlooks today."
- **Messages/Communications** (added 2026-08-14): `messages_searchOperationalHistory` reads automatic, system-generated Communications posts — 3-Week Outlook publishes, ByeByeDPR clock-in/out events, Daily Report submissions — filterable by job, date range, and category, open to any internal sender since this content is templated/factual, never human-typed. `messages_searchMyCommunications` reads human-written Communications messages, hard-scoped server-side to the requesting sender's own `visibleToUserIds` — the same ACL the Communications app itself enforces — so it can never surface another person's private message. Neither tool covers the other's content: an automatic broadcast never shows up in "my communications," and a human message never shows up in the operational feed, even though today's known Outlook-broadcast-to-everyone behavior (§8) would otherwise make a message's `visibleToUserIds` include far more people than intended.

The only write capability is the ByeByeDPR **Daily Report draft** flow (§10's WhatsApp-specific rules): the user must give an exact job name plus report details, the assistant previews the structured draft, and only an explicit `CONFIRM DRAFT` (or `CONFIRM DAILY REPORT`) creates it — a bare "yes" is deliberately rejected, and repeat confirmations never create duplicates. The created report always stays `status: "draft"`; WhatsApp never submits/finalizes a report itself.

## Company Knowledge

**Status: CODE / PRODUCT VERIFIED**

This canonical knowledge pack — the document you are reading — is one of two files that together are the Secretary's Company Knowledge source, not a separate small hand-curated list anymore. `lib/knowledge-pack.ts` parses this file **and** `SVC_Company_Mission_Operating_Framework_Knowledge.md` (§1's companion-document note) into one shared pool of roughly 90 chunks from this pack plus another ~40 from the companion document (one per top-level `# N.` section for broad "what is X" questions, one per `##` subsection for narrower detail — the companion document's chunk ids are prefixed `mission-` so the two files' independent `# 0.`, `# 1.`, … numbering never collides) and scores them together with lexical keyword matching — deliberately not an embedding/vector search, since the corpus is small and a WhatsApp reply needs to stay fast. Each chunk records which file it came from (`KnowledgeChunk.source`), surfaced in every retrieval result for citation, but retrieval itself treats both files as one pool: a query about Cool Breeze or the Adventure Map is scored exactly the same way as a query about clocking.

Two retrieval paths, both reading the same corpus:

- **Always-on prefetch**: before the model even starts, `lib/company-knowledge.ts`'s `findRelevantCompanyKnowledge()` scores the conversation and folds a small number of the best-matching chunks directly into the system prompt as a guaranteed baseline — never the whole document.
- **On-demand tools**: `knowledge_search` and `knowledge_getSection` (`lib/whatsapp-secretary/tools/knowledge.ts`) let the model search for a different section or fetch one section's complete text when the prefetch wasn't enough — the same search-then-get-details shape Directory's own tools use.

Public/unidentified senders never get the tools, and always receive exactly one small, fixed, hand-written safe entry regardless of what they ask (never either document in full). Identified internal senders get both the prefetch and the on-demand tools, gated through the same `companyKnowledgeScope` field the rest of the access policy already uses (§13's Access model) — no separate permission system. Whatever a knowledge chunk says about its own status — this pack's CODE / PRODUCT VERIFIED / PROJECT CONTEXT / HUMAN-CONFIRMED / PRODUCT DIRECTION / NEEDS VERIFICATION, the companion document's own COMPANY-SOURCE CONFIRMED / HISTORICAL / TIME-SENSITIVE / NEEDS CLARIFICATION, or an explicit in-progress/WIP callout like §8's — is meant to be relayed faithfully, not flattened into uniformly confident prose — the system prompt instructs this explicitly.

The old design — a handful of entries in a separate Firestore `companyKnowledge` collection — was retired when this integration shipped; that collection is no longer read by the app.

## Memory

Up to 12 recent messages (6 exchanges) are kept per hashed sender phone number, enabling natural follow-ups ("what about his email?") without re-stating context every time.

## Company Knowledge vs Live Data vs Memory

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED, matching the shipped architecture above**

The Secretary conceptually draws on three different context layers, and should not confuse them:

```text
COMPANY KNOWLEDGE
Stable explanations, tutorials, processes, app purpose (this document)

LIVE SVC DATA
People, jobs, projects, applications, reports, outlooks, clocking

CONVERSATION MEMORY
What the current conversation is talking about
```

Worked example — *"How do I create a 3-Week Outlook for Turner?"*:

```text
Company Knowledge → knows how an Outlook generally works (§8)
Live Data         → identifies the Turner job / whether it already has an Outlook
Memory            → remembers which "Turner" the user has been discussing, if ambiguous
```

## Secretary as orchestrator

**Status: PROJECT CONTEXT / HUMAN-CONFIRMED, matching the shipped architecture**

The Secretary is not meant to duplicate every module's own AI logic — it coordinates. Some capabilities are plain deterministic retrieval tools (Directory search, Quest Coral/Applications/Reports/Clocking/Outlook retrieval, and now knowledge-pack retrieval); a few reuse specialized AI services that already exist inside their own module (Daily Report structuring, 3-Week Outlook parsing, audio transcription) rather than reimplementing them. The design principle is to avoid unnecessary AI-to-AI chains when a deterministic query can answer the question directly.

## Response behavior

Concise by default (English, ≤700 characters, at most three short bullets), resolves relative dates ("last week," "since Monday") into concrete ranges itself using a server-supplied current date rather than guessing, cites the date of the underlying data when it's meaningfully relevant, and explicitly states disagreement rather than silently picking a side when two sources conflict. Multi-match results are presented as a native WhatsApp list (up to 10 rows); a single clear target can come with a native CTA button deep-linking into the app (Directory profile, Outlook, Quest Coral project, or an Applications record) — these targets and URLs are always built server-side; the model never invents one.

---

# 14. How the Secretary should answer

**Status: PRODUCT DIRECTION**

## Concise by default

Answer the important question first; offer more detail only if asked.

## Use names naturally, don't overdo it

A first-contact greeting can use the person's resolved first name; don't repeat it in every subsequent reply.

## Do not hallucinate

If reliable information can't be found: *"I couldn't find that in the SVC data I can access"* beats a guess.

## Relative dates

Resolve "today/yesterday/this week/last week/since Monday/this month" against the actual current date supplied by the system, not by pattern-guessing.

## Provenance

When it's useful, say where a fact came from and how current it is (*"Based on the latest Quest Coral update from Aug 12..."*) — especially valuable when multiple modules could plausibly answer the same question.

## Conflicting information

State the disagreement plainly rather than silently trusting one source: *"Quest Coral still shows the project as 'On Track,' but the latest Daily Report from Aug 12 reports a two-day delay."*

---

# 15. Tutorials and guidance philosophy

Give a short, correct answer first; offer to go deeper only if asked.

**Example — "How do I create a 3-Week Outlook?"**

1. Open the job in Directory.
2. Open the Outlook tab.
3. Add the planned work for the next three weeks (manually, or via voice/AI capture — either way, review before it's saved).
4. Confirm to publish.

Then offer a deep link if one is available, and offer more detail only on request.

Deep links must always come from deterministic server-side route builders — never an invented URL.

---

# 16. Cross-module workflows

## 16.1 New candidate / supervisor onboarding

```text
Internal user invites a candidate (free-text job/trade, no Directory picker yet)
→ secure application link
→ candidate completes application, intro video, documents
→ submit
→ internal review (request info, or approve)
→ approval issues a 3-day agreement signing link
→ candidate signs → status auto-advances to payroll processing
→ reviewer manually marks hired once payroll/onboarding finishes outside the app
```

## 16.2 Field operations workflow

```text
Worker clocks in for a job (geolocation used only to suggest the job, not saved on the record)
→ work happens onsite
→ Daily Report captures what happened (typed or voice, AI-structuring optional and manual)
→ submitting auto-posts to Communications and (if Directory-linked) files into Directory
→ clock out (or self-service "forgot to clock out" correction)
```

Clocking = presence/time only, with no aggregation or attendance dashboard. Daily Report = what happened. 3-Week Outlook = near-term dated plan for the same job (a Directory tab, not part of this flow's write path). Quest Coral = broader project state, tracked independently. Communications = where several of these land automatically as read-only, factual notices.

## 16.3 Project understanding workflow

A "what's going on with {job}" question can genuinely need: Directory (who/company/job), Quest Coral (status/next-step/history, if it has a linked project), ByeByeDPR Reports (field reality), 3-Week Outlook (planned work), and Clocking (who's currently on site). The Secretary is built to combine several of these in one turn rather than guessing which single module has the whole answer.

## 16.4 Company understanding workflow

"What do we know about {company}?" pulls from Directory's company record (people, jobs, relationships) — there is currently no code-level link from a Directory company to a Quest Coral project, so that connection, if relevant, has to be made by name/context rather than a direct reference.

---

# 17. New employee discovery / onboarding knowledge

**Status: PRODUCT DIRECTION**

A new employee should be able to ask the Secretary basic orientation questions without knowing SVC's app structure — which app to use, how to find a person or job, what Quest Coral or an Outlook is, how Daily Reports and clocking work, how candidate review works. SVC's own in-app "How it works" guide (Communications' 10-slide Help screen) is a good source of already-approved, plain-language phrasing for exactly this kind of explanation.

---

# 18. Module selection guide

| Need | Module |
|---|---|
| Send/see a message, organize by tag/date/context | Communications |
| Find or understand a person, company, job, or their relationships | Directory |
| Track a project's status, people, next step, timeline, feedback | Quest Coral |
| Candidate application, review, approval, agreement, hiring | Applications |
| Clock in/out, submit a field Daily Report | ByeByeDPR |
| Plan the next three weeks of dated work for a specific job | 3-Week Outlook (inside a Directory job profile) |
| Supply-related tracking | **Does not exist today** |

---

# 19. Common questions the Secretary should answer well

## Company
"What does SVC do?" / "What does SVC stand for?" / "How does SVC work?" — answer directly from §2's PROJECT CONTEXT / HUMAN-CONFIRMED material; these are company-identity questions, not something to hedge on for lack of a code trail. "What is the difference between Sales, Recruiting, and Field Operations?" / "What does 'Cool Breeze' mean?" / "What is Operation Major Kong?" — likewise answerable directly from §2, in more depth from the companion document.

"What is a Site Supervisor?" / "What is Site Supervision?" / "What is 'Provide and Guide'?" / "What's the difference between an Objective, a Goal, and a Task?" / "What does 'Cool Breeze Ready' mean?" / "How does Major Kong fit inside Cool Breeze?" / "Is Cool Breeze/Major Kong still active right now?" (answer what it is confidently; flag current-status as needing live confirmation, don't assert either way) / "Can you teach me the SVC framework?" / "Where can I learn more about how SVC organizes work?" — answer from `SVC_Company_Mission_Operating_Framework_Knowledge.md` (via `knowledge_search`/`knowledge_getSection`, the same tools as everything else here); for a tutorial/teach-me/learn-the-framework request specifically, give a short explanation and then offer the SVC Adventure Map (https://svc-app.vercel.app/) as the dedicated 5-minute interactive walkthrough.

## Directory
"What's John's phone number?" / "Who works for ABC Construction?" / "What jobs is this company on?" / "Who's connected to Turner?"

## Quest Coral
"What's the status of this project?" / "Who's involved?" / "What's the next step?" / "What changed recently?" (the Secretary can page into real history, not just the newest few entries)

## Applications
"What's the status of this candidate?" / "What's missing?" / "Which applications are waiting on review?"

## Daily Reports
"What's the latest report for this job?" / "Which jobs haven't had a recent report?" / "Create a Daily Report draft for this job" (requires exact job name + details, then explicit `CONFIRM DRAFT`)

## 3-Week Outlook
"Is there an active outlook for this job?" / "What's planned next week?" / "Which active jobs don't have a current outlook?"

## Clocking
"Who's currently clocked in on this job?" (via "most active jobs," not a full roster) / "Did John clock in today?" — do not claim total-hours calculations exist; they don't.

---

# 20. Glossary

**SVC** — Supervision Company (PROJECT CONTEXT / HUMAN-CONFIRMED, §2); a U.S. construction-site supervision company. The app code has no reason to spell this out, so its absence from the repository doesn't weaken it.

**Site Supervisor / Super** — the on-site construction role SVC's field-facing modules are built around; the practical connection between construction planning/paperwork and what actually happens on site ("from suits to boots"). Full definition: companion document §3.

**Site Supervision** — SVC's core service: the commercial-construction management and coordination of onsite activity across subcontractors, project managers, architects, engineers, inspectors, suppliers, and owners. Companion document §3.

**Provide and Guide** — SVC's technology principle: tools exist to provide, guide, and support Site Supervisors, not replace them. Companion document §5.

**Vision → Mission → Operation → Objective → Goal → Task → Action** — SVC's effort-organizing hierarchy; an Operation coordinates a related group of Objectives under a Mission, not just another smaller time-scale rung. Planning-horizon heuristics and full definitions: companion document §8–§16.

**Cool Breeze** — SVC's mission name (PROJECT CONTEXT / HUMAN-CONFIRMED, §2). Fuller detail, its stated target, and why its current-active status should be verified rather than assumed: companion document §17–§18.

**Operation Major Kong** — the organizational framework grouping Sales, Recruiting, and Field Operations, sitting inside Mission Cool Breeze (PROJECT CONTEXT / HUMAN-CONFIRMED, §2). Fuller detail and the same current-status caveat: companion document §19–§20.

**SVC Adventure Map** — the interactive tutorial at https://svc-app.vercel.app/ that teaches the SVC Vision/Mission/Operation framework in about five minutes; offer it when someone wants a walkthrough. Companion document §7.

**Job** — a construction worksite/operational entity shared across Directory, ByeByeDPR, and 3-Week Outlooks.

**Person / Company / Context** — Directory's three visible entity kinds (plus an internal-only `other`).

**Recipient** — who can read a Communications message (author + explicit selection only).

**Context** (Communications sense) — an organizational link on a message (project/company/topic); never grants visibility. Distinct from Quest Coral's "Project Context."

**Tag** — backed by `/projects`; a flat classification, not an access mechanism.

**Communications / Stream** — the shared messaging module.

**Directory** — the search/relationship/profile layer over people, companies, and jobs.

**Ask SVC Directory** — Directory's server-orchestrated natural-language assistant (distinct from a profile's non-AI "AI summary" text).

**Quest Coral** — the project-tracking module (status, progress, mission fit, next step, timeline, Feedback/Blocker/Update/Red Team Review activity, Project Context).

**Red Team Review** — one of Quest Coral's four activity types, not a separate feature.

**Project Context** — a per-project Markdown brief in Quest Coral.

**3-Week Outlook** — a 21-day dated task plan for one Directory job.

**Applications** — candidate application → review → agreement → payroll → hired flow.

**ByeByeDPR** — the field module: clocking + Daily Reports.

**Daily Report** — a job-based field record (`workCompleted`, `issuesOrDelays`, `nextSteps`).

**Clocking** — clock-in/out session records; no hours-aggregation or attendance dashboard exists today.

**Supply by DPR** — does not currently exist.

**AI Secretary** — the WhatsApp conversational access layer described in §13.

---

# 21. Important boundaries / do not invent

1. **The company-mission narrative in §2** ("Supervision Company," Sales/Recruiting/Field Ops, "Lift everybody up," "Cool Breeze," "Operation Major Kong," the Vision→Mission→Operation hierarchy) is labeled PROJECT CONTEXT / HUMAN-CONFIRMED, not CODE / PRODUCT VERIFIED — state it as genuine company fact (it is), but do not claim the application code independently corroborates the specific wording beyond the one incidental "Cool Breeze" placeholder noted in §2, and do not present a product-behavior claim (how a screen or field actually works) with this same confidence unless it also carries a CODE / PRODUCT VERIFIED label.
2. **The Outlook auto-broadcast-to-everyone behavior described in §8 is uncommitted, in-progress code** — do not describe it as shipped.
3. **Directory's per-profile "AI summary" is not an LLM call** — don't conflate it with "Ask SVC Directory."
4. **Directory's note search is lexical, not semantic**, despite an embeddings pipeline existing for a related purpose.
5. **Applications' production live/mock status is per-environment and unconfirmed here** — don't assert it's fully live everywhere.
6. **Applications' candidate data is not isolated by Firestore/Storage rules** — only by the API-route layer. Don't describe it as cryptographically scoped to "only the candidate's own data."
7. **ByeByeDPR clock records don't actually store a location today**, even though the schema and API support one.
8. **There is no attendance dashboard or hours-aggregation anywhere in ByeByeDPR** — it was built once and fully removed.
9. **Supply by DPR does not exist.**
10. **The WhatsApp Secretary's Communications access is real but narrow, as of 2026-08-14** — never assume it can see more than its two tools actually grant. `messages_searchMyCommunications` never returns a message outside the requesting sender's own `visibleToUserIds` (§4.1's rules, enforced in the query itself, not just the prompt); it cannot be asked to check someone else's messages. `messages_searchOperationalHistory` only ever returns automatic, system-generated posts, never human-written content. Don't describe either tool as a general Communications search.
11. **Never claim WhatsApp can perform an action that only exists in the SVC app** — its only write capability anywhere is the Daily Report draft flow.
12. **Any specific person/job/project/candidate/report/clock value is live data, not something this pack should ever hold** — always defer to a live tool for that.
13. **Cool Breeze and Operation Major Kong are real, confirmed company knowledge, but their current-active status is not** — "what is Cool Breeze" is answerable directly; "is Cool Breeze still the active Mission today" is not, without live confirmation. Same for any historical target/figure in the companion document's HISTORICAL / TIME-SENSITIVE sections (e.g. the stated Cool Breeze revenue target) — a real past statement, not a current fact by default.
14. **The sales/job progression milestone framework's numeric axes are explicitly not fully defined** (companion document §21, NEEDS CLARIFICATION) — repeat the milestone names/sequence, never invent what the X/Y/Z numbers mathematically represent or fill in a blank milestone.

---

# 22. Remaining verification gaps

These genuinely cannot be resolved by reading this repository and require checking outside it (Vercel dashboard, Firebase Functions console, or asking the person who built this):

- Whether `transcribeApplicationVideoOnWrite` (the Applications video-transcription Cloud Function) is actually deployed and running in production, versus just committed to the codebase.
- Current Vercel production values for `NEXT_PUBLIC_APPLICATIONS_BACKEND`, `NEXT_PUBLIC_DIRECTORY_AI_ENABLED`, `NEXT_PUBLIC_DIRECTORY_VOICE_ENABLED`, `NEXT_PUBLIC_QUEST_CORAL_BACKEND`, `NEXT_PUBLIC_QUEST_CORAL_AI_ENABLED`, `NEXT_PUBLIC_OUTLOOK_AI_ENABLED`, and `GOOGLE_MAPS_GEOCODING_API_KEY` — this pack could only confirm local `.env.local`/`.env.example` values and rule-comment claims about prior production deploys.
- Whether the uncommitted Outlook→Communications auto-broadcast work described in §8 is ever intended to ship as-is, is mid-refactor, or will be redesigned before merging — no design note for it exists in the repo.
- ~~Whether the company-mission language in §2 is genuine SVC organizational knowledge~~ — **resolved 2026-08-14**: confirmed directly by the person who built and runs SVC as genuine company context; restored to §2 under PROJECT CONTEXT / HUMAN-CONFIRMED. No further code-based verification is expected or needed for this category of claim (see §1's authority-order note on company/business context).
- Any actual company/HR policy (payroll specifics beyond "Applications hands off to payroll processing," benefits, legal terms — the Operating Agreement text is explicitly a non-final placeholder) is out of scope for a code audit entirely.
- **Whether Cool Breeze and/or Operation Major Kong are still SVC's currently active Mission/Operation today** — the companion document explicitly flags this as unresolved from its own source material (a specific-period planning deck plus onboarding notes); neither a code audit nor this pack can settle it. Answer what the concepts are with confidence; don't assert current-active status either way without asking the person who runs SVC or another live source.

---

# 23. Recommended knowledge-document architecture

**Status: PARTIALLY DONE, 2026-08-14.** The first real step of this recommendation has been taken: company/organizational knowledge now lives in its own document, `SVC_Company_Mission_Operating_Framework_Knowledge.md`, parsed and retrieved together with this pack by the same `lib/knowledge-pack.ts` pipeline (§1, §13) rather than being folded into this file's own §2. The full modular split below (per-module files, a dedicated glossary file, etc.) has not happened — this pack is still one file for everything except the company/mission layer.

Unchanged recommendation from the prior draft for the rest of it — this single file is a workable seed, but a long-term knowledge base should likely split further into focused, independently-retrievable documents:

```text
knowledge/
  00-svc-overview.md
  01-platform-map.md
  02-glossary.md
  03-cross-module-workflows.md
  04-new-employee-guide.md

  modules/
    communications.md
    directory.md
    quest-coral.md
    applications.md
    bye-bye-dpr.md
    three-week-outlooks.md
    clocking.md
    supply-by-dpr.md   # currently: "does not exist" stub only

  workflows/
    candidate-onboarding.md
    field-operations.md
    project-management.md
```

Each document should carry metadata recording what it was last verified against:

```yaml
---
title: "Quest Coral"
audience: "internal"
type: "module-guide"
last_verified: "2026-08-13"
verified_against:
  - "current code"
  - "current Firestore rules"
  - "docs/svc-quest-coral-product-context.md"
status: "verified"
---
```

---

# 24. Final product principle

The AI Secretary should feel like: *ask this one SVC contact anything about how the company works or what's happening inside SVC, and it will know where to look.*

To keep that reliable:

- stable explanations come from curated, code-verified knowledge like this document;
- changing facts come from live tools, never from this pack;
- conversational references come from short-term memory;
- specialized module AI (Directory's Ask AI, Quest Coral's Ask/Brief, ByeByeDPR's transcription, Outlook's parser) is reused rather than duplicated;
- the Secretary coordinates across modules rather than guessing which single one has the whole answer;
- and — the one rule this audit pass leaned on hardest — **unconfirmed information is stated as unconfirmed, not invented.**
