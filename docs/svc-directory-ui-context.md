# SVC Directory — UI Build Context

> Handoff/context doc to start building the **SVC Directory UI**. The data
> architecture, sync, hardening, helpers and scripts are all done, tested and
> deployed. This file is the single place to read before maquetar la UI.
>
> Last updated: 2026-07-13 · schemaVersion **4** · last verified production
> index count: **7,818**. The current performance architecture and rollout are
> documented in `docs/svc-directory-performance-optimization.md`.

---

## 0. TL;DR

- The Directory is a **read-only derived layer** over `/contacts` + `/contexts`.
- Search/browse from the 32 compact **`/directorySearchShards`** docs; read
  **`/directoryIndex`** plus its source document for profile detail. The index
  remains the fallback during rollout.
- **Never write to `/directoryIndex`.** Every edit writes to `/contacts` or `/contexts`; Cloud Functions re-derive the index automatically (~3–6s).
- Use the ready-made conflict-safe helpers in **`lib/directory-writes.ts`**.
- Contacts are **global-only**: any authenticated user sees every contact.
- Search: restore cached data immediately, revalidate the compact shard catalog,
  and build MiniSearch in a Web Worker. Communications shares the same catalog
  when its rollout flag is enabled.
- UI v1 is implemented: Home → mixed Results → read-only Detail, with per-user favorites/recents and a title-based Stream/Directory switcher.
- A follow-up polish pass (this session, **uncommitted** — see §13) restyled Results Google-style, made Home's scope pills toggle into a type-browse list, moved Favorites from a modal to a full screen, simplified both topbars, and deployed the `directoryFavorites`/`directoryRecents` Firestore rules to production. Read §13 before starting new work.

---

## 1. Non-negotiable principles

1. **Sources of truth**: `/contacts`, `/contexts` (and `/messages`). Never bypass them.
2. **`/directoryIndex` is derived + regenerable + client-read-only.** UI reads it; UI never writes it.
3. **All edits write to the source first** (`/contacts` / `/contexts`) → the sync functions update the index. Use `lib/directory-writes.ts`.
4. **Global by default**: no private-contact logic. All contacts visible to all authenticated users.
5. **Messages inside Directory**: reuse Communications' *existing* visibility/permission filtering. Never surface a message the user can't already see in the stream/search.
6. **Communications must keep working exactly the same.** The Directory is additive and isolated.

---

## 2. Data model

### Types
`DirectoryType = "person" | "company" | "job" | "other"`

- Contacts (and legacy Users) → `person`
- Company contexts → `company`
- Job contexts → `job`
- Anything else / manual notes → `other`

### Composite IDs
Every entry (and its `/directoryIndex` doc id) is `"{type}__{sourceId}"`:
`person__{contactId}`, `company__{contextId}`, `job__{contextId}`, `other__{contextId}`.
Helpers: `directoryId(type, sourceId)`, `parseDirectoryId(id)`, `contextCompositeIds(id)` — all from `lib/directory-core.ts`.

### `DirectoryIndexEntry` (shape of each `/directoryIndex` doc)

| Field | Type | Notes |
|---|---|---|
| `id` | string | composite id (= doc id) |
| `type` | DirectoryType | person / company / job / other |
| `sourceCollection` | "contacts" \| "contexts" | where the source lives |
| `sourceId` | string | original doc id |
| `ownerUserId` | string \| null | contact owner; preserves existing edit authorization |
| `name` | string | display name |
| `normalizedName` | string | accent-stripped, lowercased |
| `aliases` | string[] | email local-parts, prior company names, domains |
| `keywords` | string[] | deduped significant tokens |
| `searchText` | string | full lowercase haystack (fallback search) |
| `subtitle` | string \| null | e.g. `"Role @ Company"`, address, status |
| `email` | string \| null | primary email (person) |
| `phone` | string \| null | primary phone |
| `role` | string \| null | person role |
| `location` | string \| null | city/locale; jobs use the "Company" (location) field |
| `companyName` | string \| null | parent company display name (person or safely resolved job) |
| `companyEntityId` | string \| null | `company__…` when a safe master/source relation resolves |
| `linkedUserId` | string \| null | Firebase UID when the person registered |
| `status`, `tags`, `description`, `fieldCount` | compact UI fields | shared Directory/Communications projection |
| `sourceSheet` | string \| null | import provenance |
| `sourceRecordId` | string \| null | import provenance |
| `quality` | DirectoryQualityFlags | see below |
| `schemaVersion` | number | current = 4 |
| `sourceUpdatedAt` | Timestamp \| null | source doc updatedAt |
| `indexedAt` | Timestamp | when the entry was (re)built |
| `updatedAt` | Timestamp | back-compat alias of indexedAt |

`DirectoryQualityFlags`: `{ hasEmail, hasPhone, hasCompany, hasRole, hasLocation, isLinkedUser, isComplete, issues: string[] }`.
Use `quality.isComplete` / `quality.issues` to show "incomplete" badges or a data-quality filter.

### Compact shared projection — `EntityCatalogEntry` / `DirectorySearchDoc`
Per-entity catalog doc for MiniSearch and Communications selectors. It includes
source IDs/collection, display/search fields, primary contact points,
`linkedUserId`, `status`, tags, description, field count, and contact owner.
Build with `buildSearchDoc(entry)`. Index config is the shared const `DIRECTORY_MINISEARCH_CONFIG`:

```ts
{ idField: "id",
  fields: ["name","aliases","keywords","companyName","location","role"],
  storeFields: ["type","name","subtitle","companyName","location"],
  searchOptions: { boost: { name: 3, aliases: 2, companyName: 1.5 }, prefix: true, fuzzy: 0.2 } }
```

---

## 3. Firestore collections & rules (already deployed)

| Collection/doc | Client access | Purpose |
|---|---|---|
| `/directoryIndex/{compositeId}` | **read** (auth), no write | the derived entries |
| `/directorySearchShards/{00..31}` | **read** (auth), no write | compact catalog; deterministic hash distribution |
| `/directoryMeta/status` | **read** (auth), no write | index counts plus atomic search manifest/revision |
| `/directoryControl/importLock` | none (Admin only) | bulk-import suppression lock |
| `/contacts/{id}` | read (auth); write owner-scoped | source of truth (person) |
| `/contexts/{id}` | read (auth); write auth | source of truth (company/job/other) |

Rules live in `firestore.rules` (active) and `firestore.rules.secure`.

---

## 4. Reading data for the UI

Two complementary paths:

**A. List / detail (Firestore reads).** Query `/directoryIndex` directly.
- By type: `where("type","==","person"|"company"|"job"|"other")`.
- Paginate with `orderBy("normalizedName").limit(50)` + `startAfter(cursor)` — do NOT load all 7,632 at once (reuse the existing "Load 50 more" pattern from `components/people-screen.tsx`).
- Detail view: read the composite-id doc, then read the **source** doc (`/contacts/{sourceId}` or `/contexts/{sourceId}`) for full fields when editing.

