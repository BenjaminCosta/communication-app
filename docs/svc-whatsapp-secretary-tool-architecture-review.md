# SVC AI Secretary — tool/orchestrator architecture review

_Reviewed 2026-08-14 against `lib/whatsapp-secretary/` at commit `7a04dfc`._
_Scope: orchestrator, tool registry, all nine module tool files, Knowledge,
Live Data, memory, access control, and tool-calling structure._

> **Status: fully implemented.** Steps 1–5 landed 2026-08-14 (catalog **37 →
> 23**, shared entity resolver, cross-module dossier, `truncated`/`totalMatched`);
> steps 6 (write framework) and 7 (cross-turn memory) landed 2026-08-15 in their
> own pass, as sequenced. See "Implementation status" at the end for what
> shipped and what the live evals caught.

Published reference copy (same content, better formatted for scanning):
<https://claude.ai/code/artifact/1d6c6a83-8459-4dd4-8713-48233c1323e8>

## Verdict

The orchestrator loop is the right shape and the access model is genuinely
well built. What does not scale is the **tool catalog**: growth has been one
tool per question shape, which is _modules × shapes_, and it degrades
**silently** — a wrong tool choice produces a plausible but wrong answer, not
an error.

- **Tools exposed to an identified internal sender today: 37.**
- **Proposed after consolidation: 22**, with *more* capability (optional
  filters, cursors and drill-down where split tools had fixed slices).

Current per-module counts: Directory 13, Quest Coral 5, Applications 4,
Reports 4, Clocking 2, Outlooks 2, Knowledge 2, Messages 2, Me 3.

## What is already right — do not regress these

1. **Permissions by non-registration.** `buildToolRegistry(accessPolicy,
   factories)` means a tool the sender may not use is *never advertised to the
   model*, so there is no prompt-level "please don't" to jailbreak. Plus
   `assertOnlyAllowedMessagesTools` as defense in depth.
2. **Actor closed over server-side.** `messages` and `me` take the requesting
   sender from the resolved access policy, never from model input, via a
   per-request factory override in `orchestrator.ts`. The `me_*` tools take
   zero arguments at all, so there is structurally no way to point them at
   another person.
3. **Zod validation of model output** in every tool, with `runSecretaryTool`
   returning a *structured error* for unknown names/bad arguments rather than
   throwing — the model can recover mid-turn.
4. **The `presentation` channel.** Stripped from the tool JSON sent to OpenAI
   (`dispatchToolCalls`), so deep links, CTAs and file attachments stay
   deterministic because the model never holds a URL. Load-bearing for safety.
5. **Provider seams per module** (`ReportsToolsProvider`,
   `MessagesToolsProvider`, `SelfContextProvider`, `DirectoryDataProvider`, …)
   — what makes 254 offline tests possible with no Firestore.
6. **Deterministic-first.** All retrieval and business logic is code; AI does
   orchestration and final synthesis only.

## Findings

### F1 — Several tools are one function with a different constant (consolidate)

- `directory_searchPeople`/`searchCompanies`/`searchJobs` are literally
  `searchTool(name, scope, label)` called three times
  (`features/directory/ai/server/tools/definitions.ts`). That is a `type`
  parameter, not three tools.
- `findSharedContacts`/`findSharedJobs` — same, one `type` parameter.
- `questCoral_listAllProjects` vs `questCoral_searchProjects`, and
  `applications_listAllApplications` vs `applications_searchCandidates` — one
  optional `query` apart.
- `reports_getRecentDailyReports` vs `reports_searchDailyReportsForJob` — the
  same query, one with a job filter.

**The relationship trio hides a real latent bug.** `getCompanyRelationships`/
`getJobRelationships`/`getPersonRelationships` are `relationshipTool(name,
label, pick)` three times, but the entity type is **already encoded in the
`directoryId`** (`person__abc`). The model is being asked to choose a tool
from information the argument already carries — and calling
`getPersonRelationships` with a company id returns whatever `pick` pulls off
the wrong relation shape, with no error.

### F2 — Entity resolution is duplicated six times and can disagree (correctness)

Six independent implementations of "name → entity":

