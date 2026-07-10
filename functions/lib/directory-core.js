"use strict";
// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: lib/directory-core.ts (repo root).
// Regenerate with: pnpm --prefix functions build  (or node functions/scripts/copy-shared-core.mjs)
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTORY_MINISEARCH_CONFIG = exports.CONTEXT_TYPES = void 0;
exports.directoryId = directoryId;
exports.parseDirectoryId = parseDirectoryId;
exports.contextCompositeIds = contextCompositeIds;
exports.buildSearchDoc = buildSearchDoc;
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
exports.stripAccents = stripAccents;
exports.normalizeName = normalizeName;
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
    fields: ["name", "aliases", "keywords", "companyName", "location", "role"],
    storeFields: ["type", "name", "subtitle", "companyName", "location"],
    searchOptions: {
        boost: { name: 3, aliases: 2, companyName: 1.5 },
        prefix: true,
        fuzzy: 0.2,
    },
};
function buildSearchDoc(entry) {
    return {
        id: entry.id,
        type: entry.type,
        name: entry.name,
        aliases: entry.aliases.join(" "),
        keywords: entry.keywords.join(" "),
        companyName: entry.companyName ?? "",
        location: entry.location ?? "",
        role: entry.role ?? "",
        subtitle: entry.subtitle ?? "",
    };
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
    return {
        type: "person",
        sourceCollection: "contacts",
        sourceId: contact.id,
        name: contact.name ?? "",
        emails: contact.emails ?? (contact.email ? [{ label: "email", value: contact.email, normalized: contact.emailNormalized }] : []),
        phones: contact.phones ?? (contact.phone ? [{ label: "phone", value: contact.phone, normalized: contact.phoneNormalized }] : []),
        addresses: contact.addresses ?? [],
        urls: contact.urls ?? [],
        company: contact.company ?? null,
        companies: contact.companies ?? (contact.company ? [contact.company] : []),
        role: contact.role ?? null,
        roles: contact.roles ?? (contact.role ? [contact.role] : []),
        tags: contact.tags ?? [],
        notes: contact.notes ?? null,
        linkedUserId: contact.linkedUserId ?? null,
        source: contact.source ?? "unknown",
        sourceSheet: contact.sourceSheet ?? null,
        sourceRecordId: contact.sourceRecordId ?? null,
        sourceCompanyId: contact.sourceCompanyId ?? null,
        visibility: contact.visibility ?? "private",
    };
}
function normalizeCompanyContext(ctx) {
    const fields = ctx.fields ?? [];
    return {
        type: "company",
        sourceCollection: "contexts",
        sourceId: ctx.id,
        name: ctx.name ?? "",
        description: ctx.description ?? null,
        phone: getFieldValue(fields, "Phone"),
        address: getFieldValue(fields, "Address"),
        timezone: getFieldValue(fields, "Timezone"),
        website: getFieldValue(fields, "Website"),
        sourceSheet: ctx.sourceSheet ?? null,
        sourceRecordId: ctx.sourceRecordId ?? null,
        fields,
    };
}
function normalizeJobContext(ctx) {
    const fields = ctx.fields ?? [];
    return {
        type: "job",
        sourceCollection: "contexts",
        sourceId: ctx.id,
        name: ctx.name ?? "",
        description: ctx.description ?? null,
        address: getFieldValue(fields, "Address"),
        // The Jobs "Company" column holds a location string, not a company name.
        location: getFieldValue(fields, "Company"),
        companyEntityId: null,
        projectManager: getFieldValue(fields, "Project Manager"),
        projectLead: getFieldValue(fields, "Project Lead"),
        status: getFieldValue(fields, "Status"),
        estimatedStartDate: getFieldValue(fields, "Estimated Start Date"),
        confirmedStartDate: getFieldValue(fields, "Confirmed Start Date"),
        durationWeeks: getFieldValue(fields, "Duration in Weeks"),
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
function buildPersonIndex(person, ctx = {}) {
    const now = ctx.now ?? new Date();
    const primaryEmail = person.emails.find(e => e.isPrimary)?.value ?? person.emails[0]?.value ?? null;
    const primaryPhone = person.phones.find(p => p.isPrimary)?.value ?? person.phones[0]?.value ?? null;
    const location = person.addresses[0]?.locality ?? extractLocality(person.addresses[0]?.formatted) ?? null;
    const subtitle = [person.role, person.company].filter(Boolean).join(" @ ") || null;
    const companyEntityId = person.company ? (ctx.resolveCompanyId?.(person.company) ?? null) : null;
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
    return {
        id: directoryId("person", person.sourceId),
        type: "person",
        sourceCollection: "contacts",
        sourceId: person.sourceId,
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
        sourceSheet: person.sourceSheet,
        sourceRecordId: person.sourceRecordId,
        quality,
        updatedAt: now,
    };
}
function buildCompanyIndex(company, ctx = {}) {
    const now = ctx.now ?? new Date();
    const location = extractLocality(company.address) ?? null;
    const subtitle = [company.address, company.phone].filter(Boolean).join(" | ") || company.description || null;
    const aliases = uniqueStrings([extractDomain(company.website)]);
    // Include the full address so city/street tokens are searchable in the
    // compact index (the raw address is not shipped to MiniSearch otherwise).
    const keywords = extractKeywords([company.name, company.description, company.address, location]);
    const searchText = lowerJoin([
        company.name, company.description, company.phone,
        company.address, company.timezone, company.website,
        ...company.fields.map(f => f.value),
    ]);
    const quality = companyQuality(company);
    return {
        id: directoryId("company", company.sourceId),
        type: "company",
        sourceCollection: "contexts",
        sourceId: company.sourceId,
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
        sourceSheet: company.sourceSheet,
        sourceRecordId: company.sourceRecordId,
        quality,
        updatedAt: now,
    };
}
function buildJobIndex(job, ctx = {}) {
    const now = ctx.now ?? new Date();
    const location = job.location ?? extractLocality(job.address) ?? null;
    const subtitle = [job.status, job.location, job.address].filter(Boolean).join(" | ") || job.description || null;
    const aliases = [];
    // PM/Lead fields are "Name / email / phone" — keep only the name segment so
    // keywords aren't polluted with email/phone fragments. Add the address for
    // searchable city tokens.
    const keywords = extractKeywords([job.name, job.status, location, job.address, nameSegment(job.projectManager), nameSegment(job.projectLead)]);
    const searchText = lowerJoin([
        job.name, job.description, job.address, job.location,
        job.projectManager, job.projectLead, job.status, job.relatedContacts,
        ...job.fields.map(f => f.value),
    ]);
    const quality = jobQuality(job);
    return {
        id: directoryId("job", job.sourceId),
        type: "job",
        sourceCollection: "contexts",
        sourceId: job.sourceId,
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
        companyName: null,
        companyEntityId: job.companyEntityId,
        linkedUserId: null,
        sourceSheet: job.sourceSheet,
        sourceRecordId: job.sourceRecordId,
        quality,
        updatedAt: now,
    };
}
function buildOtherIndex(other, ctx = {}) {
    const now = ctx.now ?? new Date();
    const keywords = extractKeywords([other.name, other.description]);
    const searchText = lowerJoin([other.name, other.description, ...other.fields.map(f => f.value)]);
    return {
        id: directoryId("other", other.sourceId),
        type: "other",
        sourceCollection: other.sourceCollection,
        sourceId: other.sourceId,
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
        sourceSheet: other.sourceSheet,
        sourceRecordId: other.sourceRecordId,
        quality: {
            hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
            hasLocation: false, isLinkedUser: false,
            isComplete: !!other.name.trim(),
            issues: other.name.trim() ? [] : ["Missing name"],
        },
        updatedAt: now,
    };
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
    const issues = [];
    if (!job.name.trim())
        issues.push("Missing name");
    if (!job.status)
        issues.push("No status");
    if (!hasLocation)
        issues.push("No location or address");
    return {
        hasEmail: false, hasPhone: false, hasCompany: false, hasRole: false,
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