**B. Global search (MiniSearch).** `loadEntityCatalog()` restores IndexedDB
immediately, reads the manifest plus 32 shards when the revision changes, and
atomically swaps the revalidated index. The previous index remains interactive
while updating. An incomplete shard set falls back to `/directoryIndex`.

> A ready-made compact payload can be generated any time:
> `… node scripts/generate-directory-index.mjs --dry-run --dump=directory-search.json`
> (7,632 docs, ~1.3 MB minified). Do not wire it into boot.

---

## 5. Writing / editing (when you get to editable UI)

**Golden rule:** write to `/contacts` or `/contexts`, never `/directoryIndex`. The sync functions do the rest.

Use `lib/directory-writes.ts` (all conflict-safe):

| Helper | Writes | Concurrency strategy |
|---|---|---|
| `setContactField(id, "name"\|"company"\|"role"\|"notes", value)` | contacts | field-path update (no clobber of other fields) |
| `addContactEmail / removeContactEmail(id, …)` | contacts | `arrayUnion` / `arrayRemove` + email validation |
| `addContactPhone / removeContactPhone(id, …)` | contacts | `arrayUnion` / `arrayRemove` + phone validation |
| `addContactUrl(id, url)` | contacts | `arrayUnion` + URL validation |
| `addContactTag / removeContactTag(id, tag)` | contacts | `arrayUnion` / `arrayRemove` |
| `setContextName(id, name)` | contexts | field-path update |
| `setContextType(id, "company"\|"job"\|"other")` | contexts | writes `directoryType`; sync moves the entry + deletes old composite id |
| `setContextFieldValue(id, label, value)` | contexts | **transaction** (retry-safe on `fields[]`) |
| `removeContextField(id, label)` | contexts | **transaction** |
| `flagDirectoryEntityForReview(collection, id, {reason, note, flaggedBy})` / `clearDirectoryReviewFlag(collection, id)` | contacts/contexts | **transaction**; writes `masterData.needsReview`/`reviewReason`/`reviewFlaggedBy`/`reviewFlaggedAt` — any signed-in user |

Merge duplicate / Delete (admin-only — `/users/{uid}.isAdmin`) run entirely server-side via `app/api/directory/{merge,delete}` + `lib/directory-server-writes.ts` (Admin SDK), not through the client write helpers above — see §14.

Validation (also exported from `lib/directory-core.ts`): `isLikelyEmail`, `isLikelyPhone`, `isLikelyUrl`, `isInvalidValue`, `cleanValue`. Validate inputs before calling helpers; helpers also throw `DirectoryWriteError` on invalid.

After a write, the UI can show optimistic state and expect the `/directoryIndex` entry to refresh within ~3–6s (or re-read the source doc immediately for the authoritative value).

---

## 6. Sync behavior (deployed Cloud Functions)

`functions/src/index.ts` — 1st-gen `onWrite` triggers (Admin SDK, only writers of `/directoryIndex`):

- `syncDirectoryOnContactWrite` (`contacts/{id}`): create/update → upsert `person__{id}` (company resolved by `sourceCompanyId` first, then name); delete → remove.
- `syncDirectoryOnContextWrite` (`contexts/{id}`): classify → upsert `{type}__{id}`, delete the other two type ids (type change self-heals); delete → remove all. **Company create/rename → re-relates affected people** and keeps the old name as an alias.
- Both honor the import lock and bump `/directoryMeta/status.lastChangeAt`.

Latency observed in prod smoke tests: create ~6s, re-relate/rename ~0–3s, delete ~3s.

---

## 7. Versioning & cache invalidation

- `DIRECTORY_SCHEMA_VERSION = 4` (in `lib/directory-core.ts`). Version 4 adds
  the shared compact catalog while retaining v3 master enrichment behavior.
- Every entry carries `schemaVersion`, `sourceUpdatedAt`, `indexedAt`.
- Client cache contract: store the MiniSearch payload keyed by `schemaVersion`; re-fetch when `/directoryMeta/status` shows a newer `schemaVersion` or `lastChangeAt`. Clear on user change / sign-out.
- Rebuild guard prevents a slow rebuild from clobbering fresher incremental writes (compares `schemaVersion` + `sourceUpdatedAt`).

---

## 8. Ops / scripts

Run with `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/generate-directory-index.mjs <mode>`:

| Mode | Effect |
|---|---|
| `--dry-run` (default) | classify + quality report, no writes |
| `--sample` | detailed normalized samples (20/20/20 + all others) |
| `--write` | idempotent upsert, **skips up-to-date** (rebuild guard); add `--force` to write all |
| `--rebuild` | delete all + full rebuild |
| `--repair` | reconcile report (orphaned/missing/stale); add `--apply` to fix |
| `--lock` / `--unlock` | toggle the import suppression lock (wrap bulk imports) |
| `--dump=<path>` | also emit the compact MiniSearch payload |

Audit-only (read): `scripts/audit-directory.mjs`. Bulk import: `scripts/import-database-xlsx.mjs` (wrap with `--lock` … `--rebuild` … `--unlock`).

Master enrichment: `scripts/enrich-directory-from-master.mjs` is dry-run by default, uses stable provenance/identity matching, writes safe normalized relations to `/directoryRelations`, ambiguous cases to `/directoryReviewQueue`, and reusable lookups to `/directoryReferenceData`. Production writes require `--write`, `DRY_RUN=false`, and `CONFIRM_MASTER_ENRICHMENT=true`; `--verify` checks source enrichment, index/schema counts, job-company projection, relationship/reference counts, idempotency, and message references.

**Bulk import recipe:** `--lock` → run importer → `--rebuild` → `--unlock`.

---

## 9. UI v1 structure

The UI is **isolated, lazy and read-only for entity source data.**

