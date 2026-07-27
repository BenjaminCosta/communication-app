#!/usr/bin/env node
/**
 * Regenerates the shared framework-free modules into functions/src so the Cloud
 * Functions runtime reuses the EXACT same normalizer + askContext projection
 * logic as the Next app — no hand-maintained duplication.
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

const here = dirname(fileURLToPath(import.meta.url)) // functions/scripts

/** Framework-free modules shared verbatim with the Cloud Functions runtime. */
const SHARED = [
  { source: "../../lib/directory-core.ts", target: "../src/directory-core.ts" },
  { source: "../../lib/directory-ask-context.ts", target: "../src/directory-ask-context.ts" },
  { source: "../../lib/applications-core.ts", target: "../src/applications-core.ts" },
]

const banner = `// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/directory-core.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
`

for (const entry of SHARED) {
  const source = resolve(here, entry.source)
  const target = resolve(here, entry.target)
  const body = readFileSync(source, "utf8")
  writeFileSync(target, banner.replace("lib/directory-core.ts", entry.source.replace("../../", "")) + "\n" + body)
  console.log(`[copy-shared-core] ${source} -> ${target} (${body.length} bytes)`)
}
