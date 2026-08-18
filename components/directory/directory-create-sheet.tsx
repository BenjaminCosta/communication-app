"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"
import { DirectoryEntityIcon } from "@/components/directory/directory-entity-icon"
import { cn } from "@/lib/utils"
import {
  createDirectoryEntity,
  DirectoryWriteError,
  type CreatedDirectoryEntity,
  type DirectoryInvolvedPerson,
  type NewDirectoryEntityType,
} from "@/lib/directory-writes"

interface DirectoryCreateSheetProps {
  userId: string
  companies: Array<{ sourceId: string; name: string }>
  people: Array<{ sourceId: string; name: string }>
  onClose: () => void
  onCreated: (entity: CreatedDirectoryEntity) => void
}

interface CreateValues {
  name: string
  role: string
  companyName: string
  email: string
  phone: string
  address: string
  website: string
  description: string
  status: string
  location: string
}

const EMPTY_VALUES: CreateValues = {
  name: "",
  role: "",
  companyName: "",
  email: "",
  phone: "",
  address: "",
  website: "",
  description: "",
  status: "",
  location: "",
}

const TYPE_OPTIONS: Array<{ type: NewDirectoryEntityType; title: string; description: string }> = [
  { type: "person", title: "New contact", description: "A person in the shared Directory." },
  { type: "company", title: "New company", description: "A shared company context for Communications." },
  { type: "job", title: "New job", description: "A shared job context for Communications." },
]

function titleFor(type: NewDirectoryEntityType): string {
  if (type === "person") return "New contact"
  if (type === "company") return "New company"
  return "New job"
}

function saveLabelFor(type: NewDirectoryEntityType): string {
  if (type === "person") return "Create contact"
  if (type === "company") return "Create company"
  return "Create job"
}

