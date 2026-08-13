# SVC AI Secretary — WhatsApp handoff

_Last updated: 2026-08-12. This is the operational handoff for continuing the
WhatsApp AI Secretary work. Treat the current code, Vercel configuration, and
Firebase data as the authority if they differ from this document._

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
  (clock-in/out history, never exposes raw GPS coordinates) and `outlooks.ts`
  (per-job 3-Week Outlook reads only — cross-job listing needs a new
  Firestore index, deliberately deferred).
- Messages/Communications access is structurally impossible, not just
  prompt-denied: no tool file imports anything Messages-related, and
  `lib/whatsapp-secretary/tool-registry.ts` asserts no tool name can ever
  match `/message|comms?/i` before the tool list reaches OpenAI.
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
- Outlooks cross-job/portfolio listing (needs a new `collectionGroup`
  composite index + explicit deploy approval).
- Any new write capability, or any Messages/Communications access.
- Per-role/per-worker granular permissions — access stays binary
  public/internal.

See `lib/whatsapp-secretary/` for the implementation and
`scripts/whatsapp-secretary-*.test.ts` (run via `pnpm test:whatsapp-secretary`,
now part of `pnpm verify:fast`) for the offline test suite.

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
| Tool registry | `lib/whatsapp-secretary/tool-registry.ts` | Generic `SecretaryTool` contract + per-sender access-policy-filtered registry; structurally blocks any Messages/Communications tool name. |
| Company knowledge | `lib/company-knowledge.ts` | Curated, scoped Firebase knowledge retrieval (unchanged, folded into the system prompt outside the tool loop). |
| Internal read tools | `lib/whatsapp-secretary/tools/{directory,quest-coral,applications,reports,clocking,outlooks}.ts` | Bounded, read-only, model-invoked tools with real date-range/cursor pagination where the module supports it; never send whole collections to a model. |
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

- **Company Knowledge:** curated entries about SVC, apps, processes, onboarding,
  and FAQs. Public users receive only public entries. (Not a tool — folded
  into the prompt directly, unchanged.)
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
  date-range/cursor pagination; raw report text, audio, attachments, storage
  links, and Communications Messages stay out of the model context.
- **ByeByeDPR clocking:** per-job clock-in/out history — never exposes raw GPS
  coordinates, only whether a location was recorded.
- **3-Week Outlooks:** per-job outlook reads only (tasks, dates, status); no
  cross-job listing yet (needs a new Firestore index, deferred).

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

The focused suite has 62 passing tests. It covers strict Daily Report command
recognition and idempotency, authorization boundaries, the tool registry,
native list/CTA payloads, native selection parsing, concise response
presentation, and first-contact welcome behavior.

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

- [ByeByeDPR product context](./svc-bye-bye-dpr-product-context.md)
- [ByeByeDPR module context](./svc-bye-bye-dpr-module.md)
- [SVC project context for AI agents](./svc-project-context-for-ai-agents.md)
- [Applications product context](./svc-applications-product-context.md)
- [Quest Coral product context](./svc-quest-coral-product-context.md)
