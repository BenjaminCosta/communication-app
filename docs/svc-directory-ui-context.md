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
the app, from the profile screen's existing quick-actions pill row
(`ProfileAction`/`QuickActions` in `directory-profile-screen.tsx` — Merge and
Delete are just new `ProfileActionKind` values, same plumbing as `edit`).

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
`lib/directory-admin-guard.ts::requireDirectoryAdmin()`.

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