export function DirectoryCreateSheet({
  userId,
  companies,
  people,
  onClose,
  onCreated,
}: DirectoryCreateSheetProps) {
  const [type, setType] = useState<NewDirectoryEntityType | null>(null)
  const [values, setValues] = useState<CreateValues>(EMPTY_VALUES)
  const [involvedPeople, setInvolvedPeople] = useState<DirectoryInvolvedPerson[]>([])
  const [personQuery, setPersonQuery] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  const involvedIds = useMemo(() => new Set(involvedPeople.map((person) => person.id)), [involvedPeople])
  const matchingPeople = useMemo(() => {
    const query = personQuery.trim().toLowerCase()
    return people
      .filter((person) => !involvedIds.has(person.sourceId))
      .filter((person) => !query || person.name.toLowerCase().includes(query))
      .slice(0, 8)
  }, [involvedIds, people, personQuery])

  const setValue = (key: keyof CreateValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const selectType = (nextType: NewDirectoryEntityType) => {
    setType(nextType)
    setError("")
  }

  const addPerson = (person: { sourceId: string; name: string }) => {
    setInvolvedPeople((current) => [...current, { id: person.sourceId, name: person.name }])
    setPersonQuery("")
  }

  const removePerson = (id: string) => {
    setInvolvedPeople((current) => current.filter((person) => person.id !== id))
  }

  const save = async () => {
    if (!type || isSaving) return
    if (!values.name.trim()) {
      setError(`${type === "person" ? "Contact" : type === "company" ? "Company" : "Job"} name is required.`)
      return
    }

    const selectedCompany = type === "job"
      ? companies.find((company) => company.name.toLowerCase() === values.companyName.trim().toLowerCase())
      : undefined

    setIsSaving(true)
    setError("")
    try {
      const entity = await createDirectoryEntity(userId, {
        type,
        name: values.name,
        role: values.role,
        companyName: values.companyName,
        companyContextId: selectedCompany?.sourceId ?? null,
        involvedPeople: type === "person" ? [] : involvedPeople,
        email: values.email,
        phone: values.phone,
        address: values.address,
        website: values.website,
        description: values.description,
        status: values.status,
        location: values.location,
      })
      onCreated(entity)
    } catch (err) {
      setError(err instanceof DirectoryWriteError ? err.message : "This record could not be created. Try again.")
      setIsSaving(false)
    }
  }

  return (
    <div className="directory-glass-screen animate-slide-in-right absolute inset-0 z-30 flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="glass-panel app-topbar flex shrink-0 items-center justify-between border-b px-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="glass-button flex h-9 w-9 items-center justify-center rounded-full border active:scale-[0.96] disabled:opacity-40"
          aria-label="Cancel"
        >
          <X className="h-4 w-4 text-white/80" strokeWidth={1.8} />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">{type ? titleFor(type) : "Create in Directory"}</h2>
        <div className="w-9" aria-hidden="true" />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {!type ? (
            <>
              <p className="max-w-md text-sm leading-6 text-muted-foreground/70">
                Choose what you want to add. Companies and jobs become reusable Communications contexts automatically.
              </p>
              <div className="mt-5 space-y-3">
                {TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => selectType(option.type)}
                    className="glass-button flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-transform duration-150 active:scale-[0.985]"
                  >
                    <DirectoryEntityIcon item={{ type: option.type, name: option.title }} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground/90">{option.title}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground/55">{option.description}</span>
                    </span>
                    <span className="text-sm text-[var(--directory-title)]" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => { event.preventDefault(); void save() }}
              className="space-y-5"
            >
              <button
                type="button"
                onClick={() => { setType(null); setError("") }}
                disabled={isSaving}
                className="text-xs font-semibold text-[var(--directory-title)] active:scale-[0.97] disabled:opacity-40"
              >
                Change type
              </button>

              {error && (
                <p className="rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
                  {error}
                </p>
              )}

              <FormField label={type === "person" ? "Full name" : "Name"} required>
                <input
                  autoFocus
                  value={values.name}
                  onChange={(event) => setValue("name", event.target.value)}
                  placeholder={type === "person" ? "Jane Smith" : type === "company" ? "Acme Construction" : "Downtown renovation"}
                  className={inputClassName}
                />
              </FormField>

              {type === "person" && (
                <>
                  <FormField label="Role">
                    <input value={values.role} onChange={(event) => setValue("role", event.target.value)} placeholder="Project manager" className={inputClassName} />
                  </FormField>
                  <FormField label="Company">
                    <input value={values.companyName} onChange={(event) => setValue("companyName", event.target.value)} placeholder="Company name" list="directory-companies" className={inputClassName} />
                  </FormField>
                  <FormField label="Email">
                    <input type="email" value={values.email} onChange={(event) => setValue("email", event.target.value)} placeholder="jane@example.com" className={inputClassName} />
                  </FormField>
                  <FormField label="Phone">
                    <input type="tel" value={values.phone} onChange={(event) => setValue("phone", event.target.value)} placeholder="(555) 123-4567" className={inputClassName} />
                  </FormField>
                  <FormField label="Notes">
                    <textarea value={values.description} onChange={(event) => setValue("description", event.target.value)} rows={4} placeholder="Optional context for this contact" className={textareaClassName} />
                  </FormField>
                </>
              )}

              {type === "company" && (
                <>
                  <FormField label="Phone">
                    <input type="tel" value={values.phone} onChange={(event) => setValue("phone", event.target.value)} placeholder="(555) 123-4567" className={inputClassName} />
                  </FormField>
                  <FormField label="Address">
                    <input value={values.address} onChange={(event) => setValue("address", event.target.value)} placeholder="123 Main Street" className={inputClassName} />
                  </FormField>
                  <FormField label="Website">
                    <input type="url" value={values.website} onChange={(event) => setValue("website", event.target.value)} placeholder="example.com" className={inputClassName} />
                  </FormField>
                  <FormField label="Description">
                    <textarea value={values.description} onChange={(event) => setValue("description", event.target.value)} rows={4} placeholder="Optional company description" className={textareaClassName} />
                  </FormField>
                </>
              )}

              {type === "job" && (
                <>
                  <FormField label="Company">
                    <input value={values.companyName} onChange={(event) => setValue("companyName", event.target.value)} placeholder="Select or enter a company" list="directory-companies" className={inputClassName} />
                  </FormField>
                  <FormField label="Status">
                    <input value={values.status} onChange={(event) => setValue("status", event.target.value)} placeholder="Active" className={inputClassName} />
                  </FormField>
                  <FormField label="Location">
                    <input value={values.location} onChange={(event) => setValue("location", event.target.value)} placeholder="City or site" className={inputClassName} />
                  </FormField>
                  <FormField label="Address">
                    <input value={values.address} onChange={(event) => setValue("address", event.target.value)} placeholder="123 Main Street" className={inputClassName} />
                  </FormField>
                  <FormField label="Description">
                    <textarea value={values.description} onChange={(event) => setValue("description", event.target.value)} rows={4} placeholder="Optional job description" className={textareaClassName} />
                  </FormField>
                </>
              )}

              {type !== "person" && (
                <fieldset>
                  <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">People involved</legend>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">Add existing Directory contacts to keep this shared context connected to the people on it.</p>
                  {involvedPeople.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
                      {involvedPeople.map((person) => (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => removePerson(person.id)}
                          className="rounded-full border border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--directory-title)] active:scale-[0.97]"
                          aria-label={`Remove ${person.name}`}
                        >
                          {person.name} <span aria-hidden="true">×</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="Search contacts to add"
                    className={cn(inputClassName, "mt-3")}
                  />
                  <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
                    {matchingPeople.length > 0 ? matchingPeople.map((person) => (
                      <button
                        key={person.sourceId}
                        type="button"
                        onClick={() => addPerson(person)}
                        className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5 text-left last:border-b-0 active:bg-white/[0.04]"
                      >
                        <DirectoryEntityIcon item={{ type: "person", name: person.name }} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{person.name}</span>
                        <span className="text-xs font-semibold text-[var(--directory-title)]">Add</span>
                      </button>
                    )) : (
                      <p className="px-3 py-3 text-xs text-muted-foreground/50">No additional contacts match.</p>
                    )}
                  </div>
                </fieldset>
              )}

              <datalist id="directory-companies">
                {companies.map((company) => <option key={company.sourceId} value={company.name} />)}
              </datalist>

              <button
                type="submit"
                disabled={isSaving}
                className="flex h-11 w-full items-center justify-center rounded-xl border border-[var(--directory-title)]/35 bg-[var(--directory-title)]/[0.14] px-4 text-sm font-semibold text-[var(--directory-title)] transition-transform active:scale-[0.985] disabled:opacity-45"
              >
                {isSaving ? "Creating…" : saveLabelFor(type)}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

const inputClassName = "w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-white/20 focus:outline-none"
const textareaClassName = `${inputClassName} resize-none leading-6`

function FormField({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">
        {label}{required && <span className="ml-1 text-[var(--directory-title)]">*</span>}
      </span>
      {children}
    </label>
  )
}
