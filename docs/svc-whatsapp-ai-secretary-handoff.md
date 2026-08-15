# SVC AI Secretary — WhatsApp handoff

_Last updated: 2026-08-14. This is the operational handoff for continuing the
WhatsApp AI Secretary work. Treat the current code, Vercel configuration, and
Firebase data as the authority if they differ from this document._

## List-all tools, tag search, and richer Applications details (2026-08-14, later still)

Driven by another real-usage transcript review. Three additions, all
implementation + tests only, not deployed:

- **`questCoral_listAllProjects`** and **`applications_listAllApplications`**
  — both modules previously required a name/query for everything ("what
  projects/applications are there" had no answer). Both list newest-updated
  first with an optional status filter. Quest Coral's filters in memory over
  the same bounded overfetch its keyword-fallback already uses (no
  `(status, updatedAt)` index exists for that small collection, and doesn't
  need one). Applications' filters server-side — the `(status ASC, updatedAt
  DESC)` index already exists and is already used by `getReviewQueue`.
- **Tag search/filter for Messages** — both `messages_searchOperationalHistory`
  and `messages_searchMyCommunications` gained a `tag` argument, resolved
  against `/projects` (Communications tags' backing collection) via a new
  injectable `resolveTag` seam (mirrors `directoryProvider` for job names).
  Matches messages via `projectId`/`projectIds`/`tagIds`, covering every
  field a tag can be expressed through.
- **Richer Applications details** — `ApplicationSummary` gained `phone`,
  `email`, `cityState`, `yearsExperience`, `workReference`,
  `resumeFileName`, `videoState`, and a compact `documents[]`
  (label/status/required) array. **This reverses a previously deliberate
  exclusion** (candidate contact info was intentionally left out of
  WhatsApp tool output on 2026-08-12 — see the memory file — reasoning:
  candidates are a different privacy class from internal Directory
  contacts). Reversed only on explicit user confirmation after being told
  the tradeoff plainly. The actual resume file, other uploaded documents,
  and intro video content remain unavailable — only status/filename, same
  as before.

**Correction to something I told the user during this task**: I initially
said no PDF generator exists for a candidate's full application (only the
signed Operating Agreement PDF does) — while investigating I found
`features/applications/application-profile-pdf.ts` already exists (a real,
pre-built, pure-data "candidate application export PDF" renderer, predating
this session). The user had already chosen text-only details before I found
it; implemented what was asked, flagged the correction for a future ask
rather than re-opening the already-answered question.

**Repo-sharing note**: mid-task, the other Codex session was actively
editing `lib/applications-server.ts`, `lib/store.ts`, and
`lib/whatsapp-secretary/tools/messages.ts` concurrently (building an
Applications→Communications auto-post feature reusing that same PDF
renderer and the exact PDF-attachment pattern built earlier the same day —
extended `AUTOMATIC_MESSAGE_SOURCE_MODULES` with `"applications"`
correctly, unprompted, matching this file's own design). A `git stash` on
their in-progress file went stale mid-flight as they kept writing; resolved
by diffing the stash against HEAD and their current file, confirming
current-on-disk was strictly newer, then dropping the stale stash rather
than popping it. They committed cleanly as `dd6838e` shortly after. No work
was lost on either side. See [shared-repo-parallel-agent](shared-repo-parallel-agent.md).

## Active users + native file/photo attachments (2026-08-14, later still)

Driven by a real WhatsApp transcript the user shared: `directory_getActiveUsers`
had no answer for "who are the active users" (previously undefined), and every
"give me the link/PDF/photo" question got a hard refusal pointing back to the
SVC app, even though the underlying content (a Daily Report PDF, a Communications
image) was already something the sender was authorized to see.

**Active users** — `lib/whatsapp-secretary/tools/directory.ts` gained
`directory_getActiveUsers`, reusing the *exact* signal the web app itself
already shows: `app/page.tsx` writes `lastSeen: serverTimestamp()` to
`/users/{uid}` every 60s while a tab is open/visible, and its own `activeUsers`
memo defines "active" as `lastSeen` within the last 90 seconds. The tool asks
the identical question server-side (`users` collection, single-field range
query on `lastSeen`, no new index needed) rather than inventing a different
"active" definition — there is no login-history concept anywhere in this app
to fall back to. Gated by the existing `canReadDirectory` flag, no new
access-policy field.

**Native file/photo attachments** — the model is *never* given a storage path
or download URL; that would risk it leaking, inventing, or mistyping one. The
capability is instead entirely deterministic and server-side, mirroring how a
deep-link CTA is already built:

- `lib/whatsapp-secretary/tools/reports.ts`: `DailyReportSummary` gained an
  internal-only `pdfStoragePath`. `toModelReport()` strips it before the model
  sees `data`, replacing it with a plain `hasPdf: boolean`. A new injectable
  `ReportPdfSigner` (`createServerReportPdfSigner()` by default) mints a
  long-lived signed URL via the Admin SDK (same pattern
  `lib/bye-bye-dpr-server.ts`'s `fileReportIntoDirectory` already uses) for
  every report that actually has a generated PDF (only submitted ones do),
  put into `presentation.attachments` — never `data`.
- `lib/whatsapp-secretary/tools/messages.ts`: `OperationalMessageSummary`/
  `HumanMessageSummary` gained internal-only `imageUrl`/`fileUrl`/`fileName`
  (already real, directly-fetchable Firebase download URLs stored on the
  message doc — no signing needed, unlike reports). Same strip-and-replace-
  with-a-boolean treatment (`hasAttachment`), same `presentation.attachments`
  target.
- `lib/whatsapp-response-ux.ts`: new `attachmentsFromExecutions()` — only
  attaches when the question's own wording asked for the file
  (`ATTACHMENT_INTENT_PATTERN`, mirroring `continuationCta`'s existing
  question-intent-matching technique), picks the most recent qualifying tool
  call, caps at 3 files. Wired into `createWhatsAppSecretaryPresentation()`'s
  return value as a new `attachments` field, independent of `presentation`
  (list/CTA) — an attachment supplements the answer, it doesn't replace its
  rendering.
- `lib/whatsapp-cloud-api.ts`: new `sendWhatsAppImage`/`sendWhatsAppDocument`
  (Meta's Cloud API "send by link" message types — Meta's servers fetch the
  URL directly, no upload step). `sendWhatsAppReply` now sends the primary
  reply first, then each attachment as an independent, individually-caught
  follow-up message — one failed attachment never hides the answer already
  sent, and never blocks the others.

**The `hasPdf`/`hasAttachment` signal exists on purpose, found via live
verification**: the first working version had the model saying "I can't
share photos here" in the same turn a photo was genuinely being attached
right after — technically correct (the model truly never had the URL) but
confusing for the actual recipient. Fixed by giving the model this one
boolean so it can say "sending it now" instead of declining, and the system
prompt now explains the contract explicitly.

**Verified live** (real OpenAI call, fixture data — no real Firestore/Storage
touched) across 5 scenarios: "give me the report link" → correct PDF
attachment + correct phrasing; a plain report-content question → no
attachment; "show me the photo" → correct image attachment + correct
phrasing; "who's active right now" → correct names; a vague "firebase link"
question with no resolvable job context → correctly declined without
guessing, and proactively explained the real capability instead. `pnpm
verify:fast` green throughout (`pnpm test:whatsapp-secretary` grew further —
see test files under `scripts/whatsapp-secretary-*`,
`scripts/whatsapp-cloud-api.test.ts`, `scripts/whatsapp-response-ux.test.ts`).

Implementation + tests only — not pushed or deployed as of this writing.

## Company/mission knowledge companion document (2026-08-14, later)

A second knowledge document, `SVC_Company_Mission_Operating_Framework_Knowledge.md`
(repo root, provided by the user), is now integrated into the **same**
retrieval pipeline as the canonical pack — not a separate knowledge system.
It covers company/organizational context the canonical pack's own §2 only
summarized: Site Supervision and the Site Supervisor role, "Provide and
Guide," the Suits/Boots technology philosophy, the full Vision → Mission →
Operation → Objective → Goal → Task → Action hierarchy with planning-horizon
heuristics, Cool Breeze, Operation Major Kong, the sales/job progression
milestone framework, and the SVC Adventure Map tutorial link
(https://svc-app.vercel.app/).

**What changed, all in `lib/knowledge-pack.ts`**:
- `parseKnowledgePackMarkdown(raw, options?)` gained an optional second
  parameter (`{ idPrefix?, source? }`), backward-compatible when omitted (the
  canonical pack's existing chunk ids are completely unchanged). The
  companion document is parsed with `{ idPrefix: "mission", source:
  COMPANY_MISSION_KNOWLEDGE_SOURCE }`, so its chunk ids are namespaced
  `mission-sec-N` — both files independently number their own sections `#
  0.`, `# 1.`, … and would otherwise collide once merged into one pool.
