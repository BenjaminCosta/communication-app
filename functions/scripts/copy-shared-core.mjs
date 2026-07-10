#!/usr/bin/env node
/**
 * Regenerates functions/src/directory-core.ts from the canonical
 * lib/directory-core.ts, so the Cloud Functions sync reuses the exact same
 * normalizer logic as the Next app — no hand-maintained duplication.
 *
 * Runs automatically as part of `pnpm build` in this functions package
 * (see package.json "build"). Never edit the generated file by hand.
 *
 * Paths are resolved relative to THIS script, so cwd doesn't matter
 * (works from repo root, from functions/, and from a Firebase predeploy hook).
 */

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))       // functions/scripts
const source = resolve(here, "../../lib/directory-core.ts") // repo/lib/directory-core.ts
const target = resolve(here, "../src/directory-core.ts")    // functions/src/directory-core.ts

const banner = `// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/directory-core.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
`

const body = readFileSync(source, "utf8")
writeFileSync(target, banner + "\n" + body)
console.log(`[copy-shared-core] ${source} -> ${target} (${body.length} bytes)`)
