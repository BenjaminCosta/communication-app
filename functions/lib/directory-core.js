"use strict";
// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/directory-core.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTORY_MINISEARCH_CONFIG = exports.CONTEXT_TYPES = exports.DIRECTORY_SEARCH_SHARD_COUNT = exports.DIRECTORY_SCHEMA_VERSION = void 0;
exports.directoryId = directoryId;
exports.parseDirectoryId = parseDirectoryId;
exports.contextCompositeIds = contextCompositeIds;
exports.buildSearchDoc = buildSearchDoc;
exports.directorySearchShardId = directorySearchShardId;
exports.buildDirectorySearchShards = buildDirectorySearchShards;
exports.classifyContext = classifyContext;
exports.normalizeContact = normalizeContact;
exports.normalizeCompanyContext = normalizeCompanyContext;
exports.normalizeJobContext = normalizeJobContext;
exports.normalizeOtherContext = normalizeOtherContext;
exports.normalizeContext = normalizeContext;
exports.buildPersonIndex = buildPersonIndex;
exports.buildCompanyIndex = buildCompanyIndex;
exports.buildJobIndex = buildJobIndex;
exports.buildOtherIndex = buildOtherIndex;
exports.buildDirectoryIndex = buildDirectoryIndex;
exports.buildContactIndexEntry = buildContactIndexEntry;
exports.buildContextIndexEntry = buildContextIndexEntry;
exports.buildCompanyResolver = buildCompanyResolver;
exports.detectPersonCompanyRelations = detectPersonCompanyRelations;
exports.projectMessageRelatedEntityIds = projectMessageRelatedEntityIds;
exports.isInvalidValue = isInvalidValue;
exports.cleanValue = cleanValue;
exports.isLikelyEmail = isLikelyEmail;
exports.isLikelyPhone = isLikelyPhone;
exports.isLikelyUrl = isLikelyUrl;
exports.stripAccents = stripAccents;
exports.normalizeName = normalizeName;
exports.getFieldValue = getFieldValue;
/**
 * Bump when the index shape or normalizer logic changes. Rebuilds/functions
 * compare this against the stored schemaVersion to decide whether to re-index.
 *   1 — initial
 *   2 — adds schemaVersion/sourceUpdatedAt/indexedAt, validation, stable-id
 *       company resolution, alias accumulation
 *   3 — reads non-destructive masterData enrichment and resolves job→company
 *   4 — adds a compact shared catalog and deterministic search shards
 */