- `KnowledgeChunk` gained a `source` field (which file a chunk came from),
  threaded through to `lib/company-knowledge.ts`'s prefetch citations and
  `lib/whatsapp-secretary/tools/knowledge.ts`'s `knowledge_search`/
  `knowledge_getSection` results — each *result* now carries its own source
  rather than one blanket source for the whole tool call, since a single
  search can legitimately return chunks from both documents now.
- `getKnowledgeChunks()` reads and parses both files independently (each in
  its own try/catch, so one file's failure doesn't blank out the other) and
  concatenates them into one scored pool. `knowledge_search`/
  `knowledge_getSection`/the prefetch needed **zero** changes beyond the
  citation fix above — they already just call into the shared scorer, which
  is source-agnostic by design.
- The system prompt (`prompt.ts`) generalized its label-vocabulary sentence
  (it used to hardcode the canonical pack's own four labels as if they were
  the only ones) to explicitly cover the companion document's different
  vocabulary (COMPANY-SOURCE CONFIRMED / PRODUCT-CODE CONFIRMED / HISTORICAL
  / TIME-SENSITIVE / NEEDS CLARIFICATION) and added an explicit instruction
  not to collapse "this is real company knowledge" into "this is confirmed
  as SVC's *currently active* Mission/Operation today" — the specific
  distinction the user asked to preserve. Also added an explicit exception to
  the "never reveal a link" guardrail for the Adventure Map URL specifically,
  since it's real, stable, retrieved content, not something the model would
  be inventing.
- The canonical pack itself (§1, §2, §13, §19, §20, §21, §22, §23) was
  updated to reference the companion document rather than rewritten — §2's
  existing PROJECT CONTEXT / HUMAN-CONFIRMED company-language paragraph was
  deliberately left as-is (not trimmed/renumbered) to avoid disturbing
  already-audited content; a cross-reference was added instead.

**Verified two ways**: full `pnpm verify:fast` green (166 whatsapp-secretary
tests total, up from 156, across all the affected files — one canonical-pack
test and one knowledge-scenario test updated because the companion document
now correctly
*outranks* the canonical pack's own thinner Cool Breeze mention — expected
improvement, not a regression), and a live OpenAI API pass (real model, real
retrieval, both files) confirming: "What is Cool Breeze?" is answered
confidently with its stated target; "Is Cool Breeze still active today?" is
explicitly hedged rather than asserted; "Can you teach me the SVC framework?"
and an Objective-vs-Goal question both correctly offered the real Adventure
Map URL; Major Kong's relationship to Cool Breeze carries the same
current-status caveat.

## Messages/Communications read layer (2026-08-14)

Communications was the one remaining structurally-excluded module (see the
architecture table below for where the exclusion lived in code). This makes
it a real, deliberately bounded capability instead, split across two tools
with different access rules, because Communications messages are not
uniformly private or uniformly safe:

- **`messages_searchOperationalHistory`** — automatic, system-generated
  Communications posts only (3-Week Outlook publishes, ByeByeDPR clock-in/out
  events, Daily Report submissions). This content is templated/factual by
  construction (job name, event, timestamp — never free text a person typed),
  so it is open to any internal sender, matching every other live-data tool.
  Filterable by job, date range, and `category` (`outlook` | `clocking` |
  `daily-report`).
- **`messages_searchMyCommunications`** — human-written Communications
  messages, hard-scoped server-side to `visibleToUserIds array-contains
  <the requesting sender's own Firebase uid>` — the exact ACL the
  Communications app itself enforces. The model never supplies whose messages
  to check; the actor id comes from the access policy the orchestrator
  already resolved, not model input, and there is no argument that could
  widen the scope. A sender with no linked Firebase user id (contact-only
  identity) gets an empty, explained result — there is no uid to scope by.

**Why `sourceModule` alone wasn't a safe "automatic" signal**: Quest Coral's
Feedback→Communications bridge sets `sourceModule: "quest-coral"` but mirrors
real human-typed feedback text — not an event. Meanwhile ByeByeDPR's own
automatic posts (`createAutomaticCommsPost` in `lib/bye-bye-dpr-server.ts`)
set no `sourceModule` at all before this change. Both were fixed at the
source: `lib/store.ts` now exports `AUTOMATIC_MESSAGE_SOURCE_MODULES`
(`"three-week-outlook"`, `"bye-bye-dpr"`) and `isAutomaticMessageSourceModule()`
as the one shared classification, and `createAutomaticCommsPost` now sets
`sourceModule: "bye-bye-dpr"`. Quest Coral and undefined `sourceModule` both
fall through to "human-written," gated by `messages_searchMyCommunications`.

**Registry change**: `lib/whatsapp-secretary/tool-registry.ts`'s old
`assertNoMessagesTools` (blanket rejection of any tool name matching
`/message|comms?/i`) is now `assertOnlyAllowedMessagesTools` — the same
regex guard, but with an explicit two-name allowlist
(`messages_searchOperationalHistory`, `messages_searchMyCommunications`) so a
*future, different* Messages-shaped tool from an unrelated module is still
caught. A new `canReadMessages` policy flag gates the whole module, same
shape as every other `canRead*` flag. The human-message tool needs to know
*who is asking*, which no other module's factory does — rather than widening
`SecretaryToolFactory`'s signature for every module,
`orchestrator.ts` overrides just the `messages` factory per-request with a
closure capturing `accessPolicy.actorUserId`.

**Firestore indexes**: two new composite indexes were added to
`firestore.indexes.json` — `(contextIds ARRAY_CONTAINS, sourceModule ASC,
timestamp DESC)` for per-job operational history, and `(sourceModule ASC,
timestamp DESC)` for company-wide operational history. **Not yet deployed —
needs an explicit `firebase deploy --only firestore:indexes` and the user's
sign-off**, per the standing rule on production Firebase changes. The
human-message tool needed no new index — it reuses the already-deployed
`(visibleToUserIds ARRAY_CONTAINS, timestamp DESC)` index and filters
job/type in memory over a bounded overfetch, the same "bounded slice, refine
in memory" pattern `reports.ts`/`outlooks.ts` already use for combos with no
dedicated index.

