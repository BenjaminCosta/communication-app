#!/usr/bin/env node

import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const expected = [
  "autoLinkOnRegister",
  "autoLinkOnUserEmailUpdate",
  "embedDirectoryAskContextOnWrite",
  "onDailyCalendarReminders",
  "onMessageCreated",
  "onMessageUpdated",
  "syncDirectoryOnContactWrite",
  "syncDirectoryOnContextWrite",
].sort()
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const actual = Object.keys(require(resolve(here, "../lib/index.js"))).sort()

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error("[verify-exports] Cloud Function exports changed unexpectedly.")
  console.error(JSON.stringify({ expected, actual }, null, 2))
  process.exit(1)
}

console.log(`[verify-exports] ${actual.length} Cloud Function exports verified.`)