| Site | Mechanism |
| --- | --- |
| `tools/job-fanout.ts` | `resolveJobByNameViaDirectory` |
| `tools/outlooks.ts`, `tools/messages.ts` | bare `directoryProvider.findByName` |
| `tools/quest-coral.ts` | `createHybridQuestCoralProvider` (in-memory rerank) |
| `tools/applications.ts` | `createHybridApplicationsProvider` (in-memory rerank) |
| `tools/reports.ts` | `resolveAuthorIdByName` |
| `tools/messages.ts` | `resolveTag` |

…using **two different reranking implementations** (`rerankKeywordMatches` in
`tools/directory.ts` vs `rerankByTokenScore` in `tools/keyword-match.ts`).

Every tool takes `jobName: string` and resolves again on every call. A
cross-module question about one job therefore resolves the same name three
times (three extra Firestore round-trips) **and the three resolvers can land
on different jobs**, silently blending two records into one answer.

### F3 — The shared budget truncates silently and the model is never told (correctness)

`SecretaryToolResult` is `{summary, data?, presentation?, empty?}` — there is
no `truncated` and no `totalMatched`. `takeRecords` clips to
`min(maxRecordsPerTool, remainingRecords)` with no marker.

So the standing prompt guardrail — *"never say something is missing just
because it wasn't in a bounded result"* — is **impossible for the model to
honor**: it cannot distinguish "this is everything" from "this is what fit in
the budget". And because `dispatchToolCalls` runs a round's calls under
`Promise.all`, the decrement order across parallel calls is nondeterministic,
so *which* tool gets starved varies per run.

### F4 — There is no generic cross-module dossier (missing capability)

"What's going on with North Ridge?" today means five tool calls (outlook +
reports + clocking + operational messages + applications), each re-resolving
the name, inside `maxToolRounds: 4` and `maxTotalRecords: 60`.

`me_getMySvcContext` already proves the pattern works — one call,
cross-module, bounded per section, with an explicit `gaps` list — but **it
only exists for "me"**. The generic form is the single highest-leverage
addition available.

### F5 — Descriptions carry disambiguation that should be structural (scaling)

`directory_getActiveUsers`'s description spends most of its length explaining
that it is *not* `directory_listRegisteredUsers` and *not* clock-in status.
`clocking_getClockHistoryForJob` points at `getMostActiveJobs`;
`outlooks_getOutlookForJob` points at `listActiveOutlooks`.

When a description exists mainly to distinguish itself from a sibling, the two
should be one tool with a parameter. This works at 37 tools and becomes an N²
disambiguation problem at 70.

### F6 — Write actions have no framework (architecture)

`handleWhatsAppDailyReportDraftAction` runs **before** the orchestrator in
`app/api/whatsapp/webhook/route.ts`, matches exact commands by regex, and sits
entirely outside the tool system. Its safety properties (preview → explicit
`CONFIRM DRAFT` → transactional idempotency) are correct and must be kept.

But it is not a *pattern*: each new write is another branch in the webhook,
another command string, another bespoke state document — and the model cannot
compose a write with a read.

### F7 — Memory is transcript-only (architecture)

`lib/whatsapp-conversation-memory.ts` keeps 12 messages at 2,000 characters.
**Tool results are never persisted** — only the final assistant text — so a
follow-up cannot reuse the prior turn's structured data and must re-call tools
and re-spend budget. `nextCursor` values live only in the model's context
window; once the 12-message window rolls, pagination state is gone. No
cross-session recall and no durable per-user facts.

### F8 — Hard round ceiling with no feedback (scaling)

`runToolConversation` loops `round <= maxToolRounds` and withholds tools on the
final round, so the model gets 4 tool-bearing rounds plus 1 forced answer. A
genuine drill-down chain (search → details → relationships → reports →
synthesize) consumes all of it, and when it runs out the model answers from
partial data with **no signal that it was cut short**.

### F9 — Smaller friction worth queuing

- `directory_getEntityDetails` requires a raw `directoryId` obtainable only
  from a prior search result, so every detail lookup costs two rounds. A
  `{name, type}` overload would halve that.
- `SecretaryToolBudget.maxNotesPerTool`/`maxNoteChars` are Directory-specific
  fields living in the *shared* budget type — a leaked abstraction that will
  look odd at the twelfth module.
