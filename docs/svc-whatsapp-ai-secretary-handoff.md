# Courtney Roberts — WhatsApp handoff

_Last updated: 2026-08-18. This is the operational handoff for continuing the
Courtney Roberts work. Treat the current code, Vercel configuration, and
Firebase data as the authority if they differ from this document._

## Onboarding rebuild: the claim loop, and a way in for unrecognized numbers (2026-08-18, latest)

Reported from three real production transcripts. Three separate defects, one
theme: identity was a dead end for anyone Courtney did not already recognize.

### 1. The claim loop (the actual bug)

A sender was asked for their SVC email, gave it, was told "I've linked this
WhatsApp number to your SVC account" — and their very next message asked for
the email again. Forever.

**Root cause**: `lib/whatsapp-identity-claim.ts` writes
`/users.whatsappPhoneNormalized`, but the 2026-08-16 resolver put that field
in the SAME "explicit" tier as `/users.phoneNormalized`. When the ambiguity
came from two `/users` docs sharing a registered phone (several employees
registering one office number), the link could not break its own tie: the next
message re-resolved as ambiguous and re-asked. `linkWhatsAppNumberToUser()`
did not notice, because its conflict check only looked at
`whatsappPhoneNormalized`.

**Fix** — the resolver is now **three tiers**, strongest first
(`classifyWhatsAppIdentityMatches`, `IdentityTier`):

1. `whatsapp-link` — `/users.whatsappPhoneNormalized`, `/contacts.whatsappPhoneNormalized`
2. `registered-phone` — `/users.phoneNormalized`
3. `directory-phone` — `/contacts.phoneNormalized`

A deliberate WhatsApp link now lands strictly above whatever caused the
ambiguity, which makes claiming **self-terminating by construction**. Each
tier still resolves to a unique *real identity* exactly as before (one linked
account beats any number of unlinked duplicates), and a weaker tier is still
only consulted when every stronger one is empty.

`resolvedVia` stays a two-value field (`explicit` = tiers 1–2, `fallback` =
tier 3) because it is persisted on Courtney Roberts Center conversation docs
and drives the self-heal branch; the precise tier rides along as the new
log/audit-only `resolvedTier`.

### 2. Linking no longer throws the sender's question away

The claim outcome's identity was previously discarded — the reply was "Send
your question again and I'll help." Now `resolveIdentityEnrollment()` in the
webhook hands the freshly claimed identity to the normal flow, so the original
message is answered in the same turn with the confirmation prefixed onto it
(`addIdentityNotice` in `lib/whatsapp-response-ux.ts`, sibling to
`addCapabilityHint`/`addSecretaryIntroduction`, with the same body-cap and
native-presentation care).

When the message was *only* the email there is no question to carry forward —
`isIdentityEmailOnlyMessage()` detects that and a deterministic "you're all
set" reply goes out instead, so the model is never asked to answer an email
address.

An email anywhere in a message is now also acted on immediately, pending
prompt or not. The 24h TTL governs whether the prompt is *re-asked*, not
whether a volunteered answer counts.

### 3. Unrecognized numbers now have a way in (the headline change)

Before: `not_found` went straight to public with no recovery path at all. A
real SVC employee writing from an unlisted phone was told to "ask your SVC
admin" — something they cannot action from WhatsApp.

Now the claim flow has two modes (`IdentityClaimMode`):

- **`"ambiguous"`** — blocking, unchanged. Courtney genuinely cannot act until
  it knows which matching person is writing.
- **`"unrecognized"`** — non-blocking. The public answer still goes out, with
  `UNRECOGNIZED_IDENTITY_OFFER` appended inviting them to reply with their SVC
  email. Rate-limited by `shouldOfferIdentityEnrollment()`, which reuses the
  same `pendingIdentityClaim` record and TTL — so one invitation stands for
  24h and an outsider asking several public questions is invited once, not
  every time.

`lib/whatsapp-secretary/prompt.ts`'s public access block was updated to match,
so the model stops telling people their only option is an admin.

### 4. A resolved account now finds its Directory record

A `/users`-only match carried `personId: "user:<uid>"`, and
`contactIdFromPersonId()` returns null for that — so the STRONGEST tiers
produced the EMPTIEST self-context ("Directory profile: none linked" for
someone who has a perfectly good one). `withLinkedDirectoryContact()` /
`mergeLinkedContactIntoIdentity()` follow `linkedUserId` back the other way
(`contacts.where("linkedUserId","==",uid).limit(2)`, no new index) and adopt
the contact when there is exactly one. Ambiguity is declined, never guessed;
the account's own name and role stay authoritative.

### 5. Admin manual link, from the Center itself

`POST /api/courtney-roberts-center/conversations/{id}/link` +
`lib/courtney-roberts-center/link-identity.ts` + a "Not linked to an SVC
account → Link" banner on an unlinked thread. Writes the same
`whatsappPhoneNormalized` field the conversational claim writes (no separate
"admin link" concept), then re-resolves and re-stamps the conversation doc so
the Center reflects it immediately. This is the fallback for what self-service
cannot reach; it replaces having to shell into
`scripts/link-whatsapp-sender-identity.ts`.

### ⚠️ Security debt, accepted deliberately

Extending claiming to `"unrecognized"` senders **materially widens** the trust
model, on Ben's explicit 2026-08-18 call to prioritize a working onboarding at
this stage. Previously only senders already provably matching 2+ SVC records
could claim; now ANY number that messages the SVC line and supplies a valid
SVC email address obtains the full internal read scope — Directory phones and
emails, Applications candidate PII, daily reports, clocking. The system prompt
still tells the model every sender reaching its tools is "already a verified
internal SVC employee," which is no longer strictly true.

There is also **no attempt cap** (the AI usage guard lives in the orchestrator,
which the claim path returns before) and **no domain restriction** on the
email.

**Before this goes beyond the current small internal rollout it needs**: a
one-time code mailed to the SVC address for `"unrecognized"` claims, and a
per-sender attempt limit. Same open item the 2026-08-16 section already
flagged, now more urgent.

### 6. Duplicate copies of one person stopped counting as a conflict

Running the read-only prod audit after the tier fix left **59** unresolvable
numbers — and **34 of them were one employee duplicated across import
sources**: the same normalized name on an `op_person_*` (operational import),
a `usr_*` (master import) and/or a hand-added contact, all with
`linkedUserId: null`. The resolver was telling real people it had "found more
than one SVC profile" about *them*.

`collapseDuplicatePersonRecords()` now folds unlinked candidates that all
normalize to the same name (case/accents/punctuation only — deliberately
strict) into one, picking the survivor deterministically (a record carrying a
role first, then lowest id) so a number always resolves to the same personId.
Only unlinked candidates: two different registered accounts stay a genuine
conflict, because merging those would pick an arbitrary uid to act as.