exports.DIRECTORY_SCHEMA_VERSION = 4;
exports.DIRECTORY_SEARCH_SHARD_COUNT = 32;
// ── Composite ID helpers ────────────────────────────────────────────────
function directoryId(type, sourceId) {
    return `${type}__${sourceId}`;
}
function parseDirectoryId(id) {
    const idx = id.indexOf("__");
    if (idx === -1)
        return null;
    const type = id.slice(0, idx);
    const sourceId = id.slice(idx + 2);
    if (!["person", "company", "job", "other"].includes(type) || !sourceId)
        return null;
    return { type, sourceId };
}
/** The context composite ids for a given source id — one per non-person type. */
exports.CONTEXT_TYPES = ["company", "job", "other"];
function contextCompositeIds(sourceId) {
    return exports.CONTEXT_TYPES.map((t) => directoryId(t, sourceId));
}
exports.DIRECTORY_MINISEARCH_CONFIG = {
    idField: "id",
    fields: ["name", "aliases", "email", "phone", "keywords", "companyName", "location", "role", "searchText"],
    // Search results are resolved through DirectorySearchIndex.byId; only type
    // must be duplicated inside MiniSearch for scope filtering.
    storeFields: ["type"],
    searchOptions: {
        boost: {
            name: 5,
            email: 4,
            phone: 4,
            aliases: 3,
            companyName: 2,
            role: 1.5,
            searchText: 0.35,
        },
        prefix: true,
        fuzzy: 0.2,
    },
};
function buildSearchDoc(entry) {
    return {
        id: entry.id,
        type: entry.type,
        sourceCollection: entry.sourceCollection,
        sourceId: entry.sourceId,
        ownerUserId: entry.ownerUserId ?? "",
        name: entry.name,
        aliases: entry.aliases.join(" "),
        email: entry.email ?? "",
        phone: [entry.phone ?? "", normalizePhoneDigits(entry.phone ?? "")].filter(Boolean).join(" "),
        phoneDisplay: entry.phone ?? "",
        keywords: entry.keywords.join(" "),
        companyName: entry.companyName ?? "",
        location: entry.location ?? "",
        role: entry.role ?? "",
        searchText: entry.searchText,
        subtitle: entry.subtitle ?? "",
        linkedUserId: entry.linkedUserId ?? "",
        status: entry.status ?? "",
        tags: entry.tags,
        description: entry.description ?? "",
        fieldCount: entry.fieldCount,
    };
}
/** FNV-1a keeps an entry in the same shard in browsers, scripts and Functions. */
function directorySearchShardId(id, shardCount = exports.DIRECTORY_SEARCH_SHARD_COUNT) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < id.length; index += 1) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return String(hash % shardCount).padStart(2, "0");
}
function buildDirectorySearchShards(entries, shardCount = exports.DIRECTORY_SEARCH_SHARD_COUNT) {
    const buckets = Array.from({ length: shardCount }, (_, index) => ({
        schemaVersion: exports.DIRECTORY_SCHEMA_VERSION,
        shardId: String(index).padStart(2, "0"),
        entries: [],
    }));
    for (const entry of entries) {
        const searchDoc = buildSearchDoc(entry);
        buckets[Number(directorySearchShardId(searchDoc.id, shardCount))].entries.push(searchDoc);
    }
    for (const bucket of buckets)
        bucket.entries.sort((a, b) => a.id.localeCompare(b.id));
    return buckets;
}
// ── Classification ──────────────────────────────────────────────────────
function classifyContext(ctx) {
    // 1. Explicit override, if present and valid — future-proof for Directory
    //    edits that stamp a directoryType on the source context.
    const explicit = String(ctx.directoryType ?? "").toLowerCase().trim();
    if (explicit === "company" || explicit === "job" || explicit === "other")
        return explicit;
    if (explicit === "person")
        return "other"; // contexts are never people; ignore bad override
    // 2. Legacy/import heuristics (kept for full backward compatibility)
    const fields = ctx.fields ?? [];
    const kind = getFieldValue(fields, "Kind")?.toLowerCase() ?? "";
    const sheet = (ctx.sourceSheet ?? "").toLowerCase();
    if (kind === "company" || sheet === "companies")
        return "company";
    if (kind === "project/job" || kind === "job" || sheet === "jobs")
        return "job";
    if (hasAnyField(fields, ["Phone", "Website", "Timezone"]))
        return "company";
    if (hasAnyField(fields, ["Project Manager", "Project Lead", "Duration in Weeks", "Job Rate"]))
        return "job";
    return "other";
}
// ── Normalizers ─────────────────────────────────────────────────────────
function normalizeContact(contact) {
    const master = contact.masterData;
    const masterCompanyIsSafe = (master?.companyMatchConfidence ?? 0) >= 0.75;
    // Drop spreadsheet-error / placeholder junk from contact points.
    const rawEmails = contact.emails ?? (contact.email ? [{ label: "email", value: contact.email, normalized: contact.emailNormalized }] : []);
    const rawPhones = contact.phones ?? (contact.phone ? [{ label: "phone", value: contact.phone, normalized: contact.phoneNormalized }] : []);
    const emails = uniqueContactPoints([
        ...(master?.emails ?? []).map((value, index) => ({ label: "email", value, normalized: value.toLowerCase(), isPrimary: index === 0 })),
        ...rawEmails,
    ], value => value.toLowerCase());
    const phones = uniqueContactPoints([
        ...(master?.phones ?? []).map((value, index) => ({ label: "phone", value, normalized: normalizePhoneDigits(value), isPrimary: index === 0 })),
        ...rawPhones,
    ], normalizePhoneDigits);
    const masterAddress = cleanValue(master?.address);
    const addresses = masterAddress
        ? [{ label: "address", formatted: masterAddress }, ...(contact.addresses ?? []).filter(a => normalizeName(a.formatted) !== normalizeName(masterAddress))]
        : (contact.addresses ?? []);
    const company = masterCompanyIsSafe ? (cleanValue(master?.companyName) ?? cleanValue(contact.company)) : cleanValue(contact.company);
    const role = cleanValue(master?.roleName) ?? cleanValue(contact.role);
    return {
        type: "person",
        sourceCollection: "contacts",
        sourceId: contact.id,
        ownerUserId: contact.ownerUserId ?? "",
        name: cleanValue(master?.displayName) ?? cleanValue(master?.canonicalName) ?? contact.name ?? "",
        emails,
        phones,
        addresses,
        urls: (contact.urls ?? []).filter(u => !isInvalidValue(u?.value)),
        company,
        companies: uniqueStrings([company, ...(contact.companies ?? (contact.company ? [contact.company] : []))].filter(c => !isInvalidValue(c))),
        role,
        roles: uniqueStrings([role, ...(contact.roles ?? (contact.role ? [contact.role] : []))].filter(r => !isInvalidValue(r))),
        tags: contact.tags ?? [],
        notes: cleanValue(master?.notes) ?? cleanValue(contact.notes),
        linkedUserId: contact.linkedUserId ?? null,
        status: contact.status === "registered" || contact.linkedUserId ? "registered" : "not_registered",
        source: contact.source ?? "unknown",
        sourceSheet: contact.sourceSheet ?? null,
        sourceRecordId: contact.sourceRecordId ?? null,
        sourceCompanyId: masterCompanyIsSafe ? (master?.companyId ?? contact.sourceCompanyId ?? null) : (contact.sourceCompanyId ?? null),
        companyContextId: masterCompanyIsSafe ? (master?.companyContextId ?? null) : null,
        // Contacts are global-only for now.
        visibility: contact.visibility ?? "global",
    };
}
function normalizeCompanyContext(ctx) {
    const fields = ctx.fields ?? [];
    const master = ctx.masterData;
    return {
        type: "company",
        sourceCollection: "contexts",
        sourceId: ctx.id,
        name: cleanValue(master?.displayName) ?? cleanValue(master?.canonicalName) ?? ctx.name ?? "",
        description: cleanValue(master?.description) ?? cleanValue(ctx.description),
        phone: cleanValue(master?.phone) ?? cleanValue(getFieldValue(fields, "Phone")),
        address: cleanValue(master?.address) ?? cleanValue(getFieldValue(fields, "Address")),
        timezone: cleanValue(getFieldValue(fields, "Timezone")),
        website: cleanValue(master?.website) ?? cleanValue(getFieldValue(fields, "Website")),
        aliases: uniqueStrings(master?.aliases ?? []),
        sourceSheet: ctx.sourceSheet ?? null,
        sourceRecordId: ctx.sourceRecordId ?? null,
        fields,
    };
}
function normalizeJobContext(ctx) {
    const fields = ctx.fields ?? [];
    const master = ctx.masterData;
    const companyContextId = cleanValue(master?.companyContextId);
    return {
        type: "job",
        sourceCollection: "contexts",
        sourceId: ctx.id,
        name: cleanValue(master?.canonicalName) ?? ctx.name ?? "",
        description: cleanValue(ctx.description),
        address: cleanValue(master?.address) ?? cleanValue(getFieldValue(fields, "Address")),
        // The Jobs "Company" column holds a location string, not a company name.
        location: cleanValue(master?.location) ?? cleanValue(getFieldValue(fields, "Location")) ?? cleanValue(getFieldValue(fields, "Company")),
        companyName: cleanValue(master?.companyName) ?? cleanValue(getFieldValue(fields, "Parent Company")),
        companyEntityId: companyContextId ? directoryId("company", companyContextId) : null,
        projectManager: cleanValue(master?.projectManagerName) ?? cleanValue(getFieldValue(fields, "Project Manager")),
        projectLead: cleanValue(master?.projectLeadName) ?? cleanValue(getFieldValue(fields, "Project Lead")),
        status: cleanValue(master?.status) ?? cleanValue(getFieldValue(fields, "Status")),
        estimatedStartDate: cleanValue(master?.estimatedStartDate) ?? getFieldValue(fields, "Estimated Start Date"),
        confirmedStartDate: cleanValue(master?.confirmedStartDate) ?? getFieldValue(fields, "Confirmed Start Date"),
        durationWeeks: master?.durationWeeks != null ? String(master.durationWeeks) : getFieldValue(fields, "Duration in Weeks"),
        relatedContacts: getFieldValue(fields, "Related Contacts"),
        sourceSheet: ctx.sourceSheet ?? null,
        sourceRecordId: ctx.sourceRecordId ?? null,
        fields,
    };
}
function normalizeOtherContext(ctx) {
    return {
        type: "other",
        sourceCollection: "contexts",
        sourceId: ctx.id,
        name: ctx.name ?? "",
        description: ctx.description ?? null,
        fields: ctx.fields ?? [],
        sourceSheet: ctx.sourceSheet ?? null,
        sourceRecordId: ctx.sourceRecordId ?? null,
    };
}
function normalizeContext(ctx) {
    switch (classifyContext(ctx)) {
        case "company": return normalizeCompanyContext(ctx);
        case "job": return normalizeJobContext(ctx);
        default: return normalizeOtherContext(ctx);
    }
}
/** Stamps versioning metadata and merges any extra aliases onto a built entry. */
function finalizeEntry(base, ctx, now) {
    const aliases = ctx.extraAliases && ctx.extraAliases.length
        ? uniqueStrings([...base.aliases, ...ctx.extraAliases])
        : base.aliases;
    return {
        ...base,
        aliases,
        schemaVersion: exports.DIRECTORY_SCHEMA_VERSION,
        sourceUpdatedAt: ctx.sourceUpdatedAt ?? null,
        indexedAt: now,
        updatedAt: now,
    };
}
function buildPersonIndex(person, ctx = {}) {
    const now = ctx.now ?? new Date();
    const primaryEmail = person.emails.find(e => e.isPrimary)?.value ?? person.emails[0]?.value ?? null;
    const primaryPhone = person.phones.find(p => p.isPrimary)?.value ?? person.phones[0]?.value ?? null;
    const location = person.addresses[0]?.locality ?? extractLocality(person.addresses[0]?.formatted) ?? null;
    const subtitle = [person.role, person.company].filter(Boolean).join(" @ ") || null;
    const companyEntityId = (person.companyContextId ? directoryId("company", person.companyContextId) : null) ??
        ctx.resolveCompanyIdForPerson?.(person) ??
        (person.company ? (ctx.resolveCompanyId?.(person.company) ?? null) : null);
    const emailLocalParts = person.emails
        .map(e => (e.normalized ?? e.value)?.split("@")[0])
        .filter(Boolean);
    const aliases = uniqueStrings([...emailLocalParts, ...person.companies]);
    const keywords = extractKeywords([
        person.name,
        person.role,
        ...person.roles,
        person.company,
        ...person.companies,
        ...person.tags,
        location,
    ]);
    const searchText = lowerJoin([
        person.name,
        ...person.emails.flatMap(e => [e.value, e.normalized]),
        ...person.phones.flatMap(p => [p.value, p.normalized]),
        person.company, ...person.companies,
        person.role, ...person.roles,
        person.notes,
        ...person.tags,
        ...person.addresses.map(a => a.formatted),
    ]);
    const quality = personQuality(person, companyEntityId);
    return finalizeEntry({
        id: directoryId("person", person.sourceId),
        type: "person",
        sourceCollection: "contacts",
        sourceId: person.sourceId,
        ownerUserId: person.ownerUserId || null,
        name: person.name,
        normalizedName: normalizeName(person.name),
        aliases,
        keywords,
        searchText,
        subtitle,
        email: primaryEmail,
        phone: primaryPhone,
        role: person.role,
        location,
        companyName: person.company,
        companyEntityId,
        linkedUserId: person.linkedUserId,
        status: person.status,
        tags: person.tags,
        description: person.notes,
        fieldCount: 0,
        sourceSheet: person.sourceSheet,
        sourceRecordId: person.sourceRecordId,
        quality,
    }, ctx, now);
}
function buildCompanyIndex(company, ctx = {}) {
    const now = ctx.now ?? new Date();
    const location = extractLocality(company.address) ?? null;
    const subtitle = [company.address, company.phone].filter(Boolean).join(" | ") || company.description || null;
    const aliases = uniqueStrings([...company.aliases, extractDomain(company.website)]);
    // Include the full address so city/street tokens are searchable in the
    // compact index (the raw address is not shipped to MiniSearch otherwise).
    const keywords = extractKeywords([company.name, company.description, company.address, location]);
    const searchText = lowerJoin([
        company.name, company.description, company.phone,
        company.address, company.timezone, company.website,
        ...company.fields.map(f => f.value),
    ]);
    const quality = companyQuality(company);
    return finalizeEntry({
        id: directoryId("company", company.sourceId),
        type: "company",
        sourceCollection: "contexts",
        sourceId: company.sourceId,
        ownerUserId: null,
        name: company.name,
        normalizedName: normalizeName(company.name),
        aliases,
        keywords,
        searchText,
        subtitle,
        email: null,
        phone: company.phone,
        role: null,
        location,
        companyName: null,
        companyEntityId: null,
        linkedUserId: null,
        status: null,
        tags: [],
        description: company.description,
        fieldCount: company.fields.length,
        sourceSheet: company.sourceSheet,
        sourceRecordId: company.sourceRecordId,
        quality,
    }, ctx, now);
}
function buildJobIndex(job, ctx = {}) {
    const now = ctx.now ?? new Date();
    const location = job.location ?? extractLocality(job.address) ?? null;
    const subtitle = [job.status, job.companyName, job.location, job.address].filter(Boolean).join(" | ") || job.description || null;
    const aliases = [];
    // PM/Lead fields are "Name / email / phone" — keep only the name segment so
    // keywords aren't polluted with email/phone fragments. Add the address for
    // searchable city tokens.
    const keywords = extractKeywords([job.name, job.status, job.companyName, location, job.address, nameSegment(job.projectManager), nameSegment(job.projectLead)]);
    const searchText = lowerJoin([
        job.name, job.description, job.address, job.location, job.companyName,
        job.projectManager, job.projectLead, job.status, job.relatedContacts,
        ...job.fields.map(f => f.value),
    ]);
    const quality = jobQuality(job);
    return finalizeEntry({
        id: directoryId("job", job.sourceId),
        type: "job",
        sourceCollection: "contexts",
        sourceId: job.sourceId,
        ownerUserId: null,
        name: job.name,
        normalizedName: normalizeName(job.name),
        aliases,
        keywords,
        searchText,
        subtitle,
        email: null,
        phone: null,
        role: null,
        location,
        companyName: job.companyName,
        companyEntityId: job.companyEntityId,
        linkedUserId: null,
        status: null,
        tags: [],
        description: job.description,
        fieldCount: job.fields.length,
        sourceSheet: job.sourceSheet,
        sourceRecordId: job.sourceRecordId,
        quality,
    }, ctx, now);
}
function buildOtherIndex(other, ctx = {}) {
    const now = ctx.now ?? new Date();
    const keywords = extractKeywords([other.name, other.description]);
    const searchText = lowerJoin([other.name, other.description, ...other.fields.map(f => f.value)]);
    return finalizeEntry({
        id: directoryId("other", other.sourceId),
        type: "other",
        sourceCollection: other.sourceCollection,
        sourceId: other.sourceId,
        ownerUserId: null,
        name: other.name,
        normalizedName: normalizeName(other.name),
        aliases: [],
        keywords,
        searchText,
        subtitle: other.description,
        email: null,
        phone: null,
        role: null,
        location: null,
        companyName: null,
        companyEntityId: null,
        linkedUserId: null,
        status: null,
        tags: [],
        description: other.description,
        fieldCount: other.fields.length,
        sourceSheet: other.sourceSheet,
        sourceRecordId: other.sourceRecordId,
        quality: {
            hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
            hasLocation: false, isLinkedUser: false,
            isComplete: !!other.name.trim(),
            issues: other.name.trim() ? [] : ["Missing name"],
        },
    }, ctx, now);
}
function buildDirectoryIndex(entry, ctx = {}) {
    switch (entry.type) {
        case "person": return buildPersonIndex(entry, ctx);
        case "company": return buildCompanyIndex(entry, ctx);
        case "job": return buildJobIndex(entry, ctx);
        case "other": return buildOtherIndex(entry, ctx);
    }
}
/** Convenience: raw Firestore contact doc → index entry. */
function buildContactIndexEntry(contact, ctx = {}) {
    return buildPersonIndex(normalizeContact(contact), ctx);
}
/** Convenience: raw Firestore context doc → index entry (type auto-classified). */
function buildContextIndexEntry(context, ctx = {}) {
    return buildDirectoryIndex(normalizeContext(context), ctx);
}
// ── Quality scoring ─────────────────────────────────────────────────────
function personQuality(person, companyEntityId) {
    const hasEmail = person.emails.length > 0;
    const hasPhone = person.phones.length > 0;
    const hasCompany = !!person.company;
    const hasRole = !!person.role;
    const hasLocation = person.addresses.length > 0;
    const isLinkedUser = !!person.linkedUserId;
    const issues = [];
    if (!person.name.trim())
        issues.push("Missing name");
    if (!hasEmail && !hasPhone)
        issues.push("No email or phone");
    if (!hasCompany)
        issues.push("No company");
    else if (!companyEntityId)
        issues.push("Company not resolved to an entity");
    if (!hasRole)
        issues.push("No role");
    return {
        hasEmail, hasPhone, hasCompany, hasRole, hasLocation, isLinkedUser,
        isComplete: !!person.name.trim() && (hasEmail || hasPhone),
        issues,
    };
}
function companyQuality(company) {
    const hasPhone = !!company.phone;
    const hasLocation = !!company.address;
    const hasWebsite = !!company.website;
    const issues = [];
    if (!company.name.trim())
        issues.push("Missing name");
    if (!hasPhone && !hasLocation && !hasWebsite)
        issues.push("No phone, address, or website");
    return {
        hasEmail: false, hasPhone, hasCompany: false, hasRole: false,
        hasLocation, isLinkedUser: false,
        isComplete: !!company.name.trim() && (hasPhone || hasLocation || hasWebsite),
        issues,
    };
}
function jobQuality(job) {
    const hasLocation = !!(job.location || job.address);
    const hasCompany = !!job.companyEntityId;
    const issues = [];
    if (!job.name.trim())
        issues.push("Missing name");
    if (!job.status)
        issues.push("No status");
    if (!hasLocation)
        issues.push("No location or address");
    return {
        hasEmail: false, hasPhone: false, hasCompany, hasRole: false,
        hasLocation, isLinkedUser: false,
        isComplete: !!job.name.trim(),
        issues,
    };
}
// ── Company resolver builder ────────────────────────────────────────────
function buildCompanyResolver(companies) {
    const byName = new Map();
    for (const c of companies) {
        byName.set(normalizeName(c.name), directoryId("company", c.sourceId));
    }
    return (name) => byName.get(normalizeName(name)) ?? null;
}
function detectPersonCompanyRelations(people, companies) {
    const resolve = buildCompanyResolver(companies);
    const companyById = new Map(companies.map(c => [directoryId("company", c.sourceId), c]));
    const relations = [];
    for (const person of people) {
        if (!person.company)
            continue;
        const compositeId = resolve(person.company);
        if (!compositeId)
            continue;
        const company = companyById.get(compositeId);
        relations.push({
            fromType: "person",
            fromId: directoryId("person", person.sourceId),
            fromName: person.name,
            toType: "company",
            toId: compositeId,
            toName: company.name,
            relation: person.role ?? "employee",
        });
    }
    return relations;
}
function projectMessageRelatedEntityIds(message, classifyContextId) {
    const ids = new Set();
    for (const cid of message.contactIds ?? [])
        ids.add(directoryId("person", cid));
    for (const ctxId of message.contextIds ?? [])
        ids.add(directoryId(classifyContextId(ctxId), ctxId));
    return [...ids];
}
// ── Validation / sanitization ────────────────────────────────────────────
// Imported spreadsheets carry spreadsheet error tokens (#ERROR!, #N/A, …) and
// placeholder junk. These must never surface as a phone/email/search token.
const INVALID_VALUE_RE = /^(#(error|n\/?a|ref|value|name|div\/0|num|null)!?|n\/?a|null|undefined|none|—|–|-|\.+)$/i;
/** True for empty/placeholder/spreadsheet-error values that should be dropped. */
function isInvalidValue(v) {
    if (v == null)
        return true;
    const t = String(v).trim();
    if (!t)
        return true;
    return INVALID_VALUE_RE.test(t);
}
/** Returns the trimmed value, or null if it is empty/invalid. */
function cleanValue(v) {
    return isInvalidValue(v) ? null : String(v).trim();
}
function normalizePhoneDigits(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
function uniqueContactPoints(points, normalize) {
    const seen = new Set();
    const result = [];
    for (const point of points) {
        if (isInvalidValue(point?.value))
            continue;
        const normalized = normalize(point.normalized ?? point.value);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        result.push({ ...point, normalized });
    }
    return result;
}
/** Loose email check — rejects junk but tolerant of legitimate imported addresses. */
function isLikelyEmail(v) {
    const t = cleanValue(v);
    return !!t && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}
/** Loose phone check — at least 7 digits after stripping formatting. */
function isLikelyPhone(v) {
    const t = cleanValue(v);
    return !!t && t.replace(/\D/g, "").length >= 7;
}
/** Loose URL check. */
function isLikelyUrl(v) {
    const t = cleanValue(v);
    return !!t && /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/.test(t);
}
// ── Text helpers ─────────────────────────────────────────────────────────
const STOPWORDS = new Set([
    "the", "and", "for", "inc", "llc", "co", "ltd", "of", "a", "an", "to", "in",
    "on", "at", "by", "with", "de", "la", "el", "los", "las",
]);
function stripAccents(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeName(value) {
    return stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
}
function tokenize(value) {
    return stripAccents(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}
function extractKeywords(values) {
    const set = new Set();
    for (const v of values) {
        if (!v)
            continue;
        for (const t of tokenize(v))
            set.add(t);
    }
    return [...set];
}
function uniqueStrings(values) {
    const set = new Set();
    for (const v of values) {
        const cleaned = (v ?? "").trim();
        if (cleaned)
            set.add(cleaned);
    }
    return [...set];
}
function lowerJoin(values) {
    return values.filter(Boolean).join(" ").toLowerCase();
}
/** Best-effort locality from a formatted address ("123 Main St, Trenton, NJ"). */
function extractLocality(formatted) {
    if (!formatted)
        return null;
    const parts = String(formatted).split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2)
        return parts.slice(-2).join(", ");
    return parts[0] ?? null;
}
function extractDomain(website) {
    if (!website)
        return null;
    const m = String(website).replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
    return m || null;
}
/** First segment of a "Name / email / phone" reference — the person's name. */
function nameSegment(value) {
    if (!value)
        return null;
    return String(value).split("/")[0].trim() || null;
}
function getFieldValue(fields, label) {
    if (!Array.isArray(fields))
        return null;
    const field = fields.find(f => f.label?.toLowerCase() === label.toLowerCase());
    return field?.value?.trim() || null;
}
function hasAnyField(fields, labels) {
    if (!Array.isArray(fields))
        return false;
    const normalized = new Set(labels.map(l => l.toLowerCase()));
    return fields.some(f => normalized.has(f.label?.toLowerCase()) && f.value?.trim());
}
//# sourceMappingURL=directory-core.js.map