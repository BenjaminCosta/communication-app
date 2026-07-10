/**
 * SVC Directory — derived data layer for unified search and presentation.
 *
 * This is the Next-app entry point. All logic lives in ./directory-core
 * (a framework-free single source of truth shared with the Cloud Functions
 * sync). This file only re-exports it, so existing imports keep working.
 *
 * The core is authored once in lib/directory-core.ts. The Cloud Functions
 * build regenerates functions/src/directory-core.ts from it — never edit the
 * generated copy. See scripts/ for the bulk generator / audit tooling.
 */

export * from "./directory-core"