### Screens/components (`components/directory/`)
- `directory-screen.tsx` — Home/Results shell: owns `searchIndex`, `favoriteIds`/`recentIds`, scope + query + pagination state. Topbar is **just** `ModuleSwitcher` (left) + one Favorites star button (right) — **no grid/nav-menu icon**, that only exists in Stream (see §13.1).
- `directory-home.tsx` — heading, search bar, scope pills. Below the pills: `scope === "all"` shows `DirectoryRecentList`; any other scope shows a paginated type-browse list instead (see §13.2).
- `directory-search-bar.tsx`, `directory-scope-tabs.tsx` (pills now toggle — tapping the active one deselects back to `"all"`), `directory-recent-list.tsx`, `directory-results.tsx` (shared list body: skeleton/empty/error + "About {total} results" + rows + "Load 50 more"), `directory-result-row.tsx`, `directory-entity-icon.tsx`, `directory-states.tsx` (skeleton/empty/error primitives).
- `directory-favorites-screen.tsx` — **full screen**, not a modal (see §13.5). Rendered by `directory-screen.tsx` as an absolute overlay, not a separate `app/page.tsx` `Screen`, so it reuses the already-loaded index instead of re-fetching it.
- `directory-detail-screen.tsx` — read-only detail; topbar is just back-arrow + favorite star, no title text (see §13.6).
- `components/module-switcher.tsx` — title/chevron switcher shared by Stream and Directory (`SvcModule = "communications" | "directory"`).
- `lib/directory-config.ts` — `DirectoryScope`, `DirectoryListItem`, `DIRECTORY_SCOPES`, `DIRECTORY_ENTITY_META` (color/icon per type).
- `lib/directory-search.ts` — lazy MiniSearch build, native IndexedDB cache and `/directoryMeta` invalidation; one-shot reads use Firestore Lite (`directoryDb` in `lib/firebase.ts`) so they do not interfere with Communications' realtime watch stream.
- `lib/directory-user-state.ts` — synchronized favorites and three most-recent entries. Also fires a `getDocsFromServer` prime alongside each `onSnapshot` subscribe as a stale-cache workaround (see §13, Known issue).
- Search: empty query shows Home; a submitted query shows one mixed relevance-ranked list filtered by All / People / Companies / Jobs.

### App integration (`app/page.tsx`)
1. `"directory"` and `"directory-detail"` are part of the existing `Screen`/`SCREEN_DEPTH` state router. There is no `"directory-favorites"` `Screen` — favorites is an in-component overlay, see above.
2. Both screens are lazy-loaded; Detail occupies the full screen while the base screen stays mounted but hidden so query/filter state survives Back.
3. The Stream/Directory module switcher lives in the topbar title. `DirectoryScreen` only exposes `onSwitchToStream: () => void` (not a generic nav-target callback) — from Directory you can only get to People/Projects/Calendar/Contexts by switching back to Stream first, then using Stream's grid menu.

### Design consistency (reuse, don't reinvent)
- Loading: `components/app-loading-screen.tsx` (`AppScreenSkeleton`, `MessageSkeleton`), `animate-pulse`, `bg-white/8`.
- Pagination: the 50-at-a-time "Load 50 more · X remaining" pattern in `people-screen.tsx` / `contexts-screen.tsx` — reused as-is in `directory-results.tsx` and for Home's type-browse list.
- Row/list visual language is now **Google-Search-like, not glass-modal-like**: 32px icons (circular initials for people, rounded-square icon for company/job), no chevrons, no `divide-y`/`border-t` dividers between rows — separation is spacing + hover only. Don't reintroduce card backgrounds or divider lines here without checking §13.3 first.
- Search scoring for local lists: `lib/smart-search.ts` already exists (used for contacts/contexts) — MiniSearch is for the global cross-type index.

---

## 10. Pending before / during the UI

- ~~**`mergeContactsServer` Cloud Function**: re-point message `contactIds` duplicate→survivor and delete the tombstoned dup~~ — **done**, as a Next API route rather than a Cloud Function: `app/api/directory/merge` (see §14).
- **Favorites / recents**: implemented in `users/{uid}/directoryFavorites` and `users/{uid}/directoryRecents`; security rules restrict both to their owner, `/directoryIndex` remains read-only, and — as of this session — **the rules are deployed to production**. See §13 for a known stale-listener issue and the workaround applied.
- **Messages↔Directory relations**: `projectMessageRelatedEntityIds()` exists (unused). When showing related messages, **reuse Communications' visibility filter** (same as the current stream/search) — do not expose hidden messages.
- **Tech debt**: the two `.mjs` scripts still carry ported normalizer copies (runtime app + functions already share `lib/directory-core.ts`).
- **Uncommitted work**: everything in §13 is sitting in the working tree, not committed. Commit it (including `firestore.rules`/`firestore.rules.secure`, which are already live in prod) before it gets lost or diverges further.

---

## 11. File map

| File | Role |
|---|---|
| `lib/directory-core.ts` | **single source of truth**: types, normalizers, index builders, validation, versioning, MiniSearch config |
| `lib/directory.ts` | thin re-export of the core (Next app entry) |
| `lib/directory-writes.ts` | conflict-safe write helpers (write /contacts\|/contexts only) |
| `functions/src/index.ts` | sync Cloud Functions (contact/context → index) |
| `functions/src/directory-core.ts` | GENERATED copy of the core (do not edit) |
| `functions/scripts/copy-shared-core.mjs` | regenerates the functions core copy on build |
| `scripts/generate-directory-index.mjs` | generator/rebuild/repair/lock + `--dump` |
| `scripts/audit-directory.mjs` | read-only audit |
| `scripts/enrich-directory-from-master.mjs` | dry-run/write/verify master enrichment, relations, references and review queue |
| `scripts/directory-search.test.ts` | `pnpm test:directory` — MiniSearch ranking/scope/pagination/cache-key unit tests |
| `firestore.rules` / `.secure` | access rules (directoryIndex/meta/control + directoryFavorites/directoryRecents — **deployed to prod**, see §13) |
| `lib/directory-config.ts` | UI-only types: `DirectoryScope`, `DirectoryListItem`, `DIRECTORY_SCOPES`, `DIRECTORY_ENTITY_META` |
| `lib/directory-search.ts` | MiniSearch load/cache/search/paginate (client) |
| `lib/directory-user-state.ts` | favorites/recents subscribe + write (client) |
| `components/directory/*.tsx` | UI v1 — Home, Results, Detail, Favorites screen, shared row/state primitives (see §9) |
| `components/module-switcher.tsx` | Stream ⇄ Directory switcher used by both topbars |

---

## 12. UI verification checklist

1. Run `pnpm test:directory` and `pnpm test:vcf-import`.
2. Run `pnpm exec tsc --noEmit`, `pnpm build` and `pnpm functions:build`.
3. Verify Home → Results → Detail → Back preserves the submitted query and scope.
4. Firestore rules for favorites/recents are **already deployed** to prod (this session). If you change them again, re-verify against the emulator first (owner CRUD ok, cross-user denied — see §13 for the exact pattern used), then redeploy with explicit user approval before assuming prod matches the working tree.
5. If a real user reports "favorites/recents don't show up" despite writes succeeding, don't assume it's a data bug — reproduce the exact read against prod first (see §13, Known issue) before changing query/rule logic.
6. Keep all entity edits routed through `lib/directory-writes.ts` in a future editable phase.

---

## 13. Session log — UI polish pass (uncommitted)

Everything below happened in one working session on top of the UI v1 build described in §9–12. **None of it is committed to git** — `git status` shows all Directory-related files as modified/untracked. Read this before starting new Directory work.

### What changed