- `logWhatsAppSecretaryAi` records tool names and counts but no durations; as
  the catalog grows you will want to know the p95 tool.
- The 700-character reply cap truncates (`truncateReply`) rather than
  summarizing or offering a "reply MORE" affordance.

## Proposed consolidation: 37 → 22

| Module | Now | After | Shape |
| --- | ---: | ---: | --- |
| Directory | 13 | **5** | `search({query, type?})` · `getEntity({ref, include:[details,relationships,notes]})` · `findConnection({from, to, mode})` · `searchNotes` · `listUsers({presence})` |
| Quest Coral | 5 | **3** | `searchProjects({query?, status?})` absorbs list-all · `getProject({ref, include:[context,updates]})` · `listActivity` |
| Applications | 4 | **2** | `search({query?, status?, jobRef?, since?, until?})` absorbs three · `getReviewQueue` (a genuine aggregate, stays) |
| Reports | 4 | **2** | `search({jobRef?, authorRef?, status?, since?, until?, cursor})` absorbs three · `getCoverageGaps` |
| Outlooks | 2 | **1** | `get({jobRef?})` — omitting `jobRef` *is* the cross-job listing |
| Clocking | 2 | 2 | History and activity ranking are genuinely different questions |
| Messages | 2 | 2 | **Deliberately untouched** — see note below |
| Knowledge | 2 | 2 | Search-then-drill is already the right shape |
| Me | 3 | **2** | `getMyContext({include})` · `getSecretaryGuide` |
| Cross-module | 0 | **+1** | `svc_getEntityDossier({ref, sections?, since?})` |
| **Total** | **37** | **22** | −40% entries, wider filters |

**Why Messages is the deliberate exception**: the split between
`messages_searchOperationalHistory` and `messages_searchMyCommunications` *is*
the privacy model. Collapsing them behind a `scope` parameter would invite the
model to believe the scope is something it can widen. Two tools is the feature
here, not the debt.

## Target architecture, in layers

**Layer 0 — a shared entity resolver.** One service:
`resolve(query, {type})` → `{status: "found" | "ambiguous" | "not-found",
entity: {ref, name, type, sourceIds: {directoryId, byeByeDprJobId, contextId,
questCoralProjectId}}, candidates}`, cached per request. Modules stop
resolving on their own; ambiguity is handled once, with the native WhatsApp
list UX that already exists. Fixes F2 and unblocks everything below.

**Layer 1 — consolidate the catalog** per the table above, module by module.

**Layer 2 — extend the result contract.** Add `truncated` and `totalMatched`
so bounded slices are machine-visible rather than a prompt rule (fixes F3);
standardize `nextCursor` (currently ad-hoc per tool); return
`refs: EntityRef[]` so the model passes resolved handles to the next tool
instead of re-resolving by name.

**Layer 3 — writes as tools.** Extend `SecretaryTool` with
`kind: "read" | "write"` plus `preview(args)` and `commit(args,
idempotencyKey)`. The orchestrator only ever calls `preview`; commit stays on
the deterministic confirmation path. Same guarantees as the Daily Report flow,
now reusable and composable with reads.

**Layer 4 — memory worth the name.** Persist tool executions (names, compact
results, cursors) beside the transcript so follow-ups reuse instead of
re-fetching. Add a durable per-user fact store, written deterministically,
never by the model.

**Layer 5 — specialized AI only where it earns it.** Transcription (already
present), semantic note retrieval (the `searchNotesSemantic` seam exists in
`DirectoryDataProvider` and is deliberately unimplemented), long-document
summarization — always as a **tool returning data**, never as a sub-agent that
chooses tools.

## Order of work

Each step unblocks the next; this is a real sequence, not a priority list.

1. **Entity resolver + `refs` in tool results** — fixes a live correctness
   risk and is a prerequisite for the rest.
2. **`svc_getEntityDossier`** — largest cross-module accuracy/latency win; the
   pattern is already proven by `me_getMySvcContext`.
3. **Directory 13 → 5** — largest catalog win, zero capability loss, and it
   removes the wrong-type relationship bug in F1.
