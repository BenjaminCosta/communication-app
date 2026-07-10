# SVC Directory — UI Build Context

> Handoff/context doc to start building the **SVC Directory UI**. The data
> architecture, sync, hardening, helpers and scripts are all done, tested and
> deployed. This file is the single place to read before maquetar la UI.
>
> Last updated: 2026-07-10 · schemaVersion **2** · index docs: **7,632**

---

## 0. TL;DR

- The Directory is a **read-only derived layer** over `/contacts` + `/contexts`.
- Read from **`/directoryIndex`** (7,632 docs: person 5,008 · company 2,210 · job 407 · other 7).
- **Never write to `/directoryIndex`.** Every edit writes to `/contacts` or `/contexts`; Cloud Functions re-derive the index automatically (~3–6s).
- Use the ready-made conflict-safe helpers in **`lib/directory-writes.ts`**.
- Contacts are **global-only**: any authenticated user sees every contact.
- Search: build a **MiniSearch** index client-side from the compact projection, load it **only when Directory opens**, cache locally, invalidate via `/directoryMeta`.

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
| `companyName` | string \| null | parent company display name (person) |
| `companyEntityId` | string \| null | `company__…` when resolved; jobs always null |
| `linkedUserId` | string \| null | Firebase UID when the person registered |
| `sourceSheet` | string \| null | import provenance |
| `sourceRecordId` | string \| null | import provenance |
| `quality` | DirectoryQualityFlags | see below |
| `schemaVersion` | number | current = 2 |
| `sourceUpdatedAt` | Timestamp \| null | source doc updatedAt |
| `indexedAt` | Timestamp | when the entry was (re)built |
| `updatedAt` | Timestamp | back-compat alias of indexedAt |

`DirectoryQualityFlags`: `{ hasEmail, hasPhone, hasCompany, hasRole, hasLocation, isLinkedUser, isComplete, issues: string[] }`.
Use `quality.isComplete` / `quality.issues` to show "incomplete" badges or a data-quality filter.

### Compact search projection — `DirectorySearchDoc`
Tiny per-entity doc for MiniSearch: `{ id, type, name, aliases, keywords, companyName, location, role, subtitle }`.
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
| `/directoryMeta/status` | **read** (auth), no write | `{ schemaVersion, counts, lastRebuildAt, lastChangeAt }` — cache-invalidation signal |
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

**B. Global search (MiniSearch).** For fast "type-anything" search across all 7,632:
1. `pnpm add minisearch` (not installed yet).
2. On Directory open, fetch the compact docs (either query `/directoryIndex` once and `buildSearchDoc` each, or ship a prebuilt payload — see `--dump`), build the index with `DIRECTORY_MINISEARCH_CONFIG`, and cache it (IndexedDB/localStorage).
3. Load lazily — **never at app boot**. Show a skeleton while it builds.
4. Invalidate cache when `/directoryMeta/status.lastChangeAt` or `schemaVersion` changes, and on user change / sign-out.

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
| `mergeContactData(survivorId, duplicateId)` | contacts | transaction; unions data + tombstones dup (see pending: server re-point of messages) |

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

- `DIRECTORY_SCHEMA_VERSION = 2` (in `lib/directory-core.ts`). Bump it whenever the entry shape or normalizer logic changes → forces re-index.
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

**Bulk import recipe:** `--lock` → run importer → `--rebuild` → `--unlock`.

---

## 9. Suggested UI structure

Keep it **isolated, lazy, read-only first.** Mirror existing screen conventions.

### Screens/components (proposed)
- `components/directory-screen.tsx` — entry: search bar + type tabs (People / Companies / Jobs / Other) + paginated list (reuse "Load 50 more").
- `components/directory-detail-screen.tsx` — one entity: header (name/subtitle/quality), contact points, company/job relations, (later) related messages.
- Search: MiniSearch built on open; empty-query shows paginated `/directoryIndex` by type.

### Wire into the app (`app/page.tsx`)
1. Add `"directory"` (and `"directory-detail"`) to the `Screen` union (line ~89) and to `SCREEN_DEPTH`.
2. Lazy-load like the others:
   `const DirectoryScreen = dynamic(() => import("@/components/directory-screen").then(m => ({ default: m.DirectoryScreen })), { ssr: false })`
3. Render gated by `!showScreenSkeleton && activeScreen === "directory"` (see the block around line ~1450). Reuse `AppScreenSkeleton` while loading.
4. Add a nav entry point (menu) and `navigateTo("directory")`.

### Design consistency (reuse, don't reinvent)
- Loading: `components/app-loading-screen.tsx` (`AppScreenSkeleton`, `MessageSkeleton`), `animate-pulse`, `bg-white/8`.
- Pagination: the 50-at-a-time "Load 50 more · X remaining" pattern in `people-screen.tsx`.
- Glass modal / sheet styling: `global-search-sheet.tsx`, `tag-sheet.tsx`.
- Search scoring for local lists: `lib/smart-search.ts` already exists (used for contacts/contexts) — MiniSearch is for the global cross-type index.

---

## 10. Pending before / during the UI

- **`mergeContactsServer` Cloud Function**: re-point message `contactIds` duplicate→survivor and delete the tombstoned dup (client `mergeContactData` only merges contact data — messages need Admin SDK).
- **Favorites / recents**: not designed. Suggest a per-user subcollection (`users/{uid}/directoryFavorites`, `…/directoryRecents`) so it never touches `/directoryIndex`.
- **Messages↔Directory relations**: `projectMessageRelatedEntityIds()` exists (unused). When showing related messages, **reuse Communications' visibility filter** (same as the current stream/search) — do not expose hidden messages.
- **MiniSearch**: add the dependency + client cache + invalidation.
- **Tech debt**: the two `.mjs` scripts still carry ported normalizer copies (runtime app + functions already share `lib/directory-core.ts`).

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
| `firestore.rules` / `.secure` | access rules (directoryIndex/meta/control) |

---

## 12. Quick-start checklist for the UI session

1. `pnpm add minisearch`.
2. Create `components/directory-screen.tsx` (search + tabs + paginated list).
3. Add `"directory"` to `Screen` + `SCREEN_DEPTH`, lazy-import, render gate, nav entry (`app/page.tsx`).
4. Read `/directoryIndex` (paginate by type) for lists; build MiniSearch on open for search; cache + invalidate via `/directoryMeta`.
5. Detail screen reads the source doc for full/editable fields.
6. (Editable phase) wire buttons to `lib/directory-writes.ts`; show optimistic UI; expect index refresh in ~seconds.
7. Keep Communications untouched; reuse skeletons, pagination, and glass styling.