**Prod result: 59 → 25 ambiguous numbers, with no data written at all.** The
remaining 25 need human judgment and are correctly left alone — genuinely
different people sharing a phone ("Robert Hayes" / "Mary Kay Demartini", a
shared landline), nicknames ("Charlie Santoro" / "CHARLES SANTORE"), typos
("Greme Cooper" / "graeme cooper") and partial names ("Heber" / "Heber
Venegas"). Those people can now self-enroll over WhatsApp instead of waiting
for cleanup.

`pnpm backfill:user-phone:dry` was also re-run: 0 eligible, nothing left to
backfill (8 users have a phone, 2 have no derivable one — they can now just
message Courtney and reply with their SVC email).

### 7. Public → internal is reflected in the Center

`reconcileIdentitySnapshot()` (`lib/courtney-roberts-center/identity.ts`):
public → internal always applies, so a claimed or admin-linked thread stops
saying "Unknown sender" immediately — including for the message that
identified them, since the webhook records inbound messages *after*
enrollment. Internal → public never applies: resolution fails closed, and one
Firestore blip would otherwise rewrite a known thread back to "Unknown
sender" while leaving the old `resolvedUserId` behind as a merge leftover.
`identitySnapshotWriteFields()` writes every identity key explicitly (null
when unset) for the same reason — the summary is a `{merge: true}` write, so
an omitted key silently preserves the previous person's id.

### Verification

`pnpm verify` green: 402 tests in `test:whatsapp-secretary` (up from 369),
typecheck, functions build, production build. New coverage includes the exact
loop scenario as a regression test ("a deliberate WhatsApp link resolves a
number that two registered profile phones would otherwise leave ambiguous").

**Not done**: no live-WhatsApp run yet — same gap the 2026-08-16 claim flow
had. The remaining 25 ambiguous numbers are a Directory data-hygiene backlog
needing human judgment, not a code gap; re-run `pnpm audit:whatsapp-identity`
(read-only) to measure.

## Profile UI: "Courtney Roberts" card replaces the plain phone field (2026-08-16)

Ben asked for the phone-number entry point in the app's own Profile screen
(not WhatsApp) to stop looking like a generic "Phone" settings row and
instead read as what it actually is: the on-ramp to Courtney Roberts.

`components/profile-screen.tsx`'s standalone `Courtney Roberts` card
(replacing the plain phone row from the same day's identity-model work)
has, top to bottom: a short intro line, a **"Message Courtney"** button
that opens `https://wa.me/{NEXT_PUBLIC_WHATSAPP_SECRETARY_NUMBER}` in a new
tab, and the same inline-edit phone field as before — now captioned "So the
Courtney recognizes you" instead of a bare label, and its placeholder/entry
UX unchanged (still returns `Promise<boolean>` so an invalid entry keeps the
editor open). No new component, no new state — same card, same styling
tokens (`bg-card`, `border-white/10`, `text-primary`) as the rest of Profile,
deliberately not reskinned in WhatsApp's own green branding.

**New env var, deliberately public**: `NEXT_PUBLIC_WHATSAPP_SECRETARY_NUMBER`
(digits only, `19083897201` — see the identifiers table below for the
human-readable number). Unlike every other `WHATSAPP_*` var, this one is
NOT a credential — it's the number people are meant to message — so it's
safe, and required, to ship in the client bundle. Added to `.env.local`
(gitignored — this repo's `.env.example` is itself gitignored too, so
neither ever reaches git; this doc is the only place the actual number is
recorded) and to Vercel production via `vercel env add ... production`.
The CTA button hides itself if the var is ever unset, rather than linking to
a broken `wa.me/undefined`.

Live-verified in the Firebase emulator (same throwaway-Playwright-driver
approach as the identity-model work): the card renders, the `wa.me` link
resolves to the correct href, and the phone edit/save flow still works
unchanged inside the new container.

## Identity model rebuild: /users as source of truth, Directory as fallback (2026-08-16)

Reported from real use: a real registered user (linked SVC account, correct
`linkedUserId`) was not recognized over WhatsApp at all. Root cause: the old
resolver pooled every `/contacts` doc matching a phone number into one flat
list and returned `null` the moment it found more than one distinct identity
— so a single stray duplicate contact (an old vcf import, a mislabeled entry)
could silently block a perfectly legitimate linked account. This section
documents the fix as shipped, in commit `914263a`.

**New two-tier resolver** (`lib/whatsapp-svc-identity.ts`,
`classifyWhatsAppIdentityMatches` / `resolveWhatsAppSenderIdentityDetailed`):

1. **Explicit tier** (strongest source of truth) — `/users.phoneNormalized`
   (new: the account holder's own registered phone), `/users.whatsappPhoneNormalized`,
   or `/contacts.whatsappPhoneNormalized` (an admin- or self-linked WhatsApp
   number).
2. **Fallback tier** — `/contacts.phoneNormalized` (general, imported,
   unverified Directory data) — consulted ONLY when the explicit tier found
   nothing at all.

Within each tier, resolution is over a UNIQUE REAL IDENTITY, not a document
count: one `linkedUserId` wins over any number of unlinked duplicate
contacts sharing the same number; two *different* linked accounts, or two+
unlinked contacts with none to break the tie, both stay genuinely
`"ambiguous"` — now a distinct status from `"not_found"` (previously both
collapsed to `null`).

**Self-healing**: a fallback-tier resolution to a linked user with no
`/users.phone` yet triggers `backfillUserPhoneFromInboundWhatsApp()`, writing
it immediately (`phoneSource: "whatsapp-self-heal"`) so that user's *next*
message resolves via the explicit tier without depending on Directory
hygiene at all.

**Genuine ambiguity now gets a clarifying question, not silent public
fallback** (`lib/whatsapp-identity-claim.ts`, new): "I found more than one
SVC profile... What's your SVC email address?", matched against
`/users.emailNormalized`; an unambiguous match links the number
(`whatsappPhoneNormalized`) going forward. **This is identity CLAIMING, not
cryptographic verification** — no OTP, deliberately, per explicit request
for this stage of a small internal rollout. If Courtney Roberts is
ever exposed to a wider or higher-risk audience, this needs a real
verification step before a claim is allowed to grant internal access. State
persisted as `pendingIdentityClaim` on the conversation doc, same
lifetime/reset convention as `pendingWrite` (24h TTL).

**Shared phone normalization** (`lib/phone-normalization.ts`, new) — one
`normalizePhoneDigits()`/`phoneLookupCandidates()` pair now used by the
identity resolver, Directory contact edits, the imported-contact editor, and
the admin link script (previously four independently-maintained
implementations).

**`/users` gained `phone`/`phoneNormalized`/`phoneSource`**: required at
registration (`components/register-screen.tsx`), self-serve editable in
Profile settings (`components/profile-screen.tsx`), or backfilled —
`phoneSource` tracks provenance (`registration` | `self-reported` |
`directory-linked-contact` | `directory-email-match` | `whatsapp-self-heal`),
audit-only, never gates authorization.

**Backfill tooling** (dry-run by default, `CONFIRM_PHONE_BACKFILL=true` to
write): `scripts/backfill-user-phone-from-linked-contacts.ts` — Phase 1
backfills from a linked contact's phone; Phase 2 (for users with NO linked
contact at all) matches by email against Directory and, on an unambiguous
match, also repairs the contact's `linkedUserId`. Either phase skips
(never guesses) on any disagreement. `scripts/audit-whatsapp-identity-conflicts.ts`
(read-only, reuses the exact resolver function) reports every phone number
that still can't resolve to a unique identity — re-run anytime via
`pnpm audit:whatsapp-identity`.

**Run against production 2026-08-16, on explicit go-ahead**: backfill dry-run
found 7 users eligible with certainty (6 via linked contact, 1 via email
match), 0 conflicts → applied for real. Post-backfill audit: 64 phone
numbers now shared by 2+ docs (was 62 — `/users.phoneNormalized` now
participates too), 4 auto-resolved (was 2), still exactly 60 genuinely
ambiguous (pre-existing Directory duplicate-contact hygiene, unaffected by
the backfill — zero new conflicts introduced). Committed `914263a`, pushed
straight to `main`, deployed `dpl_7XMRoGQ8rCuMKcXfkAQYDHn8oArM`. 350 tests in
`test:whatsapp-secretary` (up from 311).

**Not done**: the ambiguous-identity claim conversational flow was verified
by 8 unit tests plus code review, but not against a real live-WhatsApp
number in a genuinely ambiguous state — worth a real end-to-end run before
considering it fully proven under production conditions. The remaining 60
ambiguous phone numbers are a Directory data-hygiene backlog, not a code
gap. Self-serve WhatsApp number verification via a real OTP challenge is
still open if this ever needs to be more secure than identity claiming.

## Fix: the capability hint was ending every single reply (2026-08-15, latest)

Reported from real use: every answer was closing with "I can also check its
recent Daily Reports, its 3-Week Outlook or who's clocked in — just ask." The
hint was designed to fire at most once every three days; it was firing every
turn, which turned a teaching device into boilerplate.

**Root cause — a field added to a type but never to its reader.**
`WhatsAppOnboardingState` gained `lastCapabilityNudgeAtMs`, but
`readOnboardingState()` still parsed only `lastIntroAtMs` and
`capabilitySignature`. So the timestamp was **write-only**: the hint stamped
it, the next read silently dropped it, and the rate limit never once applied.
A rate limit you cannot read back is not a rate limit. `firstSeenAtMs`,
`guideCompletedAtMs` and `suggestedCapabilities` were being lost the same way.

**Two more problems the same bug was masking:**

- The hint was also *mechanically wrong* after broad answers. The cross-module
  dossier and the daily brief each report as a single module (`svc`, `me`)
  while having just covered reports, outlooks, clocking and Communications — so
  the "which modules went unused?" check cheerfully offered to go check exactly
  what the answer had already covered. Coverage is now expanded before the
  diff, so those turns produce no hint at all.
- The nudge path synthesized a placeholder onboarding record
  (`capabilitySignature: ""`) when none existed, which the reader correctly
  rejects — so even a correctly-read stamp could be discarded. It now only ever
  stamps a record that really exists, and never teaches on the same turn an
  introduction already listed capabilities.

**Regression test added at the seam that failed**: a write → read round trip
through `readOnboardingState`, asserting the timestamp survives *and* that the
limit then holds. The original unit tests all passed while the feature was
broken in production, because every one of them called `buildCapabilityNudge`
with hand-built state — none crossed the persistence boundary where the field
was being dropped.

Tests 311 → 314.

## Onboarding & discovery: first contact, guided tour, daily brief (2026-08-15)

Driven by a product call that the bottleneck is no longer capability but
**discovery**: the failure mode when new people try Courtney isn't "it
can't do that", it's trying two vague questions, getting two shrugs, and never
finding the value. Target: a first "ah, this is good" inside 20–30 seconds.

**Capability profiles** (`lib/whatsapp-secretary/capability-profiles.ts`) — the
Courtney Roberts already knows who it's talking to, so a Site Supervisor and a
recruiter no longer get the same first three examples. Two rules keep it
honest, and they're why this is data + pure functions with no model
involvement: a role only ever **reorders** capabilities (the profile is
intersected with the modules access really enabled, so a role string can never
surface something unreachable), and an unrecognized or missing role falls
through to **what is actually on file** — real linked jobs, projects,
application records — never to a guess.

**`me_getDailyBrief`** — the "what should I know today?" answer, and the
strongest single demonstration in the product. Per linked job it reports the
latest Daily Report and who filed it, whether an Outlook is running, the most
recent automatic Communications post, and how many people are clocked in right
now, plus the person's own open clock, draft reports and project next steps.
Needed one new snapshot source (`getRecentJobActivity`); every query is the
narrowest form an existing module tool already performs, on an already-deployed
index, capped at 4 jobs, each field degrading independently.

**First contact reworked** to recognition → linked counts → scope + role focus
→ four runnable starters → "no commands needed". A live eval caught the first
version listing the same four capabilities three times over (generic breadth,
then role focus, then coverage) — padding exactly where the card has least
attention to spend. Now each fact is stated once. Specific record names live in
the *answer* to a starter, not on the card.

**Guided tour** (`lib/whatsapp-secretary/guided-tour.ts`) — "show me around"
gets four framings ("find information, understand what's happening, learn how
SVC works, point you to the right place to act") plus a **native list whose
rows are runnable questions**. Choosing one flows back through the existing
`Selected: …` path into the real orchestrator, so the tour's last act is a
genuine answer about the person's own work rather than more explaining. Rows
are dropped when the snapshot can't back them, so nobody is offered a stop that
returns empty.

**Progressive discovery** — after a real answer about a specific record, at
most one short line naming adjacent capabilities the turn didn't use ("I can
also check its 3-Week Outlook — just ask"). Rate-limited to once every three
days, never on a disambiguation list, and skipped entirely if it would push the
reply past the send cap. Teaching one capability at the moment it would have
applied beats teaching twenty up front.

**Dynamic capability questions** — `isCapabilityQuestion` now covers the many
real phrasings ("what can you do for me", "what can I ask you about my work",
"how should I use you", "give me some examples"). Outside an introduction turn
these go to the model through `me_getSecretaryGuide`, so the answer is built
from real records and adapts to the phrasing instead of replaying a fixed card.

**Onboarding state** gained `firstSeenAtMs`, `guideCompletedAtMs`,
`suggestedCapabilities` and `lastCapabilityNudgeAtMs` — purely additive, so
existing documents keep working with no migration.

**Verified live against the full demo script**: greeting → personalized card;
"what should I know today?" → `me_getDailyBrief` returning a real three-job
brief; "tell me more about that job" → `svc_getEntityDossier`, resolved from
the carried ref with no re-lookup; "create a daily report draft for it" →
preview + CONFIRM DRAFT contract. Four messages demonstrating identity,
cross-module intelligence, memory and action. Tests 300 → 311.

**Deployed to production 2026-08-15** — `faeef08` pushed to `main` (again via
`git push origin HEAD:main`, without switching the shared checkout), deploy
`dpl_35QXxNogomay9AYj11PnHfyM1KjP`, alias re-verified with `vercel inspect`.
Smoke: root 200, module deep link 200, webhook GET 403 (no token and wrong
token), POST 401 (unsigned and bad signature).

⚠️ **Before demoing, check the data, not the code.** The brief is only as good
as Directory's relations: a person's jobs come from `directoryRelations`, and
the per-job report/clock columns additionally need that Directory job linked to
its ByeByeDPR job via `directoryContextId`. Ask the demo account "what do you
know about me?" first — if it lists their jobs, the brief will work; if it says
no jobs are linked, that is a data fix in Directory, not a code problem. (It
will say so honestly rather than invent, which is correct but not the demo you
want.)

⚠️ Seeing the **first-contact card** requires a sender with no recorded
introduction — clear `onboarding` on `/whatsappConversations/{sha256(phone)}`
for the demo number, or use one that has never messaged Courtney.

## Writes as tools + cross-turn memory (2026-08-15)

Steps 6 and 7 of the architecture review — the last two — implemented in their
own pass, as sequenced.

**The write framework.** `SecretaryTool` gained `kind: "read" | "write"` and
`commit()`. A write tool's `run()` is a **pure preview** that mutates nothing
and returns a `presentation.pendingWrite` envelope
(`lib/whatsapp-secretary/pending-writes.ts`); the deterministic layer persists
it on the conversation document, and only `commit()` — reached from an
exact-phrase confirmation matched **before the model runs** — writes anything.
`assertWriteToolContract` enforces the shape at registry build: a write tool
without a `commit`, or a read tool with one, throws.

**The Daily Report draft is now that first write tool**
(`lib/whatsapp-secretary/tools/report-writes.ts`), replacing the regex branch
that used to run ahead of the orchestrator. **No safety property moved**:
`commit()` delegates to the existing, unmodified store transaction, same
`sha256(sender)` action document, same deterministic `actionKey`/`reportId`, so
the `/reports` write is byte-identical and a repeat confirmation still says
"already created". Two safety properties were *added* — the envelope carries
the **resolved job** (so a confirmation writes against the job that was
previewed, not whatever a name re-resolves to later), and a preview now expires
after 24 hours. A narrow fallback still honors any in-flight preview created by
the old path; delete it once none can plausibly remain.

The real gain: the model can **compose** a write with a read in one turn —
verified live, `reports_search` then `reports_createDailyReportDraft`.

**Cross-turn memory.** The resolver gained `hydrate()`/`minted()`, and the
conversation document now carries `resolvedEntities` plus a compact
`retrievals` digest. A ref minted last turn resolves this turn with **no lookup
at all**, re-asking by name reuses the same entity (so a follow-up cannot drift
onto a different record than the answer it follows up on), and the prompt
carries prior refs and `nextCursor` values forward so a follow-up pages instead
of restarting.

**Live eval, all five checks passed first time** (real model, fixture
providers, a spy store that fails loudly if a preview writes): draft tool
selected and previewed with **no store write**; no false claim of creation;
read+write composed in one turn; "yes"/"go ahead"/"confirm it" all failed to
confirm while only the exact phrase reached commit; turn two reused turn one's
ref. It also showed `truncated` working end to end — the model volunteered
"More reports may exist beyond this result."

One cosmetic bug caught: the confirmation contract printed twice, since the
Daily Report preview already ends with it. `formatPendingWriteReply` now
appends only when the preview hasn't already stated it.

Tests 276 → 299. **Final catalog: 24 tools** (23 reads + 1 write).

**Pushed and deployed to production 2026-08-15**, on explicit user go-ahead,
together with the catalog consolidation below. `cf5e371` (and `51bbae7`) pushed
straight to `main` via `git push origin HEAD:main` — again without switching the
checkout, since the shared worktree sits on the other Codex session's branch.
Deployed `dpl_4oBir32S3vHjTs8DWs7Gvi6TYwkK`; `vercel inspect` confirmed
`communication-svc.vercel.app` resolves to that build. Smoke tests: root 200,
module deep link 200, webhook GET 403 with no token and with a wrong one,
webhook POST 401 both unsigned and with a bad `x-hub-signature-256`.

⚠️ **Still needs one live check that no offline or fixture test can cover**: an
end-to-end `CONFIRM DRAFT` against real Firestore. Everything below the model
boundary was verified with a spy store, and the store transaction itself is
unchanged code — but the new path that reaches it (preview → envelope persisted
on the conversation document → exact-phrase match → `commit`) has never run
against production data. Send a real draft request from the registered number,
confirm it, then verify exactly one new `whatsapp-draft-*` report exists with
`status: "draft"`. Confirm a second time and verify it reports "already created"
without creating another.

## Catalog consolidation: 37 → 23 tools (2026-08-14)

Steps 1–5 of the architecture review below, implemented. **Steps 6 (write
framework) and 7 (memory) are not done** — see that document's
"Implementation status" section for why they were deliberately not bundled in.

What changed, in dependency order:

1. **`lib/whatsapp-secretary/entity-resolver.ts`** — one shared "name → entity"
   resolver. One resolution per name per request (memoized, promise-cached so
   concurrent calls in the same round share one lookup), one entity carrying
   *every* id at once (a job knows its Directory `contextId` and its ByeByeDPR
   `jobId` together), and opaque per-request `ref` handles (`e1`, `e2`) that
   the model passes between tools instead of retyping a name. The six
   duplicated resolution sites with two different reranking implementations
   are gone. Concrete wiring lives in `tools/entity-lookups.ts`, kept separate
   so `entity-resolver.ts` has no Firebase import and unit-tests under plain
   `tsx`.
2. **`svc_getEntityDossier`** (`tools/svc.ts`) — the generic form of
   `me_getMySvcContext`: everything SVC holds about one job/person/company/
   project in a single call. Each section is gated by its own module's access
   flag **before any query runs**, each source fails independently, and
   `emptySections` vs `unavailableSections` are reported separately so
   "nothing on file" never reads like "this record can't have that".
3. **Directory 13 → 5** — `search({query,type?})`, `getEntity({ref|name,
   include})`, `findConnection({from,to,mode})`, `searchNotes`,
   `listUsers({presence})`. The latent wrong-type relationship bug is fixed
   structurally: `getEntity` picks the underlying relationship view from the
   resolved entity's *real* type, so a mismatch can no longer happen.
4. **`truncated` / `totalMatched` / `nextCursor`** on `SecretaryToolResult`,
   plus shared `allowedPageSize()` / `spendBudget()` helpers — the
   bounded-slice guardrail is now machine-checkable rather than a prompt rule
   the model had no way to honor.
5. **Quest Coral 5 → 3, Applications 4 → 2, Reports 4 → 2, Outlooks 2 → 1.**
   Messages stayed at 2 deliberately (the privacy split *is* the model, and a
   `scope` parameter would invite the model to think it can widen it).
6. **`SecretaryToolContext`** — one per-request object passed to every factory,
   replacing the two bespoke overrides `messages`/`me` used to need.

**A live eval caught a real bug, which is the point of having one.** The first
16-question run against the real model scored 10/16. The cause was a
pre-existing presentation bug the consolidation exposed: *any* search returning
multiple records was rendered as a disambiguation list, conflating "here is
data for my next step" with "pick one before I continue". Since the merged
`directory_search` spans all three types when no `type` is given, a broad
question had the model run one exploratory search and the user got "I found 10
possible records" instead of an answer. Fixed by keying the list **only** on
the resolver's explicit `data.candidates` shape. Re-run: **16/16**, and faster
(broad-summary questions went from ~4.5s and wrong to ~3.0s via one dossier
call). A regression test guards it.

Tests grew 254 → 276, including two new suites
(`whatsapp-secretary-entity-resolver`, `whatsapp-secretary-svc-dossier`) and a
shared `scripts/secretary-test-resolver.ts` that builds the *real* resolver over
fixture lookups — a per-module stub would test the opposite of what matters.
`pnpm verify:fast` and `pnpm build` green.

## Tool/orchestrator architecture review (2026-08-14 — the plan behind the above)

A full review of Courtney **as an AI orchestrator with tools**, against
the question of whether it can keep growing into a much more capable company
AI. Written up separately, because it is a multi-session plan rather than a
changelog entry:
**[svc-whatsapp-secretary-tool-architecture-review.md](./svc-whatsapp-secretary-tool-architecture-review.md)**.

Headline: the loop and the access model are right and should not be
regressed; the **tool catalog** is the ceiling. There are **37 tools** exposed
to an identified internal sender today, grown one-tool-per-question-shape,
which is _modules × shapes_ — the review proposes **22 with more capability**
(optional filters/cursors where split tools had fixed slices).

Two findings are live correctness risks rather than scaling concerns, and are
worth knowing before touching this code:

- **Entity resolution is duplicated six times with two different reranking
  implementations**, and each tool re-resolves `jobName` independently — so a
  cross-module question can silently blend two different jobs into one answer.
- **The shared record budget truncates with no marker**: `SecretaryToolResult`
  has no `truncated`/`totalMatched`, so the standing "never say something is
  missing just because it wasn't in a bounded result" guardrail is currently
  impossible for the model to actually honor.

Recommended order of work, each step unblocking the next: entity resolver +
`refs` → a generic `svc_getEntityDossier` (the non-`me` form of
`me_getMySvcContext`) → Directory 13 → 5 → `truncated`/`totalMatched` →
search consolidation in Quest Coral/Applications/Reports → a write framework
(`kind: "read" | "write"` with `preview`/`commit` on the tool contract) →
memory that persists tool results, not just transcript text.

Explicitly rejected in the review: an LLM router in front of the tool loop,
per-module sub-agents, embeddings for Company Knowledge, and any change to the
`presentation` channel.

## Self-awareness, onboarding, and personalized discovery (2026-08-14, latest)

Courtney Roberts could already answer almost anything about SVC, but nothing
about *the person asking*. It resolved an identity on every turn and then
threw it away: the system prompt literally told it to "never reveal it back",
the only onboarding was one fixed greeting on the first-ever message, and
"what can you do?" produced a generic feature list identical for everyone.
This closes that gap without touching the access model.

### `me` module — "My SVC Context"

`lib/whatsapp-secretary/self-context.ts` builds one bounded snapshot of what
SVC genuinely knows about the resolved sender, and
`lib/whatsapp-secretary/tools/me.ts` exposes it as three tools:

- **`me_getMyProfile`** — who they're recognized as, their own contact
  details, the companies/jobs linked to them in Directory, and an explicit
  `gaps` list.
- **`me_getMySvcContext`** — their whole current situation at once: linked
  jobs/companies, Quest Coral projects (owned or involved), their own recent
  Daily Reports including drafts, whether they're clocked in right now, the
  Outlooks running on their jobs, how much recent Communications activity they
  can see, and their own Applications record if their contact details match
  one.
- **`me_getSecretaryGuide`** — what Courtney can do *for this person*,
  how to use it, and example questions built from their real records.

**This is personalization, not a new permissions model.** Every read is
either about the sender's own record, already open to any identified internal
sender through an existing tool, or — for Communications — scoped server-side
to the exact `visibleToUserIds array-contains <own uid>` ACL
`messages_searchMyCommunications` already enforces. New policy flag
`canReadOwnContext` follows the existing `canRead*` shape. Like `messages`,
the module is registered per-request with the **server-resolved actor closed
over**, and its tools take **zero arguments** — there is deliberately no
`personName` parameter anywhere in the file, so the model has no way to point
any of it at someone else.

**No new Firestore index.** Reports reuse the deployed `(authorId, status,
createdAt DESC)`; Communications reuses `(visibleToUserIds CONTAINS, timestamp
DESC)`; Applications matching is single-field equality on `general.email`/
`general.phone`. Clocking deliberately reports only the *currently open* clock
(`userId == uid AND status == "active"`, the equality-only shape
`getActiveClock()` already uses in production) rather than clock history —
history would need a `(userId, clockInAt DESC)` composite index that does not
exist, and returning an arbitrary unordered slice labelled "recent" would be
worse than not answering. Quest Coral membership lives in a `people[]` array
of objects Firestore can't query, so it filters one bounded
`orderBy(updatedAt).limit(200)` page in memory — the same tradeoff
`tools/quest-coral.ts` already makes on that confirmed-small collection.

**Two anti-invention rules are structural, not prompt-only**: every source is
fetched in its own try/catch and degrades to empty/`null` (one broken read
never blanks the snapshot, and never becomes a made-up value), and absence is
reported *explicitly* as a `gaps` array ("No role/title is on file for them").
`buildPersonalizedExamples` has no branch that can name a job, project, or
company the snapshot didn't return — a person with nothing on file falls
through to capability-level examples with placeholders.

### Onboarding that doesn't repeat itself

`lib/whatsapp-secretary/onboarding.ts` replaces the one-shot greeting with
three deliberate triggers, keyed off a **capability signature** —
`v{version}|{level}|{sorted enabled modules}|role=…|account=linked|unlinked` —
persisted as `onboarding: { lastIntroAtMs, capabilitySignature }` on the
existing `/whatsappConversations/{sha256(phone)}` document (same lifetime, id
and privacy posture as the transcript; no new collection):

- **first-contact** — no intro ever recorded and no conversation history.
- **capabilities-changed** — the signature moved. Because the signature
  carries its own module list, the refresher can *name exactly what is new*
  ("I can now read Communications") instead of vaguely re-pitching. Bumping
  `SECRETARY_CAPABILITY_VERSION` is the one lever that re-surfaces
  capabilities across the whole user base.
- **refresher** — nothing changed, but 45 days have passed. An existing
  conversation with no recorded intro (everyone who predates this tracking)
  also lands here, so returning users aren't greeted as brand new.

Everything else gets no introduction at all. The state is written in the
*same transaction* as the reply it was computed for, so a sender can never be
marked "already introduced" for a reply that failed to persist, and a Meta
retry short-circuits before re-arming it.

The introduction copy is built **outside the model**, deterministically, from
the live snapshot — so it cannot invent a role or a job, and a snapshot
failure degrades to no introduction rather than a wrong one. A bare greeting
or a "what can you do?" on an intro turn gets the full card *instead of* the
model's answer; a substantive first request keeps its answer with one short
line of context above it.

Later "what can you do?" turns are answered by the model through
`me_getSecretaryGuide`, so they adapt to the phrasing instead of replaying a
fixed card.

**Prompt changes** (`prompt.ts`): the "never reveal it back" instruction is
gone — recognition is the point now — but replaced with a stricter anchor:
the identity line is a *starting point only*, and anything specific about the
person (role, jobs, projects, what to check) must come from a `me_*` tool
result. Explicit routing rules were added for "what do you know about me",
"what jobs am I on", "what should I check today", "what can you do", "what
can I ask you about my work", each with its own do-not-invent clause.

**Real bug fixed along the way**: `lib/whatsapp-response-ux.ts` clamped every
outgoing body with a helper that collapsed `\s+` into single spaces — so the
short bullet lists the system prompt has always asked for were silently
flattened into one run-on paragraph in WhatsApp. Split into `clamp()` (still
single-line, for native list row titles/descriptions, where WhatsApp allows no
line breaks) and `clampBody()` (preserves newlines, normalizes blank-line
runs).

**Verified two ways.** `pnpm verify:fast` and `pnpm build` green;
`pnpm test:whatsapp-secretary` grew from 205 to 254 tests across four new
files (`whatsapp-secretary-self-context`, `-me-tools`, `-onboarding`,
`-personalization-scenarios`) plus additive registry/response-UX coverage.
Then a **live pass against the real `gpt-5.6-terra`** (fixture self-context
provider, no Firestore/Storage/WhatsApp touched) confirmed the model actually
routes correctly — every question hit exactly the intended tool, in 2.5-4.1s:

| Question | Tool called | Result |
| --- | --- | --- |
| "what can you do?" | `me_getSecretaryGuide` | Named her real jobs (North Ridge, LDS Outdoor Pavilions) and project (Cool Breeze Rollout), not a generic list |
| "what do you know about me?" | `me_getMyProfile` | Role, company, location, both jobs with relationship labels; "no profile gaps on file" |
| "what should I check today?" | `me_getMySvcContext` | Led with the open clock, then the draft report, then the active Outlooks |
| "what jobs am I involved with?" | `me_getMySvcContext` | Both jobs; correctly said "no relationship label is on file" for the second |
| "what can I ask you about my work?" | `me_getSecretaryGuide` | Examples built from her own records |
| empty-profile: "what's my role?" | `me_getMyProfile` | "Your role/title isn't on file… no linked app account" — no invention |
| empty-profile: "how can you help me?" | `me_getSecretaryGuide` | Capability-level examples only, zero invented records |

First-contact card renders at 417 characters.

**Pushed and deployed to production the same day**, on explicit user
go-ahead. Committed as `967122e` and pushed straight to `main` via `git push
origin HEAD:main` — deliberately without switching the checkout, since the
shared working tree was sitting on the other Codex session's branch
(`codex/applications-comms-completion`, which happened to be exactly at
`main`); `git fetch origin main:main` then caught the local ref up. Deployed
`dpl_A61GnLXtgqocAvixj67WU29BNcZh`, and `vercel inspect` confirmed
`communication-svc.vercel.app` actually resolves to that build rather than a
stale one. Smoke tests: root 200, module deep link 200, webhook GET 403 both
with no verify token and with a wrong one, webhook POST with no
`x-hub-signature-256` 401.

**Still needs the live WhatsApp pass** — checklist items 21-27 below. Note
item 21's caveat: the live number may already have been introduced by now, so
its `onboarding` field must be cleared (or a second recognized number used) to
exercise the first-contact path at all.

## `directory_listRegisteredUsers` (2026-08-14, later still)

Real bug from a pasted WhatsApp transcript: "What users are on the svc apps
read me all" answered with only who's *active right now* (1 person), and
when corrected ("Not only active, all registered users") Courtney could
correctly *explain* the distinction but had no tool to actually answer it —
`directory_getActiveUsers` was the only presence-related tool that existed.

Added `directory_listRegisteredUsers` right next to it in
`lib/whatsapp-secretary/tools/directory.ts`: every `/users` doc, no
`lastSeen` filter at all. One real correctness trap avoided: it deliberately
does **not** `orderBy("name")` — `app/page.tsx`'s own client-side mapping
falls back to `deriveNameFromEmail()` when a user has no stored `name` field
(`data.name || deriveNameFromEmail(...)`), which means some `/users` docs
likely have no `name` field at all, and a Firestore `orderBy` on a field a
document doesn't have silently drops that document from the results. Reused
the exact same `deriveNameFromEmail()` fallback (already exported from
`lib/store.ts`) instead, so every registered user is included and named
consistently with what the app itself shows.

Verified live against the exact phrasing from the transcript (`"What users
are on the svc apps read me all"` then `"Not only active, all registered
users"`) — now correctly resolves to the full registered list both times,
and even the first ambiguous phrasing picks the more complete registered-
user answer given "read me all" implies wanting everyone, not just who's
online. `pnpm verify:fast` green.

## Reasoning effort + budget tuning (2026-08-14, later still)

User asked to revisit the conservative cost/latency decisions made earlier
the same day, explicitly keeping `gpt-5.6-terra` as the model but willing to
spend more for better answers, since real usage has stayed well under token
budget. Changes, all in `lib/whatsapp-secretary/orchestrator.ts` and
`lib/ai/config-public.ts`:

- **`reasoningEffort: "low"` → `"medium"`**. Only the final, tool-less round
  ever uses this — every tool-bearing round is unconditionally forced to
  `"none"` (the `gpt-5.6-terra`-on-`/v1/chat/completions` constraint from the
  earlier reasoning_effort incident this same day). So the cost/latency
  impact is bounded to exactly one call per question, not multiplied by
  `maxToolRounds`. Verified live before changing anything: ran the same 2-3
  realistic questions at `low`/`medium`/`high` through the real orchestrator
  (fixture tools, real OpenAI calls) — latency stayed in the same ~1.5-7s
  range across all three (no cliff), `medium` showed modestly more careful
  synthesis with zero regressions, and `high` showed no further quality gain
  over `medium` for this workload — so `medium` was chosen over `high` on
  the actual evidence, not just conservatism. Re-verify if a harder question
  class shows up later.
- **`maxToolRounds`: 3 → 4**, **`maxRecordsPerTool`: 12 → 15**,
  **`maxTotalRecords`: 40 → 60** — modest bumps, cheap since tool rounds run
  at `reasoning_effort: "none"`; reduces silent truncation on rich
  multi-module questions.
- **`providerTimeoutMs`: 30s → 45s** — more headroom for the `medium`-effort
  final round, still comfortably under the Vercel Hobby-plan `maxDuration =
  60` ceiling on `app/api/whatsapp/webhook/route.ts` even with tool-round
  overhead on top (confirmed via a real end-to-end multi-round question:
  5.9s total).
- **Left unchanged, deliberately**: `maxAnswerTokens` (500 — already
  generous relative to the 700-char WhatsApp reply cap, not a binding
  constraint) and `verbosity: "low"` (a WhatsApp-terseness UX choice, not a
  cost cut — GPT-5-family `verbosity` controls output length/style, separate
  from `reasoning_effort`). `askRequestsPerWindow`/`requestWindowMs` (the
  per-user rate limit) also untouched — that's abuse prevention, not a
  quality/cost lever, and nothing indicated it was being hit.

**Real bug found and fixed along the way, unrelated to the tuning itself**:
the final WhatsApp reply's 700-character cap used a raw `.slice()`, which
could (and, in this same live testing, did) cut a word in half mid-sentence
("...still marked work-in-progress/product directio"). Replaced with
`truncateReply()` in `orchestrator.ts` — trims back to the last whitespace
within the limit before adding the truncation ellipsis, falling back to a
hard cut only for the pathological case of no whitespace at all.

Verified: `pnpm verify:fast` green throughout (two `orchestrator.test.ts`
assertions updated for the new truncation behavior — one was asserting the
literal `.length === 700` of the old raw-slice bug, replaced with a
word-boundary-aware check plus a new pathological-no-space case).

Implementation only, not pushed/deployed as of this writing.

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
document the Courtney's actual knowledge source, retrieved properly instead
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
Courtney now retrieves that exact section verbatim when relevant, so it
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

The reading side of Courtney was rebuilt from a fixed-slice, single-shot
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

**Same-day follow-up fix**: Courtney was declining to share a Directory
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

**Directory search upgrade, same day**: user asked for Courtney to be
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
2. **Stronger model, one conservative reasoning step up.** Courtney Roberts now
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

Run these against the live registered number after deploying this change, from
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

**Personalization / onboarding** (2026-08-14 — these need a *fresh* sender to
see the first-contact path; the live number may already have been introduced, so
clear its `onboarding` field on `/whatsappConversations/{sha256(phone)}` first,
or use a second recognized number)
21. Send just "Hi" as the very first message (should get the personalized card: recognized name/role, what it can see, 3 example questions naming real jobs/projects).
22. Send a real question as the very first message instead (should get the answer, with one short context line above it — not a tutorial).
23. Send several more ordinary questions (should get **no** introduction on any of them).
24. "What do you know about me?" (name, role, jobs, companies — and an explicit statement of anything not on file).
25. "What should I check today?" (open clock / draft reports / active Outlooks first, then the rest).
26. "What can you do?" and "What can I ask you about my work?" (must name that person's real jobs/projects, never a generic feature list).
27. From a recognized number with a thin/empty SVC record (e.g. a contact with no linked app account): "what's my role?" (must say it isn't on file, and must not invent one).

## Current outcome

Courtney Roberts is live through the direct **Meta WhatsApp Cloud API**
integration using SVC's registered U.S. number.

The live route is:

```text
https://communication-svc.vercel.app/api/whatsapp/webhook
```

The current flow supports an identified SVC user sending text to the registered
number, receiving a Courtney Roberts reply, reading limited internal data when
authorized, and creating a **ByeByeDPR Daily Report draft** only after explicit
confirmation. The user interface and all user-facing replies are in English.

The latest production deployment is
`dpl_AZEUF2aGz1ST54oy5sLpNWCC6NZU`, aliased to the URL above. It includes the
WhatsApp response UX improvements; production smoke checks returned `/` → 200,
an SVC module deep link → 200, and webhook `GET` without verification data →
403 as expected.

## What was configured outside the repository

### Meta / WhatsApp Cloud API

- A Meta Developer App for **Courtney Roberts** exists and has the WhatsApp
  product configured.
- An SVC-managed U.S. phone number is registered and connected in WhatsApp
  Manager.
- The Meta callback is the live webhook URL above, and the WhatsApp Business
  Account is subscribed to the `messages` webhook field.
- The access token was replaced with a Meta Business **System User** token with
  the minimal WhatsApp Cloud API permissions required by the server. Do not
  paste that token into source, docs, commits, chat, or browser URLs.

Production identifiers are held in Vercel environment variables and WhatsApp
Manager. Do not copy dynamic IDs into this handoff.

### Vercel environment

Production environment variables have been configured in Vercel. Their values
are secrets and must be managed in Vercel rather than committed to this repo.

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | Meta callback verification; must match the dashboard value. |
| `WHATSAPP_ACCESS_TOKEN` | Long-lived System User token used for Graph API calls. |
| `WHATSAPP_PHONE_NUMBER_ID` | Registered production phone-number ID used for Graph API sends and webhook filtering. |
| `WHATSAPP_WABA_ID` | Filters inbound webhook events to SVC’s WABA. |
| `WHATSAPP_APP_SECRET` | Validates `x-hub-signature-256` on every inbound POST. |
| `WHATSAPP_TEST_RECIPIENT` | Removed from Production; production replies go to the real inbound sender. |
| `NEXT_PUBLIC_WHATSAPP_SECRETARY_NUMBER` | Courtney Roberts' public dialable number, digits only; powers the "Message Courtney" `wa.me` link in Profile. It is intentionally client-facing. |
| `OPENAI_API_KEY` | Used by Courtney Roberts and existing ByeByeDPR transcription/structuring services. |
| `WHATSAPP_AI_MODEL` | Optional Courtney Roberts chat-model override; default is `gpt-5.6-terra`. |
| `BYEBYEDPR_AI_MODE` | `live` enables live parsing/transcription when `OPENAI_API_KEY` is available. |
| `BYEBYEDPR_AI_TRANSCRIBE_MODEL` | Optional override; default is `gpt-4o-mini-transcribe`. |
| `BYEBYEDPR_AI_PARSE_MODEL` | Optional structured Daily Report parsing-model override. |
| Firebase Admin credentials | Required by the webhook’s server-side Firestore reads/writes. |

Do not document or print the recipient’s phone number, secrets, or service
account contents. `service-account.json` is local-only and must remain ignored.

## Runtime architecture

```text
Meta registered U.S. number
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
| Identity | `lib/whatsapp-svc-identity.ts`, `lib/whatsapp-identity-claim.ts`, `lib/phone-normalization.ts` | Three-tier resolution (2026-08-18): `whatsapp-link` (`/users.whatsappPhoneNormalized`, `/contacts.whatsappPhoneNormalized`) → `registered-phone` (`/users.phoneNormalized`) → `directory-phone` (`/contacts.phoneNormalized`); a weaker tier is consulted only if every stronger one is empty, and each resolves a unique real identity (one linked account beats any number of unlinked duplicates). A `/users`-only match then adopts its single `linkedUserId` contact so Directory context resolves. Ambiguous → a blocking "what's your SVC email" claim; not found → the public answer plus a non-blocking enrollment offer. Both link `whatsappPhoneNormalized`, i.e. the top tier, so a claim always settles the next message. See the 2026-08-18 section above. |
| Authorization | `lib/whatsapp-access-policy.ts` | Central backend policy; public vs internal and a stricter linked-user check for draft creation. |
| Orchestrator / model | `lib/whatsapp-secretary/orchestrator.ts` | Tool-calling loop on `gpt-5.6-terra` by default (`runToolConversation`); the model chooses which tools to call, across modules, across up to `maxToolRounds` rounds, before answering. Must not invent unavailable SVC data. |
| Tool registry | `lib/whatsapp-secretary/tool-registry.ts` | Generic `SecretaryTool` contract + per-sender access-policy-filtered registry; `assertOnlyAllowedMessagesTools` still structurally blocks any *unreviewed* Messages/Communications-shaped tool name — only the two real `messages_*` tools below are allowlisted (see the 2026-08-14 section above). |
| Company knowledge | `lib/knowledge-pack.ts` (parsing/scoring), `lib/company-knowledge.ts` (prefetch) | Scored retrieval over two files as one pool: `SVC_AI_Secretary_Canonical_Knowledge_Pack.md` (product/module) and `SVC_Company_Mission_Operating_Framework_Knowledge.md` (company/mission, added 2026-08-14; chunk ids prefixed `mission-`). A small prefetch (3 chunks) is folded into the system prompt outside the tool loop; `knowledge_search`/`knowledge_getSection` (below) let the model go deeper. |
| Self-context / onboarding | `lib/whatsapp-secretary/self-context.ts`, `tools/me.ts`, `onboarding.ts` | One bounded "what SVC knows about the sender" snapshot (index-free or on already-deployed indexes), the three zero-argument `me_*` tools built on it, and the capability-signature-driven introduction. Personalization over already-permitted reads — no new scope. |
| Internal read tools | `lib/whatsapp-secretary/tools/{directory,quest-coral,applications,reports,clocking,outlooks,knowledge,messages,me}.ts` | Bounded, read-only, model-invoked tools with real date-range/cursor pagination where the module supports it; never send whole collections to a model. `knowledge` is stable Company Knowledge, not live SVC data — gated by `companyKnowledgeScope`, not a `canRead*` flag. `messages` is the Communications read layer (2026-08-14) — see above; unlike every other module it is further actor-scoped for its human-message tool. |
| Usage guard | `lib/whatsapp-secretary/usage-guard.ts` | Per-identified-sender rolling rate limit over `whatsappSecretaryAiUsage` (mirrors `directoryAiUsage`). |
| First write action | `lib/whatsapp-daily-report-drafts.ts` | Preview / confirm / cancel flow, using the established ByeByeDPR `/reports` document shape. Unchanged by the read-orchestrator work. |

## Access-control boundary

The access policy is enforced in the backend/tool layer, not merely in the AI
prompt.

- An unknown WhatsApp number (no identity match at all) receives only public
  company knowledge. It cannot query Directory, people, companies, jobs,
  contexts, Quest Coral, Applications, Reports, or other internal data — but
  since 2026-08-18 it is also *offered a way in*: the public answer carries an
  invitation to reply with an SVC email address, which links the number and
  grants internal access from then on (once per 24h, never replacing the
  answer).
- A GENUINELY AMBIGUOUS number (2+ real SVC identities could own it) is
  NOT treated as unknown: Courtney asks for the sender's SVC email and,
  on an exact single match, links the number and grants internal access from
  then on.
- ⚠️ Both of the above are identity *claiming* (a bare-text email reply), not
  cryptographic verification. Since the unrecognized path opened, knowing any
  SVC email address is sufficient to obtain internal read access from any
  phone, with no attempt cap. Read the "Security debt" note in the 2026-08-18
  section before widening this further or exposing the number publicly.
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
gets Meta’s native read receipt and typing state before Courtney performs
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
- If a resolved SVC user has no prior conversation history, Courtney
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
row, and confirm Courtney follows the selection and a relevant CTA opens
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
- **My SVC context (`me_*`):** who the sender is recognized as, their own
  linked jobs/companies/projects/reports/clock/Outlooks/Applications record,
  and a capability guide with example questions built from those same real
  records. Zero-argument tools, actor resolved server-side — see the
  "Self-awareness, onboarding, and personalized discovery" section above.

No WhatsApp capability has access to `/messages` or may write to Messages —
enforced structurally in `lib/whatsapp-secretary/tool-registry.ts`, not just
by prompt instruction.

## Testing and verification completed

The following pass for the current Courtney Roberts implementation:

```bash
pnpm test:whatsapp-secretary
pnpm typecheck
pnpm build
```

The focused suite has 350 passing tests (up from an original 87). It covers
strict Daily Report command recognition and idempotency, authorization
boundaries, the tool registry, native list/CTA payloads, native selection
parsing, concise response presentation, first-contact welcome behavior,
per-module entity resolution (including both keyword fallbacks and the
Directory-first job resolver), cross-job tools, phone normalization, the
two-tier identity resolver's unique-real-identity logic (including Joe
Haddad's exact duplicate-contact scenario), and the identity-claim flow. See
"Read layer strengthening" above for the manual WhatsApp checklist to run
against the live number after deploy, and the 2026-08-16 section for what
still needs a real live-WhatsApp run (the ambiguous-identity claim flow).

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
- Do not add templates, billing work, campaigns, or Messages access without
  explicit approval. Firebase live writes from the webhook, beyond the
  approved Daily Report draft action, are now also approved and shipped
  (2026-08-16): `backfillUserPhoneFromInboundWhatsApp()` (self-heal
  `/users.phone`) and the identity-claim flow's `linkWhatsAppNumberToUser()`
  (`/users.whatsappPhoneNormalized`) — both narrow, idempotent, and
  documented in the 2026-08-16 section above. Any FURTHER live write beyond
  these three still needs explicit approval before shipping.
- Keep all prompts, entity extraction, commands, logs intended for product use,
  and user-facing responses in English.
- Preserve the current webhook callback URL and Meta sandbox configuration when
  extending the code.
- Never hard-code access tokens, verify tokens, app secrets, OpenAI keys,
  service-account values, or personal phone numbers.
- New internal capabilities must enforce authorization in the data/tool path,
  not only in an AI system prompt.
- **Before adding a tool, check whether an existing one should gain an
  optional parameter instead.** The catalog is already at 37 and the review
  above found several tools that are one function with a different constant
  baked in. A new entry in the model's menu is a real cost: selection accuracy
  degrades silently, never with an error. If a new tool's description would
  need to spend most of its length explaining that it is *not* its sibling,
  that is the signal it should be a parameter. See
  [the architecture review](./svc-whatsapp-secretary-tool-architecture-review.md).
- Use narrow Firestore queries and concise model context. Do not ship whole
  collections or raw internal data to OpenAI.
- For any new write action, retain preview + explicit confirmation + server-side
  transactional idempotency as the baseline pattern.

## Related documentation

- [Tool/orchestrator architecture review](./svc-whatsapp-secretary-tool-architecture-review.md) — 2026-08-14 assessment of the tool catalog and the 37 → 22 consolidation plan. Read this before adding a new tool.
- [Courtney Roberts Canonical Knowledge Pack](../SVC_AI_Secretary_Canonical_Knowledge_Pack.md) — the Company Knowledge source `lib/knowledge-pack.ts` parses and retrieves from.
- [ByeByeDPR product context](./svc-bye-bye-dpr-product-context.md)
- [ByeByeDPR module context](./svc-bye-bye-dpr-module.md)
- [SVC project context for AI agents](./svc-project-context-for-ai-agents.md)
- [Applications product context](./svc-applications-product-context.md)
- [Quest Coral product context](./svc-quest-coral-product-context.md)