4. **`truncated` / `totalMatched`** — makes the bounded-slice guardrail
   verifiable instead of aspirational.
5. **Search consolidation in Quest Coral, Applications, Reports** — mechanical
   once 1 and 4 are in place.
6. **Write framework** — worth doing only after reads are consolidated, so
   writes inherit a clean contract.
7. **Memory upgrade** — the thing that eventually blocks "much more capable
   company AI".

## What not to do

- **Do not put an LLM router/classifier in front of the tool loop.** Extra
  latency and another failure mode; at ~20 tools the model selects well on its
  own. Tiering the catalog (a small always-on core plus a
  `svc_discoverTools({topic})` meta-tool) is the escape hatch if consolidation
  ever stops being enough — not a first move.
- **Do not split the Secretary into per-module sub-agents.** That trades a
  solved routing problem for AI-to-AI chains, and cross-module questions get
  worse, not better. The Secretary stays the single orchestrator.
- **Do not move Company Knowledge to embeddings.** The corpus is small and a
  WhatsApp reply must stay fast; lexical scoring is the correct call, as
  already documented in the knowledge-pack section of the handoff.
- **Do not touch the `presentation` channel.** It is what keeps every URL,
  deep link and attachment out of model context.

## Main risk when executing this

Renaming tools invalidates prompt references and tests, and a merged tool with
a less sharp description can **regress selection accuracy** — which fails
silently. Move one module at a time, and gate each on the live-eval harness
(real model + fixture providers) that already exists in this repo, the same
approach that confirmed all seven personalization phrasings routed to the
intended tool on 2026-08-14.

## Implementation status (2026-08-14)

### Landed — steps 1 through 5

| Step | What shipped |
| --- | --- |
| 1 | `lib/whatsapp-secretary/entity-resolver.ts` + `tools/entity-lookups.ts`. One resolution per name per request, one entity carrying every id (`contextId` *and* `byeByeDprJobId` together), opaque per-request `ref` handles the model passes between tools. The six duplicated resolution sites now all route through it. |
| 2 | `svc_getEntityDossier` (`tools/svc.ts` + `tools/dossier-sources.ts`). Each section gated by its own module's access flag **before any query runs**, each source failing independently, and `emptySections` vs `unavailableSections` reported separately so "nothing on file" and "this record can't have that" never read alike. |
| 3 | Directory **13 → 5**: `search({query,type?})`, `getEntity({ref\|name,include})`, `findConnection({from,to,mode})`, `searchNotes`, `listUsers({presence})`. The latent wrong-type relationship bug is gone — `getEntity` picks the underlying relationship view from the *resolved* entity's real type, so a mismatch is now impossible rather than silent. |
| 4 | `truncated` / `totalMatched` / `nextCursor` on `SecretaryToolResult`, plus shared `allowedPageSize()` / `spendBudget()` helpers. The bounded-slice guardrail is machine-checkable instead of aspirational. |
| 5 | Quest Coral 5 → 3, Applications 4 → 2, Reports 4 → 2, Outlooks 2 → 1. Messages stayed at 2 deliberately (the privacy split is the model). Clocking stayed at 2 (two genuinely different questions). |

**Also landed, not in the original plan**: `SecretaryToolContext` — one
per-request object (`resolver`, `identity`, `actorUserId`, `enabledModules`)
passed to every factory. This removed the two bespoke per-request factory
overrides the review had flagged as an asymmetry, and is the seam any future
context-needing module uses.

**Final catalog: 23 tools** (directory 5, questCoral 3, applications 2, reports
2, clocking 2, outlooks 1, knowledge 2, messages 2, me 3, svc 1). One more than
the 22 projected, because `me` was left at three tools rather than folded to
two — its three tools answer genuinely different questions and none of them
takes an argument, so there was nothing to merge.

### What the live eval caught

The review named the main execution risk as "a merged tool with a less sharp
description can regress selection accuracy — which fails silently", and
prescribed gating on the live-eval harness. That gate earned its keep: a
16-question run against the real model scored **10/16 on the first pass**.

