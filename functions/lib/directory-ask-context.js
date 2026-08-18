"use strict";
// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/directory-ask-context.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASK_CONTEXT_MAX_TOKENS = exports.ASK_CONTEXT_MAX_TEXT_CHARS = exports.ASK_CONTEXT_MIN_TEXT_CHARS = exports.ASK_CONTEXT_VERSION = void 0;
exports.isIdentifierOnly = isIdentifierOnly;
exports.buildAskTextParts = buildAskTextParts;
exports.buildAskTokens = buildAskTokens;
exports.buildAskContext = buildAskContext;
/**
 * SVC Directory — `askContext` projection (framework-free).
 *
 * A small, versioned projection added to context-backed `/directoryIndex`
 * documents so Ask SVC Directory has safe, bounded AI context WITHOUT a second
 * source of truth and WITHOUT using the deliberately broad `searchText`.
 *
 * Per the Firestore audit:
 *  - the only good semantic text is the canonical description,
 *    `masterData.operationalNotes`, and `Related Contacts` when it isn't just ids;
 *  - root `description`, `masterData.description`, `operationalData.description`
 *    and `fields[].Description` duplicate each other → select ONE canonical value;
 *  - never include ids, hashes, import metadata, raw legacy fields, review
 *    metadata, rates, phone or address;
 *  - a record is AI-eligible only with ≥80 chars of deduplicated useful text
 *    (243 records today, ~187 chars average, 705 max).
 *
 * Pure and dependency-free so the Next server, the Cloud Function trigger and
 * the backfill script all produce byte-identical projections.
 */
exports.ASK_CONTEXT_VERSION = 1;
/** Minimum deduplicated useful text for a record to be worth embedding. */
exports.ASK_CONTEXT_MIN_TEXT_CHARS = 80;
/** Hard cap; the longest real candidate is 705 chars. */
exports.ASK_CONTEXT_MAX_TEXT_CHARS = 900;
exports.ASK_CONTEXT_MAX_TOKENS = 40;
function str(value) {
    return typeof value === "string" ? value.trim() : "";
}
function record(value) {
    return value && typeof value === "object" ? value : {};
}
function fieldList(value) {
    return Array.isArray(value) ? value : [];
}
/** Read a `fields[]` entry by label (the mirrored legacy sheet columns). */
function fieldValue(fields, label) {
    const hit = fields.find((entry) => str(entry.label).toLowerCase() === label.toLowerCase());
    return hit ? str(hit.value) : "";
}
/**
 * True when a value is just identifiers (no prose) — e.g. a "Related Contacts"
 * cell holding contact ids rather than names.
 */
function isIdentifierOnly(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return true;
    const parts = trimmed.split(/[,;|]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0)
        return true;
    return parts.every((part) => !part.includes(" ") && /^[A-Za-z0-9_-]+$/.test(part) && /\d/.test(part));
}
/** Strip anything that looks like a hash, id, url, phone or bare number run. */
function sanitize(value) {
    return value
        .replace(/\b[a-f0-9]{16,}\b/gi, " ") // content hashes / sha
        .replace(/\bhttps?:\/\/\S+/gi, " ") // urls
        .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, " ") // emails
        .replace(/\+?\d[\d\s().-]{7,}\d/g, " ") // phone numbers
        .replace(/\s{2,}/g, " ")
        .trim();
}
function normalizeForCompare(value) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}
/**
 * Select the canonical description, then add only text that is genuinely NEW.
 * Precedence matches the audit: root → masterData → operationalData → fields[].
 *
 * Eligibility is measured on `deduped` (pre-sanitization) — that is what the
 * audit's 243-record count reflects. Sanitization only shapes what we send to
 * the model, and must never decide whether a record is worth embedding.
 */
function buildAskTextParts(source) {
    const master = record(source.masterData);
    const operational = record(source.operationalData);
    const fields = fieldList(source.fields);
    const canonical = str(source.description) ||
        str(master.description) ||
        str(operational.description) ||
        fieldValue(fields, "Description");
    const extras = [
        str(master.operationalNotes) || str(operational.operationalNotes) || fieldValue(fields, "Operational Notes"),
        fieldValue(fields, "People involved") || fieldValue(fields, "Related Contacts"),
    ];
    const parts = [];
    const seen = new Set();
    const push = (raw) => {
        const trimmed = raw.trim();
        if (!trimmed)
            return;
        if (isIdentifierOnly(trimmed))
            return;
        const key = normalizeForCompare(trimmed);
        if (!key || seen.has(key))
            return;
        // Skip text already fully contained in what we have (near-duplicates).
        for (const existing of seen) {
            if (existing.includes(key))
                return;
        }
        seen.add(key);
        parts.push(trimmed);
    };
    push(canonical);
    for (const extra of extras)
        push(extra);
    const deduped = parts.join(" — ");
    const sanitized = cap(sanitize(deduped));
    return { deduped, sanitized };
}
function cap(value) {
    return value.length > exports.ASK_CONTEXT_MAX_TEXT_CHARS
        ? `${value.slice(0, exports.ASK_CONTEXT_MAX_TEXT_CHARS - 1)}…`
        : value;
}
const TOKEN_STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "has", "have",
    "inc", "llc", "ltd", "corp", "company", "services", "construction",
]);
/** Bounded, safe lexical tokens for candidate ranking (never ids or numbers). */
function buildAskTokens(source, aiText) {
    const master = record(source.masterData);
    const aliases = Array.isArray(master.aliases) ? master.aliases.filter((a) => typeof a === "string") : [];
    const haystack = [str(source.name), str(master.canonicalName), str(master.displayName), ...aliases, aiText].join(" ");
    const tokens = new Set();
    for (const raw of haystack.toLowerCase().split(/[^a-z0-9]+/)) {
        if (raw.length < 3 || raw.length > 24)
            continue;
        if (/^\d+$/.test(raw))
            continue; // bare numbers carry no lexical signal
        if (TOKEN_STOPWORDS.has(raw))
            continue;
        tokens.add(raw);
        if (tokens.size >= exports.ASK_CONTEXT_MAX_TOKENS)
            break;
    }
    return [...tokens];
}
/**
 * Build the full projection. `hash` is injected so this module stays free of
 * node:crypto (it is shared with client-safe code paths).
 */
function buildAskContext(contextId, source, hash) {
    const master = record(source.masterData);
    const type = str(source.directoryType);
    const { deduped, sanitized } = buildAskTextParts(source);
    const personIds = [str(master.projectManagerContactId), str(master.projectLeadContactId)].filter(Boolean);
    const companyIds = type === "company" ? [contextId] : [str(master.companyContextId)].filter(Boolean);
    const jobIds = type === "job" ? [contextId] : [];
    return {
        version: exports.ASK_CONTEXT_VERSION,
        personIds: [...new Set(personIds)],
        companyIds: [...new Set(companyIds)],
        jobIds,
        tokens: buildAskTokens(source, sanitized),
        aiText: sanitized,
        aiTextHash: sanitized ? hash(sanitized) : "",
        // Measured on the pre-sanitization text — see buildAskTextParts.
        aiEligible: deduped.length >= exports.ASK_CONTEXT_MIN_TEXT_CHARS,
    };
}
//# sourceMappingURL=directory-ask-context.js.map