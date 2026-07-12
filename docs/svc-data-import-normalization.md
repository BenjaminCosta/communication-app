# SVC Data Import & Normalization

> How the legacy company database (`New Database.xlsx`) was imported and
> normalized into Firestore `/contacts` and `/contexts` — the pipeline, the
> table-by-table mapping, the normalization rules, deduplication, and results.
>
> This is the **upstream** layer. `/contacts` + `/contexts` are the sources of
> truth; the **SVC Directory** (`/directoryIndex`) is derived from them later —
> see `docs/svc-directory-ui-context.md`.

---

## 0. TL;DR

- Source: one Excel workbook, **`New Database.xlsx`** (legacy company DB), 6 sheets.
- Pipeline: `scripts/parse-database-xlsx.py` (XLSX → JSON) → `scripts/import-database-xlsx.mjs` (Firebase Admin SDK, batched writes).
- Result: **4,760 contacts** + **2,617 contexts** (2,210 companies + 407 jobs). Later + 246 VCF + 2 manual contacts and 7 manual contexts → current totals **5,008 / 2,624**.
- Contacts (people) come from the **Contacts** and **Users** sheets → `/contacts`.
- **Companies** and **Jobs** sheets → `/contexts` (with a typed `fields[]` array).
- **Job Contacts** and **Roles** sheets are relational lookups (not imported directly).
- Everything imported as **global**; heavy dedup; full provenance stamped.

---

## 1. Pipeline

```
New Database.xlsx
      │
      ▼  scripts/parse-database-xlsx.py   (pure stdlib: unzips the .xlsx, reads
      │                                     sharedStrings + each sheet's XML,
      │                                     emits { SheetName: [ {header: value} ] } JSON)
      ▼
   workbook JSON  (stdin → import script via execFileSync python3)
      │
      ▼  scripts/import-database-xlsx.mjs (firebase-admin)
      │     • reads existing /contacts + /contexts (to seed dedup)
      │     • lists registered users (Auth + /users) for email→uid linking
      │     • builds cross-sheet lookups
      │     • maps + normalizes every row
      │     • dedups
      │     • writes in batches of 400
      ▼
  /contacts   (person rows)
  /contexts   (company + job rows)
```

**Run:**
```bash
# Dry run (default — prints plan, no writes):
OWNER_UID=<uid> GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/import-database-xlsx.mjs "New Database.xlsx"

# Real import:
DRY_RUN=false CONFIRM_IMPORT=true OWNER_UID=<uid> \
  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/import-database-xlsx.mjs "New Database.xlsx"
```
`OWNER_UID` is required even for dry-run (global contacts still need an owner).

---

## 2. The six sheets

| Sheet | Rows meaning | Imported as | Notes |
|---|---|---|---|
| **Contacts** | People/contacts | `/contacts` (person) | main people table (4,705) |
| **Users** | Internal system users | `/contacts` (person) | 55 people |
| **Companies** | Organizations | `/contexts` (company) | 2,210 |
| **Jobs** | Projects/jobs | `/contexts` (job) | 407 |
| **Job Contacts** | Job↔Contact relation | (lookup only) | builds Jobs' "Related Contacts" |
| **Roles** | Role/position catalog | (lookup only) | resolves role/position ids → names |

---

## 3. Cross-sheet lookups (built once)

