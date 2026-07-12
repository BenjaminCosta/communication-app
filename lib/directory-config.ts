import type { DirectoryType } from "@/lib/directory"

export type DirectoryScope = "all" | Extract<DirectoryType, "person" | "company" | "job">

export interface DirectoryListItem {
  id: string
  type: Exclude<DirectoryScope, "all">
  name: string
  subtitle: string
  companyName: string
  location: string
  role: string
  /** Optional richer one-line description (populated once the index carries it). */
  description?: string
  score?: number
}

export const DIRECTORY_SCOPES: Array<{
  id: DirectoryScope
  label: string
}> = [
  { id: "all", label: "All" },
  { id: "person", label: "People" },
  { id: "company", label: "Companies" },
  { id: "job", label: "Jobs" },
]

export const DIRECTORY_ENTITY_META: Record<Exclude<DirectoryScope, "all">, {
  singular: string
  plural: string
  color: string
  softBackground: string
  border: string
}> = {
  person: {
    singular: "Person",
    plural: "People",
    color: "var(--directory-person)",
    softBackground: "var(--directory-person-soft)",
    border: "var(--directory-person-border)",
  },
  company: {
    singular: "Company",
    plural: "Companies",
    color: "var(--directory-company)",
    softBackground: "var(--directory-company-soft)",
    border: "var(--directory-company-border)",
  },
  job: {
    singular: "Job",
    plural: "Jobs",
    color: "var(--directory-job)",
    softBackground: "var(--directory-job-soft)",
    border: "var(--directory-job-border)",
  },
}

export function isDirectoryEntityType(value: unknown): value is DirectoryListItem["type"] {
  return value === "person" || value === "company" || value === "job"
}
