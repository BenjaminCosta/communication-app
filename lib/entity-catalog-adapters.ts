import type { DirectorySearchIndex } from "@/lib/directory-search"
import type { AppContext, ImportedContact } from "@/lib/store"

const CATALOG_DATE = new Date(0)

export function importedContactsFromCatalog(index: DirectorySearchIndex): ImportedContact[] {
  return index.byType.person.map((entry) => {
    const phoneNormalized = entry.phoneDisplay.replace(/\D/g, "")
    return {
      id: entry.sourceId,
      ownerUserId: entry.ownerUserId,
      name: entry.name,
      email: entry.email || undefined,
      emailNormalized: entry.email.toLowerCase() || undefined,
      phone: entry.phoneDisplay || undefined,
      phoneNormalized: phoneNormalized || undefined,
      source: "database",
      tags: entry.tags,
      company: entry.companyName || undefined,
      role: entry.role || undefined,
      linkedUserId: entry.linkedUserId || null,
      status: entry.status === "registered" || entry.linkedUserId ? "registered" : "not_registered",
      visibility: "global",
      createdAt: CATALOG_DATE,
      updatedAt: CATALOG_DATE,
    }
  })
}

export function appContextsFromCatalog(index: DirectorySearchIndex): AppContext[] {
  return ([...index.byType.company, ...index.byType.job, ...index.byType.other]).map((entry) => ({
    id: entry.sourceId,
    name: entry.name,
    description: entry.description || undefined,
    fields: [],
    fieldCount: entry.fieldCount,
    createdBy: "",
    createdAt: CATALOG_DATE,
    updatedAt: CATALOG_DATE,
  }))
}