- `companyById`: `upper(Companies.unique_id)` → company row (resolves a contact's `Company` id to a real company name).
- `roleById`: `lower(Roles.ROW_ID)` → `Roles.Name` (resolves `Position`/`Role` ids to names).
- `contactBySourceId`: `upper(Contacts.Key)` → contact row (resolves PM / related-contact references).
- `jobContactsByJob`: Job Contacts grouped by `upper(Job)` → the job's contacts.
- `registeredEmailToUid`: from `listRegisteredUsers()` (Firebase Auth `listUsers` + `/users` docs) → links an imported contact to a real account when the email matches.

---

## 4. Table-by-table mapping & normalization

### 4.1 Contacts sheet → `/contacts` (person)

| Firestore field | Source / rule |
|---|---|
| `name` | `clean(Name)` ‖ email ‖ phone ‖ sourceId (never blank) |
| `email`, `emailNormalized` | `normalizeEmail(Email)` (trim + lowercase) |
| `phone`, `phoneNormalized` | `displayPhone` / `normalizePhone(Phone Number)` |
| `emails[]` | `[{ label:"email", value, normalized, isPrimary:true }]` if email |
| `phones[]` | `[{ label:"phone", value, normalized, isPrimary:true }]` if phone |
| `emailNormalizedCandidates` | `[email]` (used later for account-linking) |
| `company`, `companies[]` | `companyById[upper(Company)].Name` ‖ `clean(Company)` |
| `role`, `roles[]` | `Job Title` ‖ `roleById[lower(Position)]` ‖ `clean(Position)`; roles = unique of both |
| `notes` | `Type` (unless it's the junk value "a whiteboard!") |
| `addresses[]` | `[{ label:"address", formatted: clean(Address) }]` |
| `urls[]` | `[{ label:"Photo", value: clean(Photo) }]` |
| `linkedUserId` | `registeredEmailToUid[email]` ‖ null |
| `status` | `"registered"` if linked, else `"not_registered"` |
| `source` | `"database"` |
| `visibility` | `"global"` |
| `sourceSheet` | `"Contacts"` |
| `sourceRecordId` | `upper(Key)` |
| `sourceCompanyId` | `upper(Company)` — **stable link to the company** |
| `sourcePositionId` | `lower(Position)` |
| `oldVonXKey`, `oldVonXCompanyKey` | legacy keys, preserved |
| `importBatchId`, `sourceDatabaseFile` | provenance |
| `createdAt`, `updatedAt` | `serverTimestamp()` |

### 4.2 Users sheet → `/contacts` (person)

Same person shape, from user rows:
- `name` = `clean(Username)` ‖ email
- `role`/`roles` = `roleById[lower(Role)]` ‖ `clean(Role)`
- `notes` = `Active` value only if it's not literally "true"/"false"
- `sourceSheet` = `"Users"`, `sourceRecordId` = email ‖ Username
- extra provenance: `sourceRoleId` = `lower(Role)`, `sourceCurrentJobId` = `Current Job`, `geolocation` = `Geolocation`

### 4.3 Companies sheet → `/contexts` (company)

- `name` = `clean(Name)`, `description` = `clean(Description)`
- `fields[]` (label/value pairs, empties dropped):
  `Kind="Company"`, `Source Sheet`, `Source ID`, `Phone`, `Address`, `Timezone`, `Website`, `Old VON X Key`, `Description`
- `sourceSheet="Companies"`, `sourceRecordId = upper(unique_id)`, `sourceDatabaseFile`

### 4.4 Jobs sheet → `/contexts` (job)

- `name` = `clean(Project Name)`; **on duplicate names** → `"{name} - {shortAddress|sourceId}"` (kept unique)
- `description` = `"Job status: {Status}"`
- `fields[]`: `Kind="Project/Job"`, `Source Sheet`, `Source ID`, `Date Added` (Excel serial → ISO via `excelDate`), `Address`, `Project Manager` (resolved to `Name / Email / Phone` via `contactBySourceId`), `Project Lead`, `Estimated Start Date`, `Confirmed Start Date`, `Duration in Weeks`, `Status`, `LatLong`, `Send Daily Report`, `Image Folder Url`, `Type`, `RIZZ`, `Job Rate`, `NET`, `Company`, `Related Contacts` (up to 20, built from Job Contacts)
- `sourceSheet="Jobs"`, `sourceRecordId = upper(Unique Id)`

> ⚠️ **Jobs "Company" ≠ a company.** In this workbook the Jobs `Company` column
> actually holds a **location** string (e.g. `"Long Branch, NJ"`). The Directory
> layer treats it as `location` and leaves job→company unresolved on purpose.

---

## 5. Normalization rules (helpers in the import script)

| Helper | What it does |
|---|---|
| `normalizeEmail` | trim + lowercase |
| `normalizePhone` | fixes scientific-notation (`5.15e9`), strips non-digits, drops a leading `1` on 11-digit US numbers |
| `displayPhone` | keeps the human phone, converting sci-notation to digits |
| `excelDate` | Excel serial (20000–70000) → `YYYY-MM-DD` (`(serial-25569)*86400*1000`) |
| `normalizeName` | lowercase + collapse whitespace (used for dedup) |
| `shortAddress` | first 2 comma segments, ≤60 chars (for unique job names) |
| `uniqueContextName` | appends a number until the name is unique |
| `unique` | dedupes a list by normalized name |
| `sanitize` / `cleanObject` | recursively strips `undefined` (Firestore rejects it) |
| `clean` / `upper` / `lower` | trim + case helpers |

---

## 6. Deduplication

**Contacts** (`addContact`) — seeded from existing `/contacts` first, then per-row:
- skip **no_contact_signal** — no name, or no email AND no phone
- skip **duplicate_source_id** — `sourceRecordId` already seen
- skip **duplicate_email** — normalized email already seen
- skip **duplicate_phone** — normalized phone already seen
- skip **duplicate_name_company** — same `name|company` (only when there's no email/phone to disambiguate)

**Contexts** (`addContext`):
- skip **blank_name**
- skip **duplicate_source_id** — `{sourceSheet}:{sourceRecordId}` already seen
- skip **duplicate_name** — same normalized name

Writes go out in **batches of 400** (`writeCollection`), each doc `sanitize`d.

---

## 7. Provenance stamped on every imported doc

`importBatchId` (unique per run), `sourceSheet`, `sourceRecordId`, `sourceDatabaseFile`, plus (contacts) `sourceCompanyId` / `sourcePositionId` and (jobs/companies) the `Source ID`/`Source Sheet` inside `fields[]`. This is what lets the Directory re-relate people to companies by **stable id** and lets audits trace anything back to its spreadsheet row.

---

## 8. Results

From the post-import audit (`scripts/audit-directory.mjs`):

| | Count |
|---|---|
| **/contacts** | 5,008 (database 4,760 · vcf 246 · manual 2) — sheets: Contacts 4,705 · Users 55 |
| **/contexts** | 2,624 (Companies 2,210 · Jobs 407 · manual/other 7) |
| Person→company **resolved** | 2,785 (85 unresolved: typos / companies not in the sheet) |
| Duplicate emails / phones / context names | 0 / 0 / 0 |
| Contacts linked to a real account | small (only where email matched a registered user) |

Data-quality warnings (not errors): people with no company (~2,138) or no role (~412); some companies missing phone/address/website; jobs whose `Company` is a location.

---

## 9. Known data issues & how they're handled downstream

| Issue | Origin | Handling |
|---|---|---|
| `#ERROR!`, `#N/A` in phones/values | broken spreadsheet cells | Directory layer strips them (`cleanValue`/`isInvalidValue`) — never surface as phone/email/search token |
| Jobs `Company` = a location | source schema quirk | Directory maps it to `location`; `companyEntityId` stays null (job→company deferred) |
| Scientific-notation phones (`5.15e9`) | Excel number formatting | `normalizePhone` converts to digits at import |
| Duplicate job names | source data | import disambiguates with address/sourceId suffix |
| ~85 unresolved company names | typos ("Managemnet") / companies absent | Directory re-relates by `sourceCompanyId` when possible; name mismatches remain unresolved until cleaned |

---

## 10. Re-importing safely (with the Directory live)

Because the sync Cloud Functions now derive `/directoryIndex` on every write, a
large re-import would trigger thousands of syncs. Wrap it:

```bash
# 1) suppress incremental sync
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/generate-directory-index.mjs --lock
# 2) run the import (writes /contacts + /contexts)
DRY_RUN=false CONFIRM_IMPORT=true OWNER_UID=<uid> GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/import-database-xlsx.mjs "New Database.xlsx"
# 3) rebuild the index in one controlled pass
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/generate-directory-index.mjs --rebuild
# 4) resume incremental sync
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/generate-directory-index.mjs --unlock
```

The import is **idempotent-ish**: it re-reads existing data and dedups, so a
re-run mostly skips already-present rows (see the skip reasons in §6).

---

## 11. File map

| File | Role |
|---|---|
| `scripts/parse-database-xlsx.py` | XLSX → JSON (stdlib only, no deps) |
| `scripts/import-database-xlsx.mjs` | maps + normalizes + dedups + writes `/contacts` + `/contexts` |
| `scripts/audit-directory.mjs` | read-only post-import audit (classification, relations, duplicates, quality) |
| `lib/store.ts` | `ImportedContact` / `AppContext` type definitions |
| `lib/vcf-import.ts` | the separate VCF import path (246 contacts), also global |
| `docs/svc-directory-ui-context.md` | the derived Directory layer built on top of this data |

---

## 12. Master Source of Truth enrichment (2026-07-10)

The curated `SVC_Directory_Master_Source_of_Truth(1).xlsx` is now the canonical
enrichment source on top of the original import. It does **not** replace or
delete existing `/contacts` or `/contexts` documents. Existing Firestore IDs,
legacy scalar values, message references and provenance are preserved; the
canonical correction lives in a versioned `masterData` map and Directory schema
v3 prefers that map for display/search/relations.

### Production result

| Collection / projection | Result |
|---|---:|
| `/contacts` | 5,183 (175 safe deterministic creates; existing docs enriched in place) |
| `/contexts` | 2,635 (1 company + 10 current jobs added; legacy exceptions preserved) |
| `/directoryRelations` | 6,618 safe, fully resolved relationships |
| `/directoryReviewQueue` | 496 issues (480 workbook + 16 comparison-generated) |
| `/directoryReferenceData` | 462 curated lookup/reference rows |
| `/directoryIndex` | 7,818 schema-v3 docs (5,183 people · 2,211 companies · 417 jobs · 7 other) |
| Job→company in index | 355 / 355 safe relations projected |
| Broken message refs | 0 contact · 0 context |
| Duplicate canonical IDs | 0 people · 0 contexts |

The 417 job source docs intentionally consist of 416 current master jobs plus
the preserved legacy `77E4BB68` (`O'REILLY AUTO`) exception. The 2,211 company
source docs consist of 2,210 master companies plus preserved legacy
`80BBE58F` (`G M Northrup`). Both exceptions are review-queued rather than
deleted or silently merged.

Three master people matched multiple existing Firestore documents and were not
auto-enriched; eleven otherwise-safe relationships depend on those endpoints.
All fourteen cases, plus the two legacy source exceptions, are represented by
deterministic generated review issues.

Shared emails/phones and repeated job names are not treated as duplicate entity
identity: the master deliberately keeps distinct canonical records when a
generic/shared signal is insufficient. `scripts/audit-directory.mjs` therefore
reports canonical-ID duplicates separately from shared signals/names.

### Commands

```bash
# Plan only
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/enrich-directory-from-master.mjs /path/to/master.xlsx

# Apply (wrap in Directory lock/rebuild/unlock for bulk operation)
DRY_RUN=false CONFIRM_MASTER_ENRICHMENT=true \
  GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/enrich-directory-from-master.mjs /path/to/master.xlsx --write

# Verify idempotency, counts, schema, relationships and message references
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/enrich-directory-from-master.mjs /path/to/master.xlsx --verify
```

The workbook SHA-256 applied in production is
`8600ab63e7d2bcd72ad319051827ac184c3d26724aa74283aad70d293f26db63`.