1. **Directory topbar simplified.** Removed the grid/nav-menu icon and `NavigationMenuModal` entirely from `directory-screen.tsx` — that menu now only exists in Stream. Directory's topbar is just `ModuleSwitcher` (left) + one Favorites button (right). You can no longer jump from Directory straight to People/Projects/Calendar/Contexts — switch back to Stream first, then use Stream's grid menu. `app/page.tsx`'s old multi-target `handleDirectoryNavigate` was deleted and replaced with a single `handleDirectorySwitchToStream`. `NavTarget` (from `navigation-menu-modal.tsx`) is no longer imported in `app/page.tsx`.

2. **Home scope pills now toggle and drive a browse list.** Tapping People/Companies/Jobs on Home selects that scope; tapping the same pill again deselects back to `"all"` (`selectScope` in `directory-screen.tsx`, shared with the Results scope tabs). When a scope is active on Home, the "Recent" section is replaced by a full paginated browse list of that type — recents of that type first, then the rest A→Z, batches of 50 with "Load 50 more" (same client-side slice pattern as `contexts-screen.tsx`/`people-screen.tsx`, not a Firestore cursor). New state in `directory-screen.tsx`: `homeVisibleCount`, memo `scopeBrowseItems`; `directory-home.tsx` renders `DirectoryResults` (heading = `DIRECTORY_ENTITY_META[scope].plural`) instead of `DirectoryRecentList` when scope ≠ "all".

3. **Results page restyled Google-Search style.** `directory-entity-icon.tsx`: person icons are circles (`rounded-full`) with initials at 32px; company/job stay rounded-square, also 32px (down from 36px); dropped the inset-shadow "glass" highlight on small (row) icons, kept it only on the large detail-header icon. `directory-result-row.tsx`: removed the trailing chevron, more generous row padding (`py-3.5`), no persistent background — only a light `hover:bg-white/3`, `rounded-lg`. Removed **all** `divide-y`/`border-t` row dividers across `directory-results.tsx`, `directory-recent-list.tsx`, and the old favorites sheet (now deleted) — separation is spacing-only. `directory-results.tsx` shows an "About {total} results" line above the list. `DirectoryRowsSkeleton` (in `directory-states.tsx`) updated to match (32px circular pulse, no divider).

4. **Firestore rules for Directory favorites/recents are now LIVE in production.** The `directoryFavorites`/`directoryRecents` rule blocks existed in the working tree from an earlier session but were never deployed. This session: verified the exact rule shape against the emulator with a throwaway script (owner can create/delete, cross-user write denied under `firestore.rules.secure`), then ran `firebase deploy --only firestore:rules --project svc-comms` with explicit user approval. **The deployed rules match the current local `firestore.rules` content, but that file is still uncommitted in git** — if you `git checkout`/discard it, prod will keep running the newer rules while the repo shows the old ones. Commit it to close that gap.

5. **Favorites is now a full screen, not a modal.** Deleted `directory-favorites-sheet.tsx` (bottom sheet with dimmed backdrop). New `directory-favorites-screen.tsx` — full-bleed, own header (back arrow + "Favorites" title, no "SVC Directory" branding), reuses `DirectoryResultRow`/`DirectoryEmptyState`/`DirectoryErrorState`/`DirectoryRowsSkeleton`. It's rendered by `directory-screen.tsx` as an absolutely-positioned overlay (`absolute inset-0 z-20`, `animate-slide-in-right` — the same directional-push class used elsewhere for forward navigation) on top of the Directory container — **not** a new `app/page.tsx` `Screen`. That keeps it sharing the already-loaded `searchIndex`/`favoriteIds` state instead of re-fetching the 7,632-doc index a second time.

6. **Detail screen topbar simplified.** Removed the "SVC Directory" `<h1>` from `directory-detail-screen.tsx`'s header — now just back arrow (left, `justify-between`) + favorite star (right).

7. **Favorites data-integrity signal.** `directoryItemsForIds` silently drops any favorite/recent id not found in the loaded search index — previously indistinguishable from "you have zero favorites". Added `hasUnresolvedFavorites` in `directory-screen.tsx` (true when `favoriteIds.length > 0` but `favoriteItems.length === 0` post-load) — the Favorites screen shows `DirectoryErrorState` (with Retry, rewired through `retryKey`) instead of the misleading empty state when this is true.

8. **App resumes into the last module used (`app/page.tsx`).** New `LAST_MODULE_KEY = "svc-last-module"` in `localStorage`, written by `persistLastModule()` on every `navigateTo()` call: `"directory"` when the target screen is `"directory"`/`"directory-detail"`, `"communications"` for any other real screen (login/register/loading are ignored so the transitional auth flicker never clobbers it). On auth resolve, the old unconditional `navigateTo("compose")` became `navigateTo(getLastModule() === "directory" ? "directory" : "compose")` — default landing is unchanged (Compose/Communications) unless the user's last session was in Directory, in which case the app opens straight into `"directory"`. This is app-wide navigation plumbing, not Directory-scoped, but it's the mechanism that makes Directory feel like a real second "home" instead of a page you always have to re-enter from Stream.

### Known issue found + workaround applied

**Symptom:** user favorited 2–3 entities from Detail. Confirmed via `service-account.json` + `firebase-admin` that they were written correctly to `users/{uid}/directoryFavorites` in prod. But the Favorites screen kept showing "No favorites yet" on their iOS PWA.

**Root-caused to:** `subscribeDirectoryFavorites`/`subscribeDirectoryRecents` (`lib/directory-user-state.ts`) listen via `onSnapshot` on the main `db` instance, which uses `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` (`lib/firebase.ts`). A reproduction script — signed in as the real user via a `firebase-admin`-minted custom token (`auth().createCustomToken(uid)` → client `signInWithCustomToken`), doing a plain one-shot `getDocs` with the exact same query — returned the favorites correctly against prod. So the data, the security rules, and the query shape are all fine; the live `onSnapshot` listener in that specific browser/PWA session was serving a stale/empty result from the on-device persistent cache without reconciling against the server. This matches known iOS Safari/PWA IndexedDB-persistence flakiness for Firestore's offline cache.

**Fix applied (defensive, not a proven root cause):** both subscribe functions now also fire a one-shot `getDocsFromServer(query)` (fire-and-forget, `primeFromServer` helper) *alongside* attaching the `onSnapshot` listener. The forced server read writes into the same local cache the listener reads from, so a stuck/stale cache gets corrected quickly instead of waiting on the SDK's own reconnect timing.