New tests: `scripts/whatsapp-secretary-messages-tools.test.ts` (provider-level
unit coverage — job resolution/ambiguity, date/category/type filtering,
budget, actor-scoping, the no-linked-account graceful path) and
`scripts/whatsapp-secretary-messages-scenarios.test.ts` (real orchestrator,
scripted model, fixture provider — permissions, automatic-vs-human,
job/date filtering across the JSON tool-call boundary, a follow-up turn, and
a cross-module round mixing a Messages tool with another module's tool).

## Company Knowledge integration (2026-08-13, same day)

Prior work in this file (below) built the read orchestrator's **live-data**
side — Directory, Quest Coral, Applications, Reports, Clocking, Outlooks. The
**stable-knowledge** side was still a small, separately-maintained set of 5
hand-written entries in a Firestore `companyKnowledge` collection
(`lib/company-knowledge.ts`, seeded by
`scripts/seed-company-knowledge.ts`/`configure-company-knowledge-access.ts`),
folded once into the system prompt with no way for the model to search
further. Separately, a full audit pass produced
`SVC_AI_Secretary_Canonical_Knowledge_Pack.md` (repo root) — a much larger,
code-verified, CONFIRMED/PRODUCT DIRECTION/NEEDS VERIFICATION-labeled
knowledge document covering every module in depth. This change makes that
document the Secretary's actual knowledge source, retrieved properly instead
of either dumped whole into every prompt or left unused.

**What changed:**

- **`lib/knowledge-pack.ts`** (new) parses
  `SVC_AI_Secretary_Canonical_Knowledge_Pack.md` into ~90 searchable chunks —
  one "broad" chunk per top-level `# N. Title` section (its full text,
  including nested `##` subsections) and one "narrow" chunk per `##`
  subsection — and provides presence-based keyword scoring over them
  (title/breadcrumb-weighted, same style the old Firestore entries used).
  `###`-level headings (used only for the CONFIRMED/PRODUCT
  DIRECTION/NEEDS VERIFICATION labels) are not separate chunks, so that
  status wording stays embedded verbatim in whichever chunk contains it — the
  whole point is that the model sees it, not that it gets parsed away. The
  file is read via `readFileSync(path.join(process.cwd(), ...))`, which
  Next.js's output file tracing picked up automatically — confirmed present
  in `.next/server/app/api/whatsapp/webhook/route.js.nft.json` after a real
  `pnpm build`, so it deploys correctly to Vercel, not just `pnpm dev`.
  Parsed chunks are cached per warm server instance.
- **`lib/company-knowledge.ts`** (rewritten in place, same exported
  `findRelevantCompanyKnowledge()` signature — zero changes needed in
  `orchestrator.ts`, `prompt.ts`, or `route.ts`) now sources its always-on
  prefetch (3 chunks, folded directly into the system prompt before the tool
  loop starts — Directory's own "deterministic prefetch, then tool-calling"
  pattern) from `lib/knowledge-pack.ts` instead of Firestore. A public/
  unidentified sender still always gets exactly one small, hand-written safe
  entry (unchanged in spirit, refreshed in wording), regardless of what they
  ask — there is no scenario where an unrecognized number gets zero
  knowledge context anymore.
- **`lib/whatsapp-secretary/tools/knowledge.ts`** (new) adds two tools —
  `knowledge_search` (short excerpts + section ids) and
  `knowledge_getSection` (one section's full text, up to 3,000 characters) —
  mirroring Directory's own search-then-getEntityDetails shape. This is what
  lets the model go deeper than the 3-chunk prefetch when a question needs a
  different section, a fuller tutorial, or more than the guessed-relevant
  slice.
- **`lib/whatsapp-secretary/tool-registry.ts`**: `"knowledge"` is a new
  `SecretaryModule`, but deliberately gated by the existing
  `accessPolicy.companyKnowledgeScope === "internal"` check rather than a new
  per-module boolean — that field already exactly encoded public/internal for
  knowledge purposes, so no change to `WhatsAppAccessPolicy`'s shape was
  needed. A public sender still gets no tools at all (unchanged), just the
  one fixed prompt entry.
- **`lib/whatsapp-secretary/orchestrator.ts`**: `knowledge: createKnowledgeTools`
  added to `DEFAULT_TOOL_FACTORIES` — the only change needed to wire it into
  the real tool loop.
- **`lib/whatsapp-secretary/prompt.ts`**: the base prompt now explicitly
  frames Company Knowledge ("how SVC/its apps work — call knowledge_search/
  knowledge_getSection") versus Live Data ("what's happening right now — the
  other tools") as two deliberately different sources, instructs combining
  both when a question needs both, and requires the model to relay a
  section's CONFIRMED/PRODUCT DIRECTION/NEEDS VERIFICATION or in-progress/WIP
  wording faithfully rather than flattening it into confident prose. The
  prefetched knowledge block's prompt label now says "a quick-reference
  starting point, not exhaustive" instead of implying it's the complete
  answer.
- **Retired**: `scripts/seed-company-knowledge.ts` and
  `scripts/configure-company-knowledge-access.ts` (both only ever populated
  the now-unread Firestore `companyKnowledge` collection — deleted rather
  than left as dead scripts implying a data flow that no longer exists; the
  collection itself was left alone in Firestore, just orphaned/unread, since
  deleting production data wasn't part of this change).

**Explicitly out of scope for this pass** (per the request): no new write
capability; the Daily Report draft action is untouched; Messages/
Communications access is still structurally impossible (the `"knowledge"`
module name doesn't match the Messages/comms guard, and no knowledge chunk
can grant a tool that isn't already registered); the uncommitted Outlook→
Communications auto-broadcast work identified in the knowledge audit was not
touched — the knowledge pack itself documents it as unshipped WIP (§8), and
the Secretary now retrieves that exact section verbatim when relevant, so it
will correctly tell a user the auto-broadcast isn't shipped rather than
guessing either way.

**Testing**: `pnpm test:whatsapp-secretary` grew from 87 to 125 tests, across
5 new files — `scripts/knowledge-pack.test.ts` (parser correctness on a
synthetic fixture + integration checks against the real file: chunk counts,
ranking, that the Outlook WIP callout's wording survives parsing verbatim),
`scripts/company-knowledge.test.ts` (public-scope safety/consistency,
internal-scope relevance and the current-message → conversation-wide query
fallback), `scripts/whatsapp-secretary-knowledge-tools.test.ts` (budget
handling, empty/unknown-id paths, a real-file end-to-end smoke test), plus
additive tests in `whatsapp-secretary-tool-registry.test.ts` (scope gating)
and `whatsapp-secretary-orchestrator.test.ts` (real `DEFAULT_TOOL_FACTORIES`
wiring, not just a test double). A new
**`scripts/whatsapp-secretary-knowledge-scenarios.test.ts`** exercises the
real orchestrator end-to-end (real knowledge tools + a scripted fake model
playing a plausible tool-call sequence, since this offline suite has no
Firebase Admin credentials for the live-data tools or a real OpenAI key) for
each scenario category the integration was meant to cover: knowledge-only,
live-data-only, knowledge+live-data combined, cross-module, follow-up memory,
and a real retrieval of the pack's own NEEDS VERIFICATION section (the "Cool
Breeze" caveat) proving uncertainty is actually surfaced, not invented past.
This proves the plumbing end-to-end; it does not prove a live GPT model would
choose the same tool sequence — that still needs the manual WhatsApp
checklist below after deploying.

`pnpm exec tsc --noEmit`, `pnpm build`, and `pnpm verify:fast` all pass.

## Read orchestrator upgrade (2026-08-12, same day)

The reading side of the Secretary was rebuilt from a fixed-slice, single-shot
design into a real cross-module tool-calling orchestrator. **Implemented and
verified locally (typecheck, production `pnpm build`, and the full offline
test suite are all green); not yet deployed to Vercel** — deploying is a
separate, explicit step.

**Deployed to production 2026-08-12** (`vercel --prod`, latest deployment
`dpl_9i3SSFtZSrDYiHD16RXLKDRoFS4v`, aliased to
`https://communication-svc.vercel.app`; committed and pushed to `main` as
`b3b0434`). Post-deploy smoke check only (root `/` → 200, webhook `GET`
without a token → 403 as expected); the real end-to-end WhatsApp manual test
pass below is still outstanding.

**Same-day follow-up fix**: the Secretary was declining to share a Directory
person's phone/email even to identified internal senders ("I can't show
phone numbers"). The shared `DirectoryAskRecord` shape (used by the web app's
own "Ask SVC Directory") deliberately has no phone/email field, which is the
right default there — but every WhatsApp sender who can reach Directory tools
at all is, by construction, already a uniquely identified internal SVC user
(`buildToolRegistry` only registers them when `canReadDirectory` is true).
`lib/whatsapp-secretary/tools/directory.ts` now does one bounded extra
`/contacts` read per result to attach `phone`/`email` onto person records
when on file, and the system prompt (`lib/whatsapp-secretary/prompt.ts`)
explicitly tells the model to share them — internal ids, storage links, and
raw report text stay hidden as before. Two new offline tests cover both the
enrichment and the "no linked contact → no fabricated fields" path.

**Directory search upgrade, same day**: user asked for the Secretary to be
"excellently good" at finding/filtering Directory info and to use ALL the
data Directory has, with the best architecture. Two real gaps addressed in
`lib/whatsapp-secretary/tools/directory.ts`:

1. **`searchRelevantNotes` is no longer excluded.** It was carried over from
   the deleted `lib/whatsapp-directory.ts`'s original whitelist, but nothing
   about the WhatsApp access model actually requires excluding it — every
   sender who can reach any Directory tool is already a uniquely identified
   internal user (`canReadDirectory` gates the whole module), the same
   audience notes were already fine for. Found and fixed a real latent bug
   along the way: `WHATSAPP_SECRETARY_AI_LIMITS.maxNotesPerTool`/
   `maxNoteChars` in `lib/ai/config-public.ts` were both `0` (a leftover from
   when notes were excluded) — with notes now enabled, that would have made
   `searchRelevantNotes` silently return nothing on every call. Set to `5`/
   `400`, matching Directory's own `DIRECTORY_AI_LIMITS` defaults.
2. **Keyword-search fallback for real recall.** The shared `findByName()` in
   `lib/ai/server/directory-data.ts` only does exact-match-then-first-word-
   prefix matching on `normalizedName` — searching "Beach" alone never finds
   a job actually named "Miami Beach Project" (the same limitation ByeByeDPR's
   own job search hit and fixed, 2026-08-11). `createHybridDirectoryProvider()`
   wraps the real provider: tries the exact/prefix path first (unchanged, zero
   extra cost for the common case), and only when that finds nothing, falls
   back to `directoryIndex.where("keywords","array-contains-any",tokens)` —
   reusing the exact tokenization (`tokenize()`, exported from
   `lib/directory-core.ts`) and index (`directoryIndex(keywords CONTAINS,
   type ASC)`, already deployed, plus Firestore's automatic single-field
   index on `keywords` when no `type` filter applies) ByeByeDPR's own
   `searchDirectoryJobsByKeyword()` already uses successfully. Results are
   reranked by how many query tokens each candidate's own `keywords` actually
   contains, since `array-contains-any` has no relevance ordering of its own.
   `mapIndexDoc` was exported from `lib/ai/server/directory-data.ts` (purely
   additive) so this reuses the same doc-mapping logic instead of duplicating
   it. No new Firestore index needed. Four new offline tests cover the full
   tool list (incl. notes), notes pass-through, the keyword fallback actually
   triggering on a miss, and it NOT triggering when the primary lookup
   already found something.

What changed:

- The old hardcoded, mutually-exclusive cascade in `route.ts` (Applications →
  Reports → Quest Coral → Directory, at most one per turn) and the single-shot
  `lib/ai/whatsapp-secretary.ts` (no tool-calling, raw `fetch`, a fixed
  7-argument function) are gone.
- `lib/whatsapp-secretary/orchestrator.ts` now calls `runToolConversation`
  (`lib/ai/openai/client.ts`, the same primitive Directory's own "Ask SVC
  Directory" assistant uses), so the **model itself chooses which tools to
  call, across however many modules the question needs, in the same turn**,
  and can call more tools across further rounds
  (`WHATSAPP_SECRETARY_AI_LIMITS.maxToolRounds`, currently 3) before it must
  answer.
- `lib/whatsapp-secretary/tool-registry.ts` defines a generic, module-agnostic
  `SecretaryTool` contract (generalized from Directory's own tool contract).
  Per-module tool files live in `lib/whatsapp-secretary/tools/`: `directory.ts`
  (the full Directory tool stack, including `searchRelevantNotes` — see the
  2026-08-12 "Directory search upgrade" note below), `quest-coral.ts`,
  `applications.ts`, `reports.ts` (all
  extended with real date-range/cursor pagination instead of a fixed
  newest-4/newest-3 slice), plus two genuinely new modules: `clocking.ts`
  (clock-in/out history, never exposes raw GPS coordinates, plus a cross-job
  "most active jobs" tool) and `outlooks.ts` (per-job 3-Week Outlook reads,
  plus a cross-job "active outlooks today" tool — see the "Read layer
  strengthening" section below; both cross-job tools fan out over
  `job-fanout.ts`'s small, bounded active-job list instead of needing a new
  `collectionGroup` index).
- Messages/Communications access was structurally impossible through
  2026-08-13. As of **2026-08-14** it is a deliberate, reviewed, privacy-split
  capability — see the "Messages/Communications read layer (2026-08-14)"
  section above. `lib/whatsapp-secretary/tool-registry.ts`'s guard
  (renamed `assertOnlyAllowedMessagesTools`) still asserts no *other* tool
  name can ever match `/message|comms?/i`; only the two named, reviewed
  `messages_*` tools are allowlisted through it.
- New `whatsappSecretaryAiUsage` Firestore collection (usage-rate guard,
  mirrors Directory's own `directoryAiUsage` pattern) — not yet deployed as a
  rules change since Admin SDK writes bypass rules; nothing new needed there.
- The Daily Report draft write flow (`lib/whatsapp-daily-report-drafts.ts`)
  was **not modified** and still runs before the orchestrator, exactly as
  before.
- Old files fully removed (never committed, so no history was lost):
  `lib/ai/whatsapp-secretary.ts`, `lib/whatsapp-directory.ts`,
  `lib/whatsapp-quest-coral.ts`, `lib/whatsapp-applications.ts`. `lib/whatsapp-reports.ts`
  was kept but trimmed to just the job-name resolution the Daily Report draft
  flow still depends on.

**Not done in this pass, deliberately deferred:**

- The real WhatsApp end-to-end manual test pass (deployed now; see the
  Testing section below for the checklist to run against the live number).
- Any new write capability. (Messages/Communications *read* access shipped
  2026-08-14 — see above; this remains read-only, no new write path.)
- Per-role/per-worker granular permissions — access stays binary
  public/internal.

See `lib/whatsapp-secretary/` for the implementation and
`scripts/whatsapp-secretary-*.test.ts` (run via `pnpm test:whatsapp-secretary`,
now part of `pnpm verify:fast`) for the offline test suite.

## Read layer strengthening (2026-08-13)

Goal stated by the user: "ask this one WhatsApp number anything about SVC and
it will figure out where to look." Reviewed the orchestrator above against
that bar and made five incremental, independently-tested changes — no
rewrite, no change to access control, the Daily Report draft action, or
Messages/Communications exclusion.

1. **Date/time awareness.** The system prompt (`prompt.ts`) now states
   `Today is {date} (UTC)` (matching the UTC convention
   `outlooks_listActiveOutlooks` already computes server-side) and instructs
   the model to resolve relative dates ("last week", "since Monday") into
   concrete ranges itself before calling a tool, and to cite the actual date
   a tool result carries when it's relevant ("based on the latest Quest Coral
   update from Aug 12") instead of answering atemporally.
2. **Stronger model, one conservative reasoning step up.** The Secretary now
   uses `gpt-5.6-terra` (its own isolated `DEFAULT_WHATSAPP_SECRETARY_MODEL`
   in `lib/ai/config.ts` — Directory's and Quest Coral's own `DEFAULT_ASK_MODEL`
   are untouched) with `reasoningEffort: "low"` (up from `"minimal"`, still
   well short of `"medium"`/`"high"` for Hobby-plan latency).
3. **`maxTotalRecords`: 24 → 40** (`WHATSAPP_SECRETARY_AI_LIMITS` in
   `lib/ai/config-public.ts`). A single rich cross-module question can
   legitimately touch 4-6 modules in one turn; 24 shared across that was
   starving later tool calls silently. Still a hard bound.
4. **Safe observability.** `orchestrator.ts` now logs (via
   `logWhatsAppSecretaryAi`, `lib/ai/server/safe-log.ts`) which tools were
   called, which of those came back empty, tool-round count, and total
   records used, per request — never the question text, answer text, or any
   record field values.
5. **Entity resolution parity across every module, not just Directory.**
   Directory's own keyword-search fallback (built earlier on 2026-08-12) only
   benefited Directory's own tools. Two changes closed that gap:
   - `createServerDirectoryProviderWithKeywordFallback()`
     (`tools/directory.ts`) is now the shared default Directory provider for
     every other module's internal job/person lookups — Reports' and
     Clocking's job resolution, Reports' report-author resolution, and
     Applications' `getApplicationsForJob` — so a partial or single-word name
     resolves as well from those call sites as it already does from
     `directory_searchPeople`/`searchCompanies`.
   - New **Directory-first job resolver** (`resolveJobByNameViaDirectory` in
     `tools/job-fanout.ts`): tries Directory's job search first (inheriting
     its keyword-fallback quality), maps a single unambiguous match to its
     linked ByeByeDPR job via `jobs.directoryContextId` (no new index), and
     falls back to the legacy ByeByeDPR-only resolver
     (`findWhatsAppReportJobsByNameCandidates`, still owned by
     `lib/whatsapp-reports.ts` because the Daily Report draft action also
     depends on it, and left completely unchanged) whenever Directory can't
     produce a single, linked match. Wired as the default job resolver for
     Reports and Clocking.
   - New **bounded in-memory keyword fallback** for Quest Coral project names
     and Applications candidate names (`tools/keyword-match.ts`'s
     `rerankByTokenScore`/`scoreNameAgainstTokens`, the non-Directory-specific
     twin of Directory's own reranking logic) — neither collection has a
     derived `keywords` index field, but both are tiny in production
     (confirmed via a read-only `.count()` check: 7 Quest Coral projects, 2
     applications), so the fallback scans a capped page (200) in memory
     rather than needing a new derived field.
6. **New cross-job Reports tool.** `reports_getJobsWithoutRecentReports`
   (`tools/reports.ts`) answers "which jobs don't have a recent report" by
   fanning out over the same bounded active-job list the other cross-job
   tools use, then a `.limit(1)` newest-report lookup per job (existing
   index, no new one). Strictly factual language only — a report from date X
   was found, or none was — never "missing" or "required", matching this
   file's existing guardrail that report cadence can't be inferred from this
   data.

13 new offline tests cover all of the above (job resolver branching, both
keyword fallbacks triggering/not-triggering, the new Reports tool's
filtering/ordering) — 87 total in `pnpm test:whatsapp-secretary`, all green,
alongside `pnpm typecheck` and `pnpm build`. See "Manual WhatsApp test
checklist" below for the live-number verification pass to run after deploy.

### Manual WhatsApp test checklist

Run these against the live sandbox number after deploying this change, from
an identified internal sender. Record the actual reply next to each — this
is what "ask it anything about SVC" verification looks like in practice,
since there is no deterministic mock-mode eval for a 6-module orchestrator
(see the "not proposed" note in the project plan this section came from).

**Direct lookup**
1. "Who is [a real Directory person's full name]?"
2. "What's [a real company name]'s address?"

**Partial / ambiguous name**
3. A single last name that matches exactly one person (should resolve, not ask to disambiguate).
4. A single first name that matches more than one person (should list candidates, not guess).
5. A job name using only one distinctive word from a multi-word job name (e.g. one word from "Miami Beach Project").

**Historical / relative date**
6. "What happened on [a real job] six months ago?" (real historical retrieval, not just the newest slice).
7. "What changed this week?"
8. "Show me [a real job]'s reports since last Monday."

**Cross-module**
9. "Who works with [a real company] and what are their phone numbers?"
10. "What's going on with [a real job] — reports, clock activity, and outlook status?"

**Broad summary**
11. "Give me a summary of [a real company]."
12. "What's happening across all active jobs right now?"

**Contact info (internal-sender sharing)**
13. "What's [a real person]'s phone number?" (should share directly, no hedging).

**Comparison / portfolio-wide**
14. "Which active jobs don't have a current 3-Week Outlook?"
15. "Which job is busiest right now?"
16. "Which jobs don't have a recent Daily Report?"

**Follow-up continuity**
17. Ask about a person, then follow up with just "what about his email?" (should resolve the pronoun from context, not re-ask who).
18. Ask about a job, then follow up with "what happened before that?" (should page into older history via the prior tool's cursor/date range, not repeat the same slice).

**Not-enough-information / guardrail**
19. Ask about someone who does not exist in Directory (should say so plainly, never invent a person).
20. "Can you read my WhatsApp messages with [someone]?" (should say plainly it has no Messages access, never attempt a workaround).

## Current outcome

The SVC AI Secretary is live on the official **Meta WhatsApp Cloud API test
number**. It is a testing/sandbox setup only: no production number was bought,
migrated, or registered.

The live route is:

```text
https://communication-svc.vercel.app/api/whatsapp/webhook
```

The current flow supports an identified SVC user sending text to the Meta test
number, receiving an AI Secretary reply, reading limited internal data when
authorized, and creating a **ByeByeDPR Daily Report draft** only after explicit
confirmation. The user interface and all user-facing replies are in English.

The latest production deployment is
`dpl_AZEUF2aGz1ST54oy5sLpNWCC6NZU`, aliased to the URL above. It includes the
WhatsApp response UX improvements; production smoke checks returned `/` → 200,
an SVC module deep link → 200, and webhook `GET` without verification data →
403 as expected.

## What was configured outside the repository

### Meta / WhatsApp Cloud API

- A Meta Developer App for **SVC AI Secretary** exists and has the WhatsApp
  product configured.
- The official Meta-provided test phone number is being used. It is not an SVC
  production number.
- The personal WhatsApp test recipient was added in Meta so the test number can
  exchange messages with it.
- The Meta callback is the live webhook URL above, and the WhatsApp Business
  Account is subscribed to the `messages` webhook field.
- The access token was replaced with a Meta Business **System User** token with
  the minimal WhatsApp Cloud API permissions required by the server. Do not
  paste that token into source, docs, commits, chat, or browser URLs.

Non-secret identifiers currently in use:

| Item | Value |
| --- | --- |
| WhatsApp Phone Number ID | `1165212860018618` |
| WhatsApp Business Account ID | `1569708631228451` |

### Vercel environment

Production environment variables have been configured in Vercel. Their values
are secrets and must be managed in Vercel rather than committed to this repo.

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | Meta callback verification; must match the dashboard value. |
| `WHATSAPP_ACCESS_TOKEN` | Long-lived System User token used for Graph API calls. |
| `WHATSAPP_PHONE_NUMBER_ID` | Current Meta test-phone ID. |
| `WHATSAPP_WABA_ID` | Filters inbound webhook events to SVC’s WABA. |
| `WHATSAPP_APP_SECRET` | Validates `x-hub-signature-256` on every inbound POST. |
| `WHATSAPP_TEST_RECIPIENT` | Sandbox-only recipient override; remove it before production-number routing. |
| `OPENAI_API_KEY` | Used by the Secretary and existing ByeByeDPR transcription/structuring services. |
| `WHATSAPP_AI_MODEL` | Optional Secretary chat-model override; default is `gpt-5-mini`. |
| `BYEBYEDPR_AI_MODE` | `live` enables live parsing/transcription when `OPENAI_API_KEY` is available. |
| `BYEBYEDPR_AI_TRANSCRIBE_MODEL` | Optional override; default is `gpt-4o-mini-transcribe`. |
| `BYEBYEDPR_AI_PARSE_MODEL` | Optional structured Daily Report parsing-model override. |
| Firebase Admin credentials | Required by the webhook’s server-side Firestore reads/writes. |

Do not document or print the recipient’s phone number, secrets, or service
account contents. `service-account.json` is local-only and must remain ignored.

## Runtime architecture

```text
Meta test number
  -> signed WhatsApp webhook POST
  -> Next.js route on Vercel
  -> per-sender conversation transaction in Firestore
  -> identity and access-policy resolution
  -> explicit Daily Report action OR bounded read-only / AI reply
  -> Meta Graph API text or native interactive response
```

The implementation lives in the current repository; there is no separate bot
service or backend.

| Concern | Main location | Current behavior |
| --- | --- | --- |
| Meta webhook | `app/api/whatsapp/webhook/route.ts` | GET verification, POST signature validation, WABA / Phone Number ID filtering, and dispatch. |
| Cloud API sender | `lib/whatsapp-cloud-api.ts` | Sends text plus native WhatsApp lists/CTA URL buttons via Graph API `v26.0`; sandbox recipient override is optional. |
| Conversation memory | `lib/whatsapp-conversation-memory.ts` | Keeps 12 recent messages per hashed sender and makes Meta delivery retries safe across Vercel instances. |
| Identity | `lib/whatsapp-svc-identity.ts` | Exact phone normalization and safe lookup across `/contacts` and `/users`; ambiguous or missing matches return `null`. |
| Authorization | `lib/whatsapp-access-policy.ts` | Central backend policy; public vs internal and a stricter linked-user check for draft creation. |
| Orchestrator / model | `lib/whatsapp-secretary/orchestrator.ts` | Tool-calling loop on `gpt-5-mini` by default (`runToolConversation`); the model chooses which tools to call, across modules, across up to `maxToolRounds` rounds, before answering. Must not invent unavailable SVC data. |
| Tool registry | `lib/whatsapp-secretary/tool-registry.ts` | Generic `SecretaryTool` contract + per-sender access-policy-filtered registry; `assertOnlyAllowedMessagesTools` still structurally blocks any *unreviewed* Messages/Communications-shaped tool name — only the two real `messages_*` tools below are allowlisted (see the 2026-08-14 section above). |
| Company knowledge | `lib/knowledge-pack.ts` (parsing/scoring), `lib/company-knowledge.ts` (prefetch) | Scored retrieval over two files as one pool: `SVC_AI_Secretary_Canonical_Knowledge_Pack.md` (product/module) and `SVC_Company_Mission_Operating_Framework_Knowledge.md` (company/mission, added 2026-08-14; chunk ids prefixed `mission-`). A small prefetch (3 chunks) is folded into the system prompt outside the tool loop; `knowledge_search`/`knowledge_getSection` (below) let the model go deeper. |
| Internal read tools | `lib/whatsapp-secretary/tools/{directory,quest-coral,applications,reports,clocking,outlooks,knowledge,messages}.ts` | Bounded, read-only, model-invoked tools with real date-range/cursor pagination where the module supports it; never send whole collections to a model. `knowledge` is stable Company Knowledge, not live SVC data — gated by `companyKnowledgeScope`, not a `canRead*` flag. `messages` is the Communications read layer (2026-08-14) — see above; unlike every other module it is further actor-scoped for its human-message tool. |
| Usage guard | `lib/whatsapp-secretary/usage-guard.ts` | Per-identified-sender rolling rate limit over `whatsappSecretaryAiUsage` (mirrors `directoryAiUsage`). |
| First write action | `lib/whatsapp-daily-report-drafts.ts` | Preview / confirm / cancel flow, using the established ByeByeDPR `/reports` document shape. Unchanged by the read-orchestrator work. |

## Access-control boundary

The access policy is enforced in the backend/tool layer, not merely in the AI
prompt.

- An unknown or ambiguous WhatsApp number receives only public company
  knowledge. It cannot query Directory, people, companies, jobs, contexts,
  Quest Coral, Applications, Reports, or other internal data.
- A uniquely recognized SVC person receives the internal read-only scope.
- The Daily Report write action is stricter: it requires a recognized person
  **and** a linked Firebase `userId`, because a ByeByeDPR report must have a
  valid author. An identified contact without a linked user cannot create a
  draft.
- Server-only actor identifiers are used for authorization and are not passed
  to OpenAI.
- The identity resolver never reads Messages, Directory projections, or private
  contact fields. It uses exact normalized phone candidates only; it must not be
  changed to suffix matching.

The current personal sandbox sender was deliberately linked to its existing SVC
user/person record without creating a duplicate. Keep that linkage intact when
testing future changes.

## Current conversation and idempotency behavior

`/whatsappConversations/{sha256(senderPhoneNumber)}` stores up to six exchanges
(12 messages), each truncated to 2,000 characters. The raw sender phone number
is not used as a Firestore document ID.

For each inbound text or native list-selection message, the webhook:

1. validates Meta’s signature before parsing the payload;
2. accepts only `whatsapp_business_account` events for the configured WABA and
   Phone Number ID;
3. records the inbound message transactionally;
4. returns a previously persisted assistant reply if Meta retries the same
   message ID;
5. uses a short in-process cache and a pending-promise map to avoid duplicate
   work within an instance; and
6. sends the stored/generated reply through the Graph API.

This message-level protection complements the Daily Report-specific transaction
described below.

## WhatsApp response UX

For a new inbound text message that needs processing, the webhook now calls the
official Cloud API `messages` endpoint with `status: "read"`, the inbound
`message_id`, and `typing_indicator: { type: "text" }`. The sender therefore
gets Meta’s native read receipt and typing state before the Secretary performs
identity resolution, retrieval, or generation.

The response UX is deliberately independent of retrieval, permissions, company
knowledge, and report business logic:

- Fast requests send only the normal final reply; the native typing state is
  dismissed by that response.
- If work is still in progress after 15 seconds, the sender receives one
  English progress message: `I’m still working on that—one moment.` The final
  reply waits for that message to finish sending, so message order is stable.
- If the optional read/typing or progress request fails, it is logged without
  blocking the normal final-reply path.
- Retries that already have a persisted assistant reply do not start a new
  processing-feedback cycle.

The adapter implementation is in `lib/whatsapp-cloud-api.ts`; orchestration is
in `app/api/whatsapp/webhook/route.ts`; and API-payload coverage is in
`scripts/whatsapp-cloud-api.test.ts`.

### Interactive responses and first-contact discovery

This layer adds presentation only; it does not add a tool, data source,
permission, or write action.

- When an already-authorized Directory or Quest Coral search produces multiple
  explicit people, companies, jobs, or projects, the server sends a native
  WhatsApp **list** (up to 10 rows) instead of a long text enumeration. A
  selection becomes safe ordinary conversation text (`Selected: …`) — the
  opaque WhatsApp row ID is never trusted or used as a SVC record ID.
- When a response has exactly one known target, the server can send one native
  **CTA URL** button: Directory profile, 3-Week Outlook, Quest Coral project,
  or Applications record. Supported actions that must continue in the app use
  a module CTA instead (Directory, Quest Coral, Applications, or ByeByeDPR).
  The target is generated deterministically by server code; the model never
  receives a target ID or invents a URL.
- `app/page.tsx` accepts the small deep-link allowlist (`directory`,
  `questCoral`, `application`, and `module`) after normal Firebase sign-in.
  These URLs only choose navigation state; they never bypass Firebase auth or
  Firestore rules.
- If a resolved SVC user has no prior conversation history, the Secretary
  adds a concise English greeting using their resolved first name. A simple
  first “Hello” gets a short set of examples; a substantive first request gets
  the greeting plus the direct answer, not a tutorial.
- The model's answer contract is now concise by default: English, direct
  answer first, capped at 700 characters, and at most three short bullets when
  they make a multi-part result clearer.
- Native interactive delivery has a text fallback. If Meta/the client rejects
  a list or CTA, the sender still receives the answer (and URL or named
  choices) rather than a failed webhook reply.

The implementation is split intentionally:

| Concern | Location |
| --- | --- |
| Presentation decision / welcome | `lib/whatsapp-response-ux.ts` |
| Native list / CTA payloads + fallback | `lib/whatsapp-cloud-api.ts` |
| Inbound native selection parsing | `app/api/whatsapp/webhook/route.ts` |
| Persisted reply presentation (retry-safe) | `lib/whatsapp-conversation-memory.ts` |
| Deterministic app deep links | `lib/whatsapp-secretary/guidance.ts`, `app/page.tsx` |

Focused coverage lives in `scripts/whatsapp-response-ux.test.ts`,
`scripts/whatsapp-webhook-parser.test.ts`, and
`scripts/whatsapp-cloud-api.test.ts`.

The native payloads and fallback are covered in automated tests. A manual
WhatsApp-client check remains useful after any future Meta account/client UI
change: send an internal question that has multiple matches, choose one list
row, and confirm the Secretary follows the selection and a relevant CTA opens
the authenticated SVC route.

## ByeByeDPR Daily Report draft action

This is the only WhatsApp write capability. It intentionally does **not**
submit/finalize a report, create a Communications Message, attach a file, or
edit any other entity.

### User-facing contract

The request must be explicit and include an exact job name plus useful report
details. A safe example is:

```text
Create a Daily Report draft for North Ridge:
Work completed: Installed the north wall framing.
Issues or delays: Waiting on the permit inspection.
Next steps: Finish the east wall framing.
```

The assistant resolves exactly one existing ByeByeDPR job, structures only the
provided report text using the existing ByeByeDPR parser, and replies with a
preview. No `/reports` document exists at this point.

Only either of these explicit actions can make a write:

```text
CONFIRM DRAFT
CONFIRM DAILY REPORT
```

The implementation deliberately rejects a bare `yes`. A pending preview can be
discarded with `CANCEL DRAFT` (or its explicit Daily Report equivalent).

### Persistence and safety

- `/whatsappReportDraftActions/{sha256(senderPhoneNumber)}` is a server-only
  confirmation record, not an alternative report format. It holds the pending
  preview state for one sender.
- The final record is the existing `/reports/{deterministic-report-id}` shape:
  `jobId`, `authorId`, `type: "daily_report"`, `status: "draft"`, original
  `rawText`, `structuredData`, standard ByeByeDPR null fields, timestamps, and
  an `idempotencyKey`.
- The initial request message ID and sender seed a deterministic action key and
  report ID. The confirmation transaction verifies the existing report, then
  creates it only once and marks the action created in the same Firestore
  transaction.
- A repeated `CONFIRM DRAFT` replies that the draft already exists and does not
  create another one. A Meta webhook retry is also covered by conversation
  reply persistence.
- `audioStoragePath`, `pdfStoragePath`, `commsMessageId`, and `submittedAt`
  remain `null` for this WhatsApp-created draft.

### Real production test already completed

Using the linked personal WhatsApp sandbox recipient:

1. Requested a Daily Report draft for **LDS Outdoor Pavilions** with explicit
   work completed, issues/delays, and next steps.
2. Received the correct structured preview and `CONFIRM DRAFT` instruction.
3. Sent `CONFIRM DRAFT` and received: the draft was created and remains draft
   only.
4. Sent `CONFIRM DRAFT` again and received: it was already created.
5. Performed a bounded server-side Firestore check: exactly one
   `whatsapp-draft-*` Daily Report exists for that job, with `status: "draft"`,
   an idempotency key, an author, and no `submittedAt`. Report contents were
   not read during that check.

Do not submit or delete this real test draft as part of future unrelated work
unless the user explicitly asks.

## Read-only capabilities already available

Recognized internal users get a tool-calling orchestrator (see the "Read
orchestrator upgrade" section above) that can call any of these, in
combination, in one turn:

- **Company Knowledge:** the full `SVC_AI_Secretary_Canonical_Knowledge_Pack.md`
  (company overview, every module's purpose/tutorials/terminology, cross-module
  workflows), retrieved via scored search rather than one fixed slice. A small
  prefetch is folded into the prompt for every internal question; `knowledge_search`/
  `knowledge_getSection` let the model retrieve a different or deeper section on
  demand. Public users still get exactly one small, fixed, safe entry and no
  knowledge tools at all.
- **Directory:** the full tool stack — people, companies, jobs, contexts,
  relationships, connecting paths, shared contacts/jobs, and free-text notes
  (`searchRelevantNotes`, no longer excluded — see the 2026-08-12 "Directory
  search upgrade" note below). No broad collection export/scan of any kind.
- **Quest Coral:** project search, full project details + written context,
  per-project activity with date-range/cursor pagination, and a cross-project
  "recent activity" feed for portfolio-style questions.
- **Applications:** candidate search, the review queue (now lists
  `needs_information`, not just a count), and per-job application history.
- **ByeByeDPR reports:** per-job/global/per-author report search with
  date-range/cursor pagination, plus a portfolio-wide "jobs without a recent
  report" tool; raw report text, audio, attachments, storage links, and
  Communications Messages stay out of the model context.
- **ByeByeDPR clocking:** per-job clock-in/out history (never exposes raw GPS
  coordinates, only whether a location was recorded) plus a cross-job "most
  active jobs right now" tool.
- **3-Week Outlooks:** per-job outlook reads (tasks, dates, status) plus a
  cross-job "active outlooks today" tool.

No WhatsApp capability has access to `/messages` or may write to Messages —
enforced structurally in `lib/whatsapp-secretary/tool-registry.ts`, not just
by prompt instruction.

## Testing and verification completed

The following pass for the current WhatsApp Secretary implementation:

```bash
pnpm test:whatsapp-secretary
pnpm typecheck
pnpm build
```

The focused suite has 87 passing tests. It covers strict Daily Report command
recognition and idempotency, authorization boundaries, the tool registry,
native list/CTA payloads, native selection parsing, concise response
presentation, first-contact welcome behavior, per-module entity resolution
(including both keyword fallbacks and the Directory-first job resolver), and
the new cross-job Reports tool. See "Read layer strengthening" above for the
manual WhatsApp checklist to run against the live number after deploy.

Useful development commands:

```bash
pnpm typecheck
pnpm build
vercel --prod
vercel inspect https://communication-svc.vercel.app
```

Before editing, always run `git status --short`. The worktree has pre-existing
uncommitted WhatsApp and related changes; preserve them and do not reset,
checkout, or clean unrelated files.

## Next requested feature: WhatsApp voice notes

The user’s next request was paused before implementation:

> An identified SVC user should be able to send a WhatsApp voice note describing
> a Daily Report, have it transcribed, and continue through the exact same draft
> preview and `CONFIRM DRAFT` flow. Voice handling must stay isolated from Daily
> Report logic. Preserve access control, confirmation, and idempotency.

### Existing code to reuse

Do **not** create a second report parser or a new report document format.

- `features/bye-bye-dpr/ai/server/transcription-service.ts` exports
  `transcribeReportAudio(...)`. It already uses the common OpenAI client and
  `getByeByeDprAiConfig()`.
- Default transcription model: `gpt-4o-mini-transcribe`.
- `lib/ai/openai/client.ts` has the shared `/audio/transcriptions` multipart
  implementation.
- `features/outlooks/ai/server/audio-validation.ts` validates accepted WebM,
  OGG, MP4, MP3, M4A, and WAV audio types and a duration cap. WhatsApp voice
  notes are normally OGG/Opus, so use the `audio/ogg` path and ensure the MIME
  type is normalized before validation.
- `BYE_BYE_DPR_AI_LIMITS` sets the existing ByeByeDPR cap: 8 MiB, 300 seconds,
  30-second provider timeout, and a 4,000-character text cap.
- `handleWhatsAppDailyReportDraftAction(...)` is already the correct target.
  Feed it the transcribed text through the normal conversation path rather than
  reproducing job lookup, parsing, preview, confirmation, or report writes.

### Suggested implementation shape

1. Keep media download/transcription in a focused module such as
   `lib/whatsapp-media.ts` or `lib/whatsapp-voice-notes.ts`; do not put Graph
   media logic in `lib/whatsapp-daily-report-drafts.ts`.
2. Extend the signed webhook payload parser to recognize an incoming WhatsApp
   `audio` message (media ID, MIME type, optional voice flag) while continuing
   to ignore statuses and unsupported messages safely.
3. Resolve access before downloading media. An unknown/unlinked sender should
   not trigger a Graph media fetch or an OpenAI transcription call. Use the
   same `canCreateDailyReportDraft` boundary as the text write action.
4. Fetch the media metadata/download URL and bytes from the official Graph API
   with `WHATSAPP_ACCESS_TOKEN`; enforce byte and MIME limits, construct a
   transient `File`/`Blob`, validate it, and transcribe it with
   `transcribeReportAudio`.
5. Turn the transcript into the normal conversation input using the original
   WhatsApp message ID. This lets the existing action see it as text and reuse
   the exact preview / `CONFIRM DRAFT` / idempotent Firestore write flow.
6. Do not upload the WhatsApp voice note to Firebase Storage by default; the
   current WhatsApp draft action sets `audioStoragePath: null`. That avoids
   retaining audio until a separate product decision explicitly requires it.
7. Return a short, safe English error when a voice note is empty, unsupported,
   too large/long, cannot be downloaded, or cannot be transcribed. It must not
   create a preview or draft on failure.
8. Add focused tests for parser selection, unauthorized short-circuit before
   download/transcription, accepted OGG flow, transcript-to-existing-draft
   handler reuse, failure behavior, and a repeated Meta delivery / confirmation
   idempotency case.
9. Deploy to Vercel, send a real WhatsApp voice note from the linked sandbox
   recipient that explicitly says the job name and report details, receive the
   preview, type `CONFIRM DRAFT`, and prove one unsubmitted draft was created.

For the first version, it is safest to require the spoken note to include an
explicit request such as “Create a Daily Report draft for …” together with the
job and details. Keep the confirmation typed as `CONFIRM DRAFT`; this preserves
the existing unambiguous confirmation contract.

## Guardrails for future work

- Use only official Meta / WhatsApp Cloud API endpoints; do not introduce
  Twilio, Make, Zapier, or a separate bot backend.
- Do not buy, register, migrate, or configure the final SVC phone number until
  the user explicitly starts the production-number phase.
- Do not add templates, billing work, campaigns, Firebase live writes beyond
  the approved Daily Report draft action, or Messages access without explicit
  approval.
- Keep all prompts, entity extraction, commands, logs intended for product use,
  and user-facing responses in English.
- Preserve the current webhook callback URL and Meta sandbox configuration when
  extending the code.
- Never hard-code access tokens, verify tokens, app secrets, OpenAI keys,
  service-account values, or personal phone numbers.
- New internal capabilities must enforce authorization in the data/tool path,
  not only in an AI system prompt.
- Use narrow Firestore queries and concise model context. Do not ship whole
  collections or raw internal data to OpenAI.
- For any new write action, retain preview + explicit confirmation + server-side
  transactional idempotency as the baseline pattern.

## Related documentation

- [SVC AI Secretary Canonical Knowledge Pack](../SVC_AI_Secretary_Canonical_Knowledge_Pack.md) — the Company Knowledge source `lib/knowledge-pack.ts` parses and retrieves from.
- [ByeByeDPR product context](./svc-bye-bye-dpr-product-context.md)
- [ByeByeDPR module context](./svc-bye-bye-dpr-module.md)
- [SVC project context for AI agents](./svc-project-context-for-ai-agents.md)
- [Applications product context](./svc-applications-product-context.md)
- [Quest Coral product context](./svc-quest-coral-product-context.md)
