# SVC Directory — Performance optimization rollout

> Implemented locally on 2026-07-13. This document describes the schema v4
> performance layer, its safe rollout, verification, and rollback. The source
> collections (`/contacts`, `/contexts`, `/messages`) remain unchanged.

## Outcome

- `/directorySearchShards` contains 32 deterministic compact catalog docs.
- `/directoryMeta/status` is the manifest and is updated only after a complete
  bulk shard write. Incremental source writes update their affected shards and
  manifest in one Firestore transaction.
- `/directoryIndex` remains the detail layer and fallback; its composite IDs,
  source IDs, provenance, and source-of-truth rules do not change.
- Communications can consume the same catalog as Directory and stop its global
  `/contacts` and `/contexts` listeners behind
  `NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true`.
- The rollback path is the existing listeners: omit the flag or set it to
  `false`. The safe default is off until the production backfills pass.

## Catalog contract

`EntityCatalogEntry` is compatible with `DirectorySearchDoc` and includes the
fields needed by Directory and Communications: composite/source IDs, source
collection, display/search fields, primary email and phone, linked-user status,
tags, description, field count, and `ownerUserId` for existing edit permissions.

The manifest fields are:

```text
searchRevision
searchSchemaVersion = 4
searchShardCount = 32
searchEntryCount
searchBuiltAt
```

The client reads one metadata doc and 32 shards on a cold valid catalog. If the
manifest or shard set is incomplete, it temporarily falls back to
`/directoryIndex`. IndexedDB returns the last catalog immediately and
revalidates in the background. MiniSearch construction runs in a Web Worker;
its cached index is gzip-compressed when the browser supports stream
compression. With the production payload, documents plus compressed search
index are approximately 7.33 MB instead of 11.69 MB uncompressed.

## Profile and secondary collections

- Index and source profile documents load in parallel; the last 20 profiles are
  kept in a small LRU for immediate/offline rendering.
- Favorites and recents have one shared subscription while Directory is open.
- Related initially reads 5 edges, then pages 50 at a time through
  `entityIds array-contains`; legacy directional reads remain only as rollout
  fallback.
- Notes and files subscribe to their newest 50 and page older records by cursor.
- Overview activity uses aggregate counts plus one newest record, not scans.
- A forced server reconciliation runs only if an iOS/PWA listener remains
  cache-only after 1.5 seconds.

## Production rollout

All write commands require the existing service account. Run in this order:

```bash
# 1. Local verification
pnpm test:directory
pnpm exec tsc --noEmit
pnpm functions:build
pnpm build

# 2. Deploy Firestore rules/indexes and Functions while the client flag is off.
#    The incremental function ignores shards until a complete manifest exists.

# 3. Preview the schema-v4 index/catalog build (read-only).
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/generate-directory-index.mjs --dry-run

# 4. Non-destructive upsert of directoryIndex, 32 shards, then manifest.
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  node scripts/generate-directory-index.mjs --write

# 5. Preview and apply the idempotent relation endpoint backfill.
pnpm backfill:directory-performance:dry
pnpm backfill:directory-performance

# 6. Repeat both dry-runs and verify counts/IDs/relations before enabling client.
# 7. Build/deploy client with NEXT_PUBLIC_USE_DIRECTORY_CATALOG=true.
```

Do not use `--rebuild` for the rollout: `--write` is sufficient and preserves
the derived collection while it upgrades entries in place. The relation script
refuses writes if any endpoint is invalid and requires the explicit
`CONFIRM_DIRECTORY_PERFORMANCE_BACKFILL=true` guard.

## Acceptance checks

- Manifest: schema 4, 32 shards, `searchEntryCount` equals unique shard entries
  and `/directoryIndex` count.
- Two consecutive builds produce the same composite IDs, search revision, and
  shard distribution.
- Relations retain 6,618 valid endpoints and every valid relation has exactly
  `[fromDirectoryId, toDirectoryId]` in `entityIds`.
- With the flag enabled, login produces no full `/contacts` or `/contexts`
  listeners; Directory cold catalog costs at most 33 reads (metadata + shards),
  or 35 allowing auxiliary state reads.
- Verify entities with 0, 1, 50, 51, and 141 relations and ranking by name,
  alias, email, phone, company, and role.
- Regression-test compose recipients, linked users, imports/deduplication,
  tags, context filters/detail/edit, calendar, message visibility, and realtime.

## Current verification status

Local unit tests, TypeScript, Cloud Functions compilation, the production Next
build, and an HTTP smoke test pass. A read-only production audit confirmed
5,183 contacts, 2,635 contexts, 7,818 index documents (5,183 people, 2,211
companies, 417 jobs, 7 other) and 6,618 valid relations. Production is still on
schema 3: all 7,818 index docs are v3, there are no search shards/manifest yet,
and all 6,618 relations need the idempotent `entityIds` backfill. No production
writes, deployment, or feature-flag activation was performed from this
workspace.

Two consecutive production dry-runs produced the same 7,818 expected IDs and
canonical search revision `62b31bcaa14f1dc6ed59`. The resulting 32 shard
payloads are 166,951–223,271 bytes each, comfortably below the guarded
800,000-byte ceiling and Firestore's document limit.

The relation audit also confirmed zero missing endpoints: 946 entities have no
relations, 5,103 have exactly one, and the maximum is one entity with 141.
Production currently has no entity with exactly 50 or 51 relations, so those
two cursor boundaries are covered by the unit suite instead.

On the real 7,818-entry payload, a desktop Node benchmark built MiniSearch in
~624 ms and returned representative searches in 0.6–14.4 ms. The top-10 IDs
were identical before/after for eight representative name, alias, email,
phone, company, role, company-name, and job-name queries. These numbers are a
local baseline, not mobile/4G P75 telemetry; that measurement still belongs in
the staged client rollout.