**If this resurfaces:** ask whether it reproduces in a plain (non-installed) Safari tab vs. only the installed Home Screen PWA — that isolates a service-worker/PWA-cache issue from a genuine Firestore SDK bug. The diagnostic pattern used this session (scripts were temporary, all deleted afterward, not committed) is worth reusing for future Directory data-mismatch reports:
   - Emulator test signing in via `signInAnonymously`, exercising the exact client helper (e.g. `setDirectoryFavorite`) under `firestore.rules.secure`, to prove the rule shape (owner CRUD ok, cross-user denied).
   - `firebase-admin` read of the relevant prod doc/collection with `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` to confirm the data really is (or isn't) there — admin bypasses rules, so this isolates "is it the data" from "is it access control".
   - `firebase-admin.auth().createCustomToken(uid)` + client-SDK `signInWithCustomToken` + the app's real query, run from a plain Node script against **prod** (not the emulator) as the real user, to reproduce the client's exact read path without needing browser access.

### Current uncommitted state (as of this session)

Modified: `app/globals.css`, `app/page.tsx`, `components/navigation-menu-modal.tsx` (`NavTarget` gained `"directory"` and is now exported), `components/stream-screen.tsx`, `docs/svc-directory-ui-context.md` (this file), `firestore.rules`, `firestore.rules.secure`, `lib/firebase.ts` (added `directoryDb` Firestore Lite export), `package.json`/`pnpm-lock.yaml` (added `minisearch`, `tsx`, bumped `firebase`).
Untracked: `components/directory/` (11 files — `directory-detail-screen.tsx`, `directory-entity-icon.tsx`, `directory-favorites-screen.tsx`, `directory-home.tsx`, `directory-recent-list.tsx`, `directory-result-row.tsx`, `directory-results.tsx`, `directory-scope-tabs.tsx`, `directory-screen.tsx`, `directory-search-bar.tsx`, `directory-states.tsx`), `components/module-switcher.tsx`, `lib/directory-config.ts`, `lib/directory-search.ts`, `lib/directory-user-state.ts`, `scripts/directory-search.test.ts`.

Nothing has been committed this session. **Firestore rules are deployed to prod despite being uncommitted** (point 4 above) — when you do commit, include `firestore.rules` and `firestore.rules.secure` so the repo matches what's actually live.

### Verified this session
- `pnpm test:directory` — 7/7 pass (including master enrichment and job→company projection).
- `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm functions:build` — all clean, run repeatedly after each change (`functions:build` regenerates `functions/src/directory-core.ts` from `lib/directory-core.ts`; confirmed no drift).
- Firestore rules for `directoryFavorites`/`directoryRecents` verified against the emulator (owner CRUD ok, cross-user denied) *before* deploying to prod.
- Favorites write path reproduced end-to-end against prod as the real user (see "Known issue" above) — confirmed writes succeed and are readable via one-shot query; the bug was isolated to the live listener.

---

## 14. Cleanup flow — Edit / Flag for review / Merge duplicate / Delete

Added on top of UI v1: a way to handle duplicates and bad records directly in
the app (`ProfileAction`/`QuickActions` in `directory-profile-screen.tsx` —
Flag/Merge/Delete are just new `ProfileActionKind` values, same plumbing as
`edit`).

**Entry points: pill row vs. the More sheet.** Only the frequent, everyday
actions (Call/Email/Website/Directions/Drive/Edit) render as pills in
`QuickActions`'s horizontal row. Flag for review, Merge duplicate and Delete
are "database maintenance" actions — grouped instead behind a single **More**
pill (`MoreHorizontal` icon) that opens `DirectoryManageSheet`, a bottom sheet
(`components/ui/drawer.tsx`, styled with Directory's own `.glass-panel`) —
this replaced an earlier attempt at putting Flag/Merge/Delete directly in the
pill row, which visibly overflowed the row on mobile once a fourth/fifth
action was added. `QuickActions` filters `vm.actions` by kind
(`MANAGEMENT_ACTION_KINDS = {flag, merge, delete}`) into the pill row vs. what
it hands to the More sheet; the More pill itself only renders when at least
one management action is present. `DirectoryManageSheet` takes that same
filtered array as a prop and renders it as-is — it does no permission
filtering of its own, so a non-admin (whose view model never included
`merge`/`delete` in the first place, see below) sees only "Flag for review"
there, and any action added to the view model later shows up automatically
with no changes to this component. Tapping a row closes the sheet and calls
the same `handleAction()` used by the pill row, which is unchanged — it opens
the same `DirectoryFlagSheet`/`DirectoryMergeSheet`/`DirectoryDeleteConfirmSheet`
this section describes below. Delete is visually destructive (red icon/text)
and always listed last.

**Permission model.** Edit and Flag for review are open to any signed-in
user. Merge duplicate and Delete require `/users/{uid}.isAdmin === true` —
the same flag that already gates the Activity Monitor screen; no new admin
flag was added. `DirectoryProfileScreen` takes an `isAdmin` prop (threaded
from `app/page.tsx`'s existing `currentUser?.isAdmin`) and passes
`{ canModerate: isAdmin }` into `loadDirectoryProfileViewModel()`, which the
person/company/job view-model builders use to decide whether to include the
`merge`/`delete` actions at all (they're absent from the view model for a
non-admin, not just hidden client-side).

**Firestore rule change**: `/contacts` `update` is now open to any
authenticated user (previously owner-only, matching `/contexts`) — needed
for Flag for review to work for non-owners, and incidentally fixes a
pre-existing bug where Directory's Edit sheet showed "Edit" to everyone but
silently failed to save for anyone who didn't own the contact (the legacy
`people-screen.tsx` correctly hid its own edit UI behind
`contact.ownerUserId === currentUserId`; Directory's edit sheet never did).
`delete` stays owner-scoped in the rules — merge/delete never call
`deleteDoc` from the client; they go through `app/api/directory/{merge,delete}`
(Admin SDK, bypasses rules) after their own server-side `isAdmin` check via
`lib/directory-admin-guard.ts::requireDirectoryAdmin()`. **`update` requires
`request.resource.data.ownerUserId == resource.data.ownerUserId`** — an
open-to-anyone update rule with no field restriction would otherwise let a
non-owner set `ownerUserId` to their own uid and then pass the owner-scoped
`delete` rule right above it, silently defeating the whole "delete is
admin-gated" guarantee. Covered by
`scripts/test-directory-cleanup-rules.mjs` ("CANNOT reassign ownerUserId").

**Flag for review** (`lib/directory-writes.ts::flagDirectoryEntityForReview`/
`clearDirectoryReviewFlag`): writes `masterData.needsReview` + `reviewReason`
(preset — Duplicate / Incorrect info / Inactive / Other — plus an optional
note, combined into the one existing `reviewReason` string field) +
`reviewFlaggedBy`/`reviewFlaggedAt`. No new UI surface needed for the flag
itself — the "Needs review" badge and Admin Details rows already existed
(previously import-only). New: `components/directory/directory-flag-sheet.tsx`.

**Merge duplicate** (people, companies AND jobs — `mergeDirectoryEntities(entityType, survivorSourceId, duplicateSourceId)`
in `lib/directory-server-writes.ts` dispatches to one of three type-specific
functions, called from `app/api/directory/merge` with `{ entityType, survivorId, duplicateId }`):

- `mergeDirectoryContacts()` — unions contact fields (emails/phones/urls/tags/companies/roles),
  tombstones the duplicate (`mergedIntoId`), then re-points every reference from the
  duplicate's composite id to the survivor's — job/company
  `involvedContactIds`/`involvedPeople`/"People involved" field,
  `/directoryRelations` edges, `/directoryNotes`/`/directoryFiles` `entityIds`, and
  `messages.contactIds` (paginated, capped at 2,000 messages per merge) —
  before deleting the duplicate contact doc. This is what the old client-only
  `mergeContactData()` (removed) could never finish: it had no way to touch
  `/messages` (client can't write messages it doesn't own) and the
  owner-scoped `/contacts` rule blocked it for most real duplicates anyway.
- `mergeDirectoryCompanies()` — unions `masterData` (survivor's non-empty
  scalars win, duplicate fills gaps — `fillMissingScalars()`) and `fields[]`
  (`unionFieldsByLabel()`), folds the duplicate's name into the survivor's
  `masterData.aliases` (the same idea a company **rename** already uses to
  keep its old name searchable — see `reRelatePeopleForCompany` in
  `functions/src/directory/sync.ts`), then re-points every contact/job whose
  company link pointed at the duplicate. Finding those links reuses that same
  function's three-source match (`masterData.companyContextId`, `sourceCompanyId`,
  exact name) via `findEntitiesLinkedToCompany()` — most contacts only match by
  name, not by an explicit id, so the name-match query is the one that matters
  most in practice. Re-pointing sets both the id **and** the display name/text
  field, unlike delete (below), which only clears the id.
- `mergeDirectoryJobs()` — unions `involvedPeople`/`involvedContactIds`
  (survivor's entry wins on an id conflict) and `masterData`/`fields[]`
  (`"People involved"` is excluded from the generic field union and
  regenerated from the merged people list instead of unioned as raw text),
  then `db.recursiveDelete()`s the duplicate — `/contexts/{jobId}/outlooks`
  is a subcollection Firestore won't cascade-delete on its own.

All three share `repointRelations()` (rewrites the deterministic
`rel__{from}__{to}` `/directoryRelations` doc id; a collision with an
existing survivor-side edge just drops the duplicate's) and
`repointNotesAndFiles()` (`/directoryNotes`/`/directoryFiles` `entityIds`).
Their repoint/strip steps run via `Promise.all` (disjoint collections, no
data dependency between them) rather than sequentially, both here and in
`deleteDirectoryEntity()`.

**Resumable, not just idempotent-once-started.** Each merge tombstones the
duplicate (`mergedIntoId`) in the same transaction as the field union, then
runs the repoint steps as separate calls afterward — if one of those throws
(a transient Firestore/network error), the duplicate is left tombstoned but
not yet fully repointed/deleted. The "already merged" guard only hard-rejects
when `mergedIntoId` points at a *different* survivor than the one requested;
if it points at the same survivor, the function re-runs the (idempotent)
union transaction and falls through to retry the repoint/delete steps, so a
retried request completes the interrupted merge instead of getting
permanently stuck behind its own tombstone. Covered by
`scripts/directory-cleanup-server.test.ts` ("resumes and completes after a
simulated partial failure").
New: `components/directory/directory-merge-sheet.tsx` (one sheet for all
three types — picks `PeopleSelector`/`CompanySelector`/`JobsSelector` from
`directory-edit-sheet.tsx`, now all exported, per `vm.type`, `CompanySelector`
and the capped-to-one `PeopleSelector`/`JobsSelector` already being
single-pick-shaped), `lib/directory-cleanup-client.ts` (Bearer-token fetch
wrappers, same shape as `features/directory/ai/client/directory-ai-client.ts`).

**Delete** (`deleteDirectoryEntity()`/`computeDirectoryDeleteImpact()` in
`lib/directory-server-writes.ts`, called from `app/api/directory/delete`,
works for all four types): same reference-finding as merge minus the
"redirect to survivor" step — strips the id from job/company membership
(person) or nulls `masterData.companyContextId` on contacts/jobs that
pointed at it (company — via the same `findEntitiesLinkedToCompany()` merge
uses, but leaving the free-text name/company field alone, unlike merge,
which also updates the text), notes/files `entityIds`, and
`messages.contactIds` (person); deletes every `/directoryRelations` edge
touching the id (not just the sync Cloud Function's own `context-sync`-owned
edges, which is all `syncDirectoryOnContactWrite`/`syncDirectoryOnContextWrite`
clean up on their own — import-authored edges would otherwise dangle
forever). Jobs get `db.recursiveDelete(docRef)` instead of a plain delete,
same subcollection reason as job merge. The confirm UI
(`components/directory/directory-delete-confirm-sheet.tsx`) calls the same
endpoint with `dryRun: true` first to show real reference counts (including
the `contacts`/`contexts` counts for a company, added alongside merge) before
the admin confirms.

**Known v1 scope trims** (deliberate, to keep this simple — revisit if they
bite in practice):
- No global toast/notification system exists in this module, so a successful
  delete just navigates back to Directory with no confirmation toast (Flag
  and Merge do show an inline notice, since those stay on the same screen).
- No duplicate-suggestion/fuzzy-matching UI — merge is manual search-and-pick
  via the same typeahead pattern as the existing Company/People/Jobs selectors.
- Merging two companies/jobs does not attempt to reconcile conflicting
  `masterData` beyond "survivor's non-empty value wins, duplicate fills
  gaps" — there's no field-level diff/review UI before confirming, unlike
  the person merge picker's preview panel (which only shows *that* a merge
  will happen, not a field-by-field diff either, so this is consistent, just
  worth knowing if a company/job merge produces a surprising result).

---

## 15. Directory admin access delegation

Self-service delegation of Directory admin (merge/delete + this screen
itself) to other users, mirroring Courtney Roberts Center's own
`courtneyRobertsCenterAccess` / `admin-management.ts` pattern exactly —
same reason: a Firestore-backed flag any current admin can grant/revoke from
inside the module beats a static env var or a hardcoded list, which drift
out of sync and need a redeploy to change.

**New field, not a reuse of `isAdmin`.** `lib/directory-admin-guard.ts`
previously argued `isAdmin` alone was fine for Directory since there was no
"distinct sensitivity" to justify a second flag — that stopped holding once
Directory needed its *own* delegation screen: granting "Directory access"
through the shared `isAdmin` flag would silently also hand out Activity
Monitor access, a much bigger blast radius than the action implies. New
dedicated field: `/users/{uid}.directoryAdminAccess`.
`requireDirectoryAdmin()` now accepts `directoryAdminAccess === true` **OR**
`isAdmin === true` — unioned in, not replacing it, so every admin who
already relied on `isAdmin` for merge/delete keeps working with nothing to
re-grant on day one. New grants should go through the delegation screen;
`isAdmin` is the legacy path, not the recommended one. Full rationale is in
the file-level comment there.

**Pieces** (mirroring CRC's file-for-file):
- `lib/directory-admin-guard.ts` — gate (`hasDirectoryAdminAccess()` +
  `requireDirectoryAdmin()`), extended rather than replaced.
- `lib/directory-admin-management.ts` — `listDirectoryAdminAccessUsers()` /
  `setDirectoryAdminAccess()`, server-side (Admin SDK). New vs. CRC's
  version: each user also carries `isLegacyAdmin` (`isAdmin === true`),
  independent of `hasAccess`, because toggling `directoryAdminAccess` off
  for a legacy-`isAdmin` user does **not** actually revoke their access —
  `isAdmin` still grants it — and the UI needed a way to say so instead of
  the toggle silently looking like it did nothing.
- `app/api/directory/admins/[uid]/route.ts` (PATCH toggle) — identical shape
  to the CRC route. The GET list route this originally shipped alongside was
  later folded into `app/api/directory/access/route.ts` (see the perf note
  below) — `listDirectoryAdminAccessUsers()` itself is unchanged, just called
  from a different route now.
- `lib/directory-admin-client.ts` — Bearer-token fetch wrappers, same shape
  as `lib/courtney-roberts-center/client.ts`'s access-management subset.
- `components/directory/directory-access-screen.tsx` — same logic as
  `courtney-roberts-center-access-screen.tsx` (fetch, optimistic toggle with
  revert-on-failure, self-toggle disabled, denied/loading/empty states), but
  Directory's own glass topbar chrome (`directory-glass-screen` /
  `glass-panel app-topbar` / `glass-button`, matching
  `directory-favorites-screen.tsx`) instead of CRC's plain-button header,
  since this screen lives inside Directory rather than being its own
  top-level module. The list card itself (`rounded-2xl bg-card border
  divide-y`) matches CRC's/`admin-screen.tsx`'s settings-list convention —
  deliberately not Directory's Google-Search-style result-row styling,
  which is a different genre of list (search results, not a permissions
  table). Adds an "Admin" badge + explanatory note for `isLegacyAdmin` users.
- Entry point: a `UserRound` icon button in `directory-screen.tsx`'s topbar
  (sibling of the favorites `Star` button, same `glass-button h-9 w-9
  rounded-full` pattern — both grouped in a small flex wrapper so
  `justify-between` still only sees two top-level header children). Order is
  deliberate: favorites (`Star`) first/left, admin access (`UserRound`) last/
  right — favorites is the more frequently used of the two, admin access sits
  at the far edge since it's the more "administrative" one. Opens as a nested
  absolute overlay (`showAccess` state, same pattern as
  `showFavorites`/`DirectoryFavoritesScreen`) rather than a top-level
  `app/page.tsx` `Screen` — unlike CRC, which *is* its own separate module.
  The icon is always visible; the screen itself handles the denied state,
  exactly like CRC's. `directory-screen.tsx` still fetches the flagged count
  on mount (best-effort, fails silently for non-admins or any other error) —
  it no longer renders as a badge on this icon (see below), but it's reused
  to keep the aria-label informative (`"Manage Directory access — N flagged
  for review"`).

**Flagged for review** — a moderation-queue view on the same screen, since
there was previously nowhere that listed flagged records in aggregate: `masterData.needsReview`/`reviewReason`
(set by `flagDirectoryEntityForReview()`, open to any signed-in user — see
§14) was only ever visible one profile at a time, via
`directory-flag-sheet.tsx`. It's also not in the client search index
(`lib/directory-search.ts`/`directoryIndex`) — it lives only in each source
doc's `masterData`.
- `lib/directory-review-queue.ts` (new) — `listFlaggedDirectoryEntities()`:
  two small `where("masterData.needsReview", "==", true)` queries (Admin
  SDK), one each against `/contacts` and `/contexts`, returning
  `{directoryId, sourceId, sourceCollection, type, name, reviewReason,
  flaggedByName, flaggedAt}` sorted by name. `flaggedByName` resolves
  `masterData.reviewFlaggedBy` (a uid) to a display name with one batched
  `db.getAll(...refs)` covering every *distinct* flagger in a single
  round trip — not one `.get()` per flagged record, and not even one
  `.get()` per distinct flagger run in parallel (`Promise.all` of individual
  gets is still N round-trips; `getAll` is one) — falling back to `null` for
  flags set before this was tracked or whose flagger no longer exists. `flaggedAt` is
  `reviewFlaggedAt.toMillis()` (epoch millis, JSON-safe over the API route;
  a raw Firestore `Timestamp` isn't). `sourceCollection` is included so the
  UI can call `clearDirectoryReviewFlag()` directly without re-deriving
  `"contacts"`/`"contexts"` from `type`. Deliberately does not touch the
  `directoryIndex`/search-shard projection pipeline — that stays a
  name/contact-fields projection, not a moderation index, and this query is
  small enough (ad hoc, no server-side index needed for a single-field
  equality filter) not to warrant joining it.
- `app/api/directory/flagged/route.ts` (GET, new) — gated by the same
  `requireDirectoryAdmin` as everything else on this screen: flagging
  itself is open to everyone, but the aggregate queue is admin-only, same
  reasoning as gating "Manage access."
- `fetchDirectoryFlaggedEntities()` (standalone, for `directory-screen.tsx`'s
  topbar count) and `fetchDirectoryAccessData()` (combined with the admin
  roster, for the access screen itself — see the perf note below) both live
  in the existing `lib/directory-admin-client.ts` rather than a new client
  file — all three concerns are consumed by these same two screens and
  share the auth-header helper.
- UI: an inbox-style list — `DirectoryEntityIcon` (the same person/company/job
  icon `directory-result-row.tsx` uses for search results), name + tinted
  type badge, `reviewReason` as a second line, a trailing chevron, and
  nothing else. The whole row is one button (`onOpenDetail`); there is no
  per-row "Open" or "Clear flag" anymore (see below). Above the list: a
  name/reason search box (same visual pattern as "Manage access"'s search,
  matching `entity.name` and `entity.reviewReason`, client-side over the
  already-fetched list — same reasoning as the users search, no new query),
  then filters — **type** (All/People/Companies/Jobs, pill toggles,
  unchanged) and **reason** — no longer an inline `<select>`, now a small
  "Filters" pill (label shows the active reason once one is picked) that
  opens a bottom sheet (`Drawer`) listing "All reasons" + the four presets
  `directory-flag-sheet.tsx` uses, each row a plain tap target with a
  checkmark on the active one. An "N open" line (`Info` icon, tinted) sits
  between the search box and the filters — replaces the count badge that
  used to sit on this tab (see "Two tabs" below) with a plainer
  always-visible number, closer to an inbox's unread count than a
  notification badge. The type badge tinting is unchanged: Directory's own
  `DIRECTORY_ENTITY_META` person/company/job colors, same tokens
  `directory-profile-screen.tsx` uses for its own type badges — a subtle
  scan aid, not a strong color-coding scheme; "other" falls back to the
  company color the same way the profile screen's avatar does, since
  flagged "other" contexts can't actually occur (see above).

**Rows lost their inline actions; the profile gained the job of hosting
them.** Each row used to carry "Open" + "Clear flag" buttons — fine at a
handful of flagged records, heavy once there are 50+ (name + type +
description + two buttons, repeated). Cut down to just enough to identify
*what* is flagged and *why*; tapping the row is now the only interaction, and
it does what "Open" used to do. Clearing a flag no longer happens from this
list at all — it happens on the profile itself, via the existing
`DirectoryFlagSheet` (opened through the profile's "More" sheet → "Flag for
review"), which already showed a "Clear flag" link whenever
`vm.needsReview` was true. No new plumbing: that path already existed
and was already reachable, just not the one this screen pointed at. Merge/
Delete/Edit are reachable the same way, one tap further in, which matches
how an admin actually resolves a flagged record in practice — decide what's
wrong, then act on it in the record's own context, not from a list row.
Now that `DirectoryFlagSheet`'s "Clear flag" is the *only* way to clear a
flag (rather than one of two), it got a two-step confirm: tapping it reveals
"Clear this flag? [Yes, clear] [Cancel]" instead of firing immediately — the
single-tap version was fine when it was one button among several on a list
row read carefully one at a time, less fine as the sole, easy-to-fat-finger
action on a sheet someone might open just to double-check a reason.

**Two tabs, not two stacked sections.** "Flagged for review" and "Manage
access" started as two `<section>`s on one scrolling page — replaced with the
same underline-tab pattern `directory-profile-screen.tsx` uses for
Overview/Related/Notes/Files, since these are two unrelated lists doing
unrelated jobs (a moderation queue vs. a mostly-static admin roster), and
stacking them made the queue — the one actually worth checking regularly —
compete for space below whatever the admin list happened to be that day.
"Flagged for review" is the first/default tab. Neither tab carries a count
badge — one briefly sat on "Flagged for review" (after moving off the
topbar icon), but came out again the same way the topbar badge did: it's
`flagged.length`/`accessCount` already visible one scroll away, not
information worth a persistent red bubble. The tab bar itself is hidden in
the denied state (nothing to switch between). Each tab's intro text +
filter/search controls scroll normally with its list rather than staying
pinned — only the tab row itself (a `shrink-0` sibling of `main`, outside
its scroll region entirely) stays fixed, so switching tabs is always
reachable without hunting for a sticky search bar mid-scroll.

**Manage access: search + a count.** The users list has no pagination
(`listDirectoryAdminAccessUsers()` reads the whole `/users` collection —
fine at today's ~10 users, but not something to keep scanning by eye
forever) — added a name/email search input above the list, and a
"N people have Directory admin access" line (counting `hasAccess` **or**
`isLegacyAdmin`, since a legacy admin has access either way) so there's an
at-a-glance total instead of counting green switches.

**Revoking access shows an undo toast; granting doesn't.** Both directions
were, and still are, optimistic and immediate — the toggle always fires the
write right away, it isn't held pending an undo window. But turning access
*off* can interrupt someone mid-merge/delete, so a brief "Access revoked for
X — Undo" toast (`UNDO_WINDOW_MS = 6000`) appears only on revoke; clicking
Undo just re-invokes the same `setDirectoryAdminAccessUser(uid, true)` call
as flipping the switch back on would. Granting access gets no such friction
— there's no equivalent downside to reverse.

**Load performance pass.** A profile of this screen's mount surfaced three
concrete waterfalls, all fixed together:
- `GET /api/directory/admins` (list) and `GET /api/directory/flagged` used
  to be two separate routes, both hit on every screen open. Each independently
  called `requireDirectoryAdmin()` — verifying the same caller's ID token and
  re-reading the same `/users/{uid}` doc twice, in parallel, for no benefit,
  since each `route.ts` is its own serverless function sharing nothing with
  the other. Folded into one route, `app/api/directory/access/route.ts`,
  returning `{ users, flagged }` from a single auth check and running
  `listDirectoryAdminAccessUsers()`/`listFlaggedDirectoryEntities()` in
  parallel server-side. `GET /api/directory/flagged` still exists standalone
  for `directory-screen.tsx`'s topbar count, which never needs the admin
  roster.
- `resolveFlaggerNames()` (in `lib/directory-review-queue.ts`) switched from
  `Promise.all` of individual `.doc(uid).get()` calls to one batched
  `db.getAll(...refs)` — same result, one round trip instead of N (running
  them in parallel already avoided summing their latencies, but not the
  per-call overhead of N separate requests).
- `fetchDirectoryAccessData()` (`lib/directory-admin-client.ts`) caches its
  result for 30s in a module-level variable. This screen is opened via a
  topbar icon — closing and reopening it is the common case, and previously
  re-ran the entire fetch (and its now-single auth check) from scratch every
  time regardless of how recently it had just loaded. `handleToggle` and
  `handleClearFlag` both call `invalidateDirectoryAccessCache()` right after
  their write succeeds, so a reopen immediately after granting/revoking
  access or clearing a flag never shows pre-mutation data — the 30s TTL only
  covers "closed and reopened without changing anything," not "another
  admin changed something elsewhere," which is why it's a short TTL rather
  than cached indefinitely.

**No Firestore rules change.** `/users/{uid}` write rules stay self-write-only
and untouched — granting/revoking another user's `directoryAdminAccess`
happens via Admin SDK from the PATCH route, which bypasses rules entirely,
exactly like CRC's `setCourtneyRobertsCenterAccess()` always has. A client
never writes another user's doc directly for this feature.

**Test coverage**: `scripts/directory-admin-access.test.ts` (pure unit tests
on the doc-shape mapping, particularly `isLegacyAdmin`/`hasAccess`
independence — same bar as CRC's own
`toCourtneyRobertsCenterAccessUserForTests` tests, which are similarly the
only tests that module has). `scripts/directory-review-queue.test.ts`
(emulator-backed — `pnpm emulator:test-directory-review-queue`) covers
`listFlaggedDirectoryEntities()` end to end: flagged people/companies/jobs
found, unflagged records excluded, sort order, the top-level-`name`
fallback when `masterData` has none, `flaggedByName` resolving a real
`/users/{uid}` doc, and `flaggedByName`/`flaggedAt` both falling back to
`null` for a `reviewFlaggedBy` uid with no matching user doc. The existing
`scripts/test-directory-cleanup-rules.mjs` /
`scripts/directory-cleanup-server.test.ts` suites were re-run as a
regression check since `directory-admin-guard.ts` is a shared dependency of
merge/delete — both still fully green.