The root cause was not a tool description. It was a **real pre-existing bug in
the presentation layer**, exposed by the consolidation: any search returning
more than one record was rendered as a native disambiguation list. That
conflated "a search found ten matches, here is the data for my next step" with
"I cannot proceed until you pick one". Because the merged `directory_search`
spans people, companies and jobs when no `type` is given, it returns more rows
than the old typed searches did — so a broad question like "what's going on
with North Ridge?" had the model run one exploratory search and the user got
"I found 10 possible records. Select the right one" instead of an answer.

Fixed by keying the disambiguation list **only** on the resolver's explicit
`data.candidates` shape, which is now the one and only way ambiguity is
reported. Re-run: **16/16**, and faster — the broad-summary questions dropped
from ~4.5s (wrong) to ~3.0s (one dossier call). A regression test guards it.

A prompt paragraph was also added: pass a job name straight to the module tool
that needs it rather than pre-resolving it in Directory, since every tool now
resolves names itself.

### Landed — steps 6 and 7 (2026-08-15, separate pass)

Deliberately not bundled with the catalog rename: bundling would have defeated
the very gate that caught the disambiguation bug, since a regression could not
then be attributed to one change or the other.

**Step 6 — writes as tools.** `SecretaryTool` gained `kind: "read" | "write"`
and `commit()`. A write tool's `run()` is a **pure preview** that mutates
nothing; it returns a `presentation.pendingWrite` envelope
(`lib/whatsapp-secretary/pending-writes.ts`) which the deterministic layer
persists on the conversation document. Only `commit()`, reached from an
exact-phrase confirmation matched **before the model runs**, writes anything.
`assertWriteToolContract` makes the shape structural: a write tool without a
`commit`, or a read tool with one, fails at registry build.

The Daily Report draft became the first write tool
(`tools/report-writes.ts`) — and **none of its safety properties moved**:
`commit()` delegates to the existing, unmodified store transaction, keyed by
the same `sha256(sender)` document and the same deterministic
`actionKey`/`reportId`, so the `/reports` document written is byte-identical
and a repeat confirmation still returns "already created". Two properties were
*added*: the envelope carries the **resolved job**, so a confirmation writes
against the job that was previewed rather than whatever a name would
re-resolve to hours later; and a preview expires after 24h rather than staying
confirmable forever. A narrow fallback keeps any in-flight legacy preview
confirmable, and can be deleted once none can plausibly remain.

What this buys, beyond tidiness: the model can now **compose** a write with a
read in one turn — verified live, `reports_search` then
`reports_createDailyReportDraft` — which the pre-orchestrator regex path was
structurally incapable of.

**Step 7 — cross-turn memory.** The resolver gained `hydrate()`/`minted()`, and
the conversation document now carries `resolvedEntities` and a compact
`retrievals` digest. So a ref minted last turn still resolves this turn **with
no lookup at all**, re-asking by name reuses the same entity, and the prompt
carries prior refs and `nextCursor` values forward so a follow-up pages instead
of restarting. Ref minting continues past rehydrated handles, so a new entity
can never collide with a carried one.

**Live eval of the write path** (real model, fixture providers, a spy store
that fails loudly if a preview writes) — all five checks passed first time:
the draft tool was selected and produced a preview with **no store write at
all**; the model did not falsely claim creation; read+write composed in one
turn; "yes" / "go ahead" / "confirm it" all failed to confirm while only the
exact phrase reached commit; and turn two reused turn one's ref without
re-resolving. The `truncated` flag was visibly working end-to-end too — the
model volunteered "More reports may exist beyond this result."

One cosmetic bug the eval caught: the confirmation contract was printed twice,
because the Daily Report's own preview text already ends with it.
`formatPendingWriteReply` now appends only when the tool's preview hasn't
already stated it.

Tests 276 → 299. `pnpm verify:fast` and `pnpm build` green.

**Final catalog: 24 tools** — 23 reads plus the one write.

## Related documentation

- [WhatsApp AI Secretary handoff](./svc-whatsapp-ai-secretary-handoff.md) — the operational handoff this review evaluates.
- [SVC AI Secretary Canonical Knowledge Pack](../SVC_AI_Secretary_Canonical_Knowledge_Pack.md) — §13 describes the Secretary's own capabilities.
- [SVC project context for AI agents](./svc-project-context-for-ai-agents.md)
