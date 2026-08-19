"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { DirectoryEntityIcon } from "@/components/directory/directory-entity-icon"
import { loadDirectorySearch } from "@/lib/directory-search"
import { loadDirectoryRelationsPage } from "@/lib/directory-relations"
import { parseDirectoryId, isLikelyEmail, isLikelyPhone } from "@/lib/directory"
import { cn } from "@/lib/utils"
import {
  getEditableFields,
  type DirectoryProfileViewModel,
} from "@/lib/directory-view-models"
import {
  applyDirectoryEdits,
  DirectoryWriteError,
  setContactCompanyContext,
  setContactEmails,
  setContactPhones,
  updateContactJobAssignments,
  updateDirectoryContextConnections,
  type DirectoryEditInput,
  type DirectoryInvolvedPerson,
} from "@/lib/directory-writes"

interface DirectoryEditSheetProps {
  vm: DirectoryProfileViewModel
  userId: string
  companies: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string }>
  onClose: () => void
  onSaved: () => void
}

const TITLES: Record<DirectoryProfileViewModel["type"], string> = {
  person: "Edit Contact",
  company: "Edit Company",
  job: "Edit Job",
  other: "Edit",
}

function sourceCompanyId(directoryId: string | null): string | null {
  return directoryId?.startsWith("company__") ? directoryId.slice("company__".length) : null
}

function currentInvolvedPeople(
  vm: DirectoryProfileViewModel,
  people: Array<{ id: string; name: string }>,
): DirectoryInvolvedPerson[] {
  if (vm.type !== "company" && vm.type !== "job") return []
  const peopleField = vm.overview.find((field) => field.label.toLowerCase() === "people involved")
  if (!peopleField?.value) return []
  const peopleByName = new Map(people.map((person) => [person.name.trim().toLowerCase(), person]))
  const seen = new Set<string>()
  return peopleField.value
    .split(",")
    .map((name) => peopleByName.get(name.trim().toLowerCase()))
    .filter((person): person is { id: string; name: string } => Boolean(person))
    .filter((person) => {
      if (seen.has(person.id)) return false
      seen.add(person.id)
      return true
    })
}

function samePeople(left: DirectoryInvolvedPerson[], right: DirectoryInvolvedPerson[]): boolean {
  return left.length === right.length && left.every((person, index) => person.id === right[index]?.id)
}

function sameJobSelection(selected: DirectoryInvolvedPerson[], initialIds: Set<string>): boolean {
  return selected.length === initialIds.size && selected.every((job) => initialIds.has(job.id))
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function DirectoryEditSheet({ vm, userId, companies, people, onClose, onSaved }: DirectoryEditSheetProps) {
  // The profile can open before the app-level Directory catalog is ready. Load
  // the same index used by + New so the relationship selectors never start
  // with an empty, non-searchable list.
  const [availableCompanies, setAvailableCompanies] = useState(companies)
  const [availablePeople, setAvailablePeople] = useState(people)
  const [availableJobs, setAvailableJobs] = useState<Array<{ id: string; name: string }>>([])
  const [isSelectorIndexLoading, setIsSelectorIndexLoading] = useState(
    companies.length === 0 || people.length === 0,
  )

  useEffect(() => {
    let active = true
    const applyIndex = (index: Awaited<ReturnType<typeof loadDirectorySearch>>) => {
      if (!active) return
      setAvailableCompanies(index.byType.company.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setAvailablePeople(index.byType.person.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setAvailableJobs(index.byType.job.map((entry) => ({ id: entry.sourceId, name: entry.name })))
      setIsSelectorIndexLoading(false)
    }

    setAvailableCompanies(companies)
    setAvailablePeople(people)
    if (companies.length > 0 && people.length > 0) {
      setIsSelectorIndexLoading(false)
    } else {
      setIsSelectorIndexLoading(true)
    }
    loadDirectorySearch(userId, { onCache: applyIndex })
      .then(applyIndex)
      .catch(() => { if (active) setIsSelectorIndexLoading(false) })

    return () => { active = false }
  }, [companies, people, userId])

  // A person's Jobs come from the live-synced /directoryRelations edges (see
  // functions/src/directory/sync.ts) rather than from `vm`/props, so this
  // always reflects the full set regardless of which profile tab was opened.
  const [selectedJobs, setSelectedJobs] = useState<DirectoryInvolvedPerson[]>([])
  const [initialJobIds, setInitialJobIds] = useState<Set<string> | null>(null)
  const [isJobsLoading, setIsJobsLoading] = useState(vm.type === "person")

  useEffect(() => {
    if (vm.type !== "person") { setInitialJobIds(new Set()); setIsJobsLoading(false); return }
    let active = true
    setIsJobsLoading(true)
    loadDirectoryRelationsPage(vm.id, null, 50)
      .then((page) => {
        if (!active) return
        const jobs = page.relations.jobs.map((job) => {
          const parsed = parseDirectoryId(job.id)
          return { id: parsed?.sourceId ?? job.id, name: job.name }
        })
        setSelectedJobs(jobs)
        setInitialJobIds(new Set(jobs.map((job) => job.id)))
      })
      .catch(() => { if (active) setInitialJobIds(new Set()) })
      .finally(() => { if (active) setIsJobsLoading(false) })
    return () => { active = false }
  }, [vm.id, vm.type])

  const initial = useMemo(() => {
    const fields = getEditableFields(vm)
    const values: Record<string, string> = {}
    for (const field of fields) values[field.key] = field.value
    const companyName = vm.type === "person" || vm.type === "job" ? vm.companyName ?? "" : ""
    return {
      fields,
      values,
      companyName,
      companyId: vm.type === "person" || vm.type === "job" ? sourceCompanyId(vm.companyEntityId) : null,
      involvedPeople: currentInvolvedPeople(vm, people),
      emails: vm.type === "person" ? vm.emails : [],
      phones: vm.type === "person" ? vm.phones : [],
    }
  }, [people, vm])

  const [values, setValues] = useState<Record<string, string>>(initial.values)
  const [companyName, setCompanyName] = useState(initial.companyName)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(initial.companyId)
  const [involvedPeople, setInvolvedPeople] = useState<DirectoryInvolvedPerson[]>(initial.involvedPeople)
  const [emails, setEmails] = useState<string[]>(initial.emails)
  const [phones, setPhones] = useState<string[]>(initial.phones)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")

  const formFields = useMemo(
    () => initial.fields.filter((field) => !(vm.type === "person" && (field.key === "company" || field.key === "active"))),
    [initial.fields, vm.type],
  )
  const allowsCompanySelection = vm.type === "person" || vm.type === "job"
  const allowsPeopleSelection = vm.type === "company" || vm.type === "job"
  const allowsJobSelection = vm.type === "person"
  const allowsContactListEditing = vm.type === "person"
  const fieldDirty = formFields.some((field) => (values[field.key] ?? "") !== (initial.values[field.key] ?? ""))
  const companyDirty = allowsCompanySelection && (
    companyName.trim() !== initial.companyName.trim() || selectedCompanyId !== initial.companyId
  )
  const peopleDirty = allowsPeopleSelection && !samePeople(involvedPeople, initial.involvedPeople)
  const jobsDirty = allowsJobSelection && initialJobIds !== null && !sameJobSelection(selectedJobs, initialJobIds)
  const emailsDirty = allowsContactListEditing && !sameStringList(emails, initial.emails)
  const phonesDirty = allowsContactListEditing && !sameStringList(phones, initial.phones)
  const dirty = fieldDirty || companyDirty || peopleDirty || jobsDirty || emailsDirty || phonesDirty

  const setValue = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const setCompany = (name: string, id: string | null) => {
    setCompanyName(name)
    setSelectedCompanyId(id)
    setError("")
  }

  const addPerson = (person: { id: string; name: string }) => {
    setInvolvedPeople((current) => current.some((selected) => selected.id === person.id)
      ? current
      : [...current, person])
    setError("")
  }

  const addJob = (job: { id: string; name: string }) => {
    setSelectedJobs((current) => current.some((selected) => selected.id === job.id)
      ? current
      : [...current, job])
    setError("")
  }

  const save = async () => {
    if (isSaving) return
    const edits: DirectoryEditInput = {}
    for (const field of formFields) {
      const next = values[field.key] ?? ""
      if (next !== (initial.values[field.key] ?? "")) edits[field.key] = next
    }
    if (vm.type === "person" && (values.active ?? "") !== (initial.values.active ?? "")) {
      edits.active = values.active ?? ""
    }
    if (!dirty) { onClose(); return }

    setIsSaving(true)
    setError("")
    try {
      if (Object.keys(edits).length > 0) {
        await applyDirectoryEdits(vm.sourceCollection, vm.sourceId, vm.type, edits)
      }
      if (vm.type === "person" && companyDirty) {
        await setContactCompanyContext(vm.sourceId, { id: selectedCompanyId, name: companyName })
      }
      if (vm.type === "person" && emailsDirty) {
        await setContactEmails(vm.sourceId, emails)
      }
      if (vm.type === "person" && phonesDirty) {
        await setContactPhones(vm.sourceId, phones)
      }
      if ((vm.type === "company" || vm.type === "job") && (peopleDirty || companyDirty)) {
        await updateDirectoryContextConnections(vm.sourceId, {
          ...(vm.type === "job" && companyDirty ? { company: { id: selectedCompanyId, name: companyName } } : {}),
          ...(peopleDirty ? { involvedPeople } : {}),
        })
      }
      if (vm.type === "person" && jobsDirty && initialJobIds) {
        const nextIds = new Set(selectedJobs.map((job) => job.id))
        await updateContactJobAssignments(
          { id: vm.sourceId, name: values.name?.trim() || vm.name },
          {
            addJobSourceIds: selectedJobs.filter((job) => !initialJobIds.has(job.id)).map((job) => job.id),
            removeJobSourceIds: [...initialJobIds].filter((id) => !nextIds.has(id)),
          },
        )
      }
      onSaved()
    } catch (err) {
      setError(err instanceof DirectoryWriteError ? err.message : "Changes could not be saved. Try again.")
      setIsSaving(false)
    }
  }

  return (
    <div className="directory-glass-screen !fixed inset-0 z-40 flex min-h-0 w-full flex-col overflow-hidden animate-slide-in-right">
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
        <h2 className="text-sm font-semibold text-foreground/90">{TITLES[vm.type]}</h2>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || !dirty}
          className={cn(
            "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-[0.97] disabled:opacity-40",
            "bg-[var(--directory-title)]/15 text-[var(--directory-title)]",
          )}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:px-6">
          {error && (
            <p className="mb-4 rounded-xl border border-orange-400/20 bg-orange-400/[0.06] px-4 py-3 text-xs text-orange-200/85" role="alert">
              {error}
            </p>
          )}
          <div className="space-y-5">
            {allowsContactListEditing && (
              <ValueListEditor
                label="Emails"
                hint="First one is the primary email."
                values={emails}
                placeholder="Add an email"
                inputType="email"
                validate={isLikelyEmail}
                onChange={setEmails}
              />
            )}

            {allowsContactListEditing && (
              <ValueListEditor
                label="Phones"
                hint="First one is the primary phone."
                values={phones}
                placeholder="Add a phone number"
                inputType="tel"
                validate={isLikelyPhone}
                onChange={setPhones}
              />
            )}

            {formFields.map((field) => (
              <FormField key={field.key} label={field.label}>
                {field.multiline ? (
                  <textarea
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    rows={4}
                    className={textareaClassName}
                  />
                ) : (
                  <input
                    type={field.inputType === "tel" ? "tel" : field.inputType === "email" ? "email" : field.inputType === "url" ? "url" : "text"}
                    value={values[field.key] ?? ""}
                    onChange={(event) => setValue(field.key, event.target.value)}
                    className={inputClassName}
                  />
                )}
              </FormField>
            ))}

            {allowsCompanySelection && (
              <CompanySelector
                companies={availableCompanies}
                isLoading={isSelectorIndexLoading}
                value={companyName}
                selectedId={selectedCompanyId}
                onChange={setCompany}
              />
            )}

            {allowsPeopleSelection && (
              <PeopleSelector
                people={availablePeople}
                isLoading={isSelectorIndexLoading}
                selectedPeople={involvedPeople}
                onAdd={addPerson}
                onRemove={(id) => setInvolvedPeople((current) => current.filter((person) => person.id !== id))}
              />
            )}

            {vm.type === "person" && (
              <StatusToggle value={values.active ?? ""} onChange={(next) => setValue("active", next)} />
            )}

            {allowsJobSelection && (
              <JobsSelector
                jobs={availableJobs}
                isLoading={isSelectorIndexLoading || isJobsLoading}
                selectedJobs={selectedJobs}
                onAdd={addJob}
                onRemove={(id) => setSelectedJobs((current) => current.filter((job) => job.id !== id))}
              />
            )}
          </div>
          <p className="mt-5 text-[11px] leading-5 text-muted-foreground/45">
            Edits update the shared context and Directory search across the app within a few seconds.
          </p>
        </div>
      </main>
    </div>
  )
}

function CompanySelector({
  companies,
  isLoading,
  value,
  selectedId,
  onChange,
}: {
  companies: Array<{ id: string; name: string }>
  isLoading: boolean
  value: string
  selectedId: string | null
  onChange: (name: string, id: string | null) => void
}) {
  const query = value.trim().toLowerCase()
  const matches = companies
    .filter((company) => !query || company.name.toLowerCase().includes(query))
    .slice(0, 8)
  const selected = companies.find((company) => company.id === selectedId)

  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Company</legend>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">Choose an existing Company context or enter a name.</p>
      {selected && (
        <button
          type="button"
          onClick={() => onChange("", null)}
          className="mt-3 rounded-full border border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--directory-title)] active:scale-[0.97]"
          aria-label={`Remove ${selected.name}`}
        >
          {selected.name} <span aria-hidden="true">×</span>
        </button>
      )}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value, null)}
        placeholder="Search companies"
        className={cn(inputClassName, "mt-3")}
      />
      <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
        {matches.length > 0 ? matches.map((company) => (
          <button
            key={company.id}
            type="button"
            onClick={() => onChange(company.name, company.id)}
            className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5 text-left last:border-b-0 active:bg-white/[0.04]"
          >
            <DirectoryEntityIcon item={{ type: "company", name: company.name }} size="xs" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{company.name}</span>
            <span className="text-xs font-semibold text-[var(--directory-title)]">{company.id === selectedId ? "Selected" : "Select"}</span>
          </button>
        )) : (
          <p className="px-3 py-3 text-xs text-muted-foreground/50">
            {isLoading ? "Loading Directory companies…" : "No companies match."}
          </p>
        )}
      </div>
    </fieldset>
  )
}

function PeopleSelector({
  people,
  isLoading,
  selectedPeople,
  onAdd,
  onRemove,
}: {
  people: Array<{ id: string; name: string }>
  isLoading: boolean
  selectedPeople: DirectoryInvolvedPerson[]
  onAdd: (person: DirectoryInvolvedPerson) => void
  onRemove: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const selectedIds = useMemo(() => new Set(selectedPeople.map((person) => person.id)), [selectedPeople])
  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return people
      .filter((person) => !selectedIds.has(person.id))
      .filter((person) => !normalizedQuery || person.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8)
  }, [people, query, selectedIds])

  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">People involved</legend>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">Add existing Directory contacts to this shared context.</p>
      {selectedPeople.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {selectedPeople.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onRemove(person.id)}
              className="rounded-full border border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--directory-title)] active:scale-[0.97]"
              aria-label={`Remove ${person.name}`}
            >
              {person.name} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search contacts to add"
        className={cn(inputClassName, "mt-3")}
      />
      <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
        {matches.length > 0 ? matches.map((person) => (
          <button
            key={person.id}
            type="button"
            onClick={() => { onAdd(person); setQuery("") }}
            className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5 text-left last:border-b-0 active:bg-white/[0.04]"
          >
            <DirectoryEntityIcon item={{ type: "person", name: person.name }} size="xs" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{person.name}</span>
            <span className="text-xs font-semibold text-[var(--directory-title)]">Add</span>
          </button>
        )) : (
          <p className="px-3 py-3 text-xs text-muted-foreground/50">
            {isLoading ? "Loading Directory contacts…" : "No additional contacts match."}
          </p>
        )}
      </div>
    </fieldset>
  )
}

function JobsSelector({
  jobs,
  isLoading,
  selectedJobs,
  onAdd,
  onRemove,
}: {
  jobs: Array<{ id: string; name: string }>
  isLoading: boolean
  selectedJobs: DirectoryInvolvedPerson[]
  onAdd: (job: DirectoryInvolvedPerson) => void
  onRemove: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const selectedIds = useMemo(() => new Set(selectedJobs.map((job) => job.id)), [selectedJobs])
  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return jobs
      .filter((job) => !selectedIds.has(job.id))
      .filter((job) => !normalizedQuery || job.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 8)
  }, [jobs, query, selectedIds])

  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Jobs</legend>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">Jobs this contact is working on.</p>
      {selectedJobs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {selectedJobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onRemove(job.id)}
              disabled={isLoading}
              className="rounded-full border border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--directory-title)] active:scale-[0.97] disabled:opacity-50"
              aria-label={`Remove ${job.name}`}
            >
              {job.name} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search jobs to add"
        disabled={isLoading}
        className={cn(inputClassName, "mt-3", isLoading && "opacity-50")}
      />
      <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
        {matches.length > 0 ? matches.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => { onAdd(job); setQuery("") }}
            disabled={isLoading}
            className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5 text-left last:border-b-0 active:bg-white/[0.04] disabled:opacity-50"
          >
            <DirectoryEntityIcon item={{ type: "job", name: job.name }} size="xs" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground/85">{job.name}</span>
            <span className="text-xs font-semibold text-[var(--directory-title)]">Add</span>
          </button>
        )) : (
          <p className="px-3 py-3 text-xs text-muted-foreground/50">
            {isLoading ? "Loading Directory jobs…" : "No additional jobs match."}
          </p>
        )}
      </div>
    </fieldset>
  )
}

function StatusToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options: Array<{ key: string; label: string }> = [
    { key: "", label: "Unset" },
    { key: "Active", label: "Active" },
    { key: "Inactive", label: "Inactive" },
  ]
  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Status</legend>
      <div className="mt-3 flex gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]",
              value === option.key
                ? "border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] text-[var(--directory-title)]"
                : "border-white/[0.1] bg-white/[0.03] text-foreground/70",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ValueListEditor({
  label,
  hint,
  values,
  placeholder,
  inputType,
  validate,
  onChange,
}: {
  label: string
  hint: string
  values: string[]
  placeholder: string
  inputType: "email" | "tel"
  validate: (value: string) => boolean
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  const [localError, setLocalError] = useState("")

  const add = () => {
    const value = draft.trim()
    if (!value) return
    if (!validate(value)) {
      setLocalError(`That doesn't look like a valid ${inputType === "email" ? "email" : "phone number"}.`)
      return
    }
    const normalized = inputType === "email" ? value.toLowerCase() : value.replace(/\D/g, "")
    const alreadyPresent = values.some((existing) =>
      (inputType === "email" ? existing.toLowerCase() : existing.replace(/\D/g, "")) === normalized,
    )
    if (!alreadyPresent) onChange([...values, value])
    setDraft("")
    setLocalError("")
  }

  return (
    <fieldset>
      <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{label}</legend>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground/55">{hint}</p>
      {values.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {values.map((value, index) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="rounded-full border border-[var(--directory-title)]/25 bg-[var(--directory-title)]/[0.09] px-3 py-1.5 text-xs font-medium text-[var(--directory-title)] active:scale-[0.97]"
              aria-label={`Remove ${value}`}
            >
              {value}
              {index === 0 && values.length > 1 && <span className="ml-1 text-[var(--directory-title)]/60">· Primary</span>}
              {" "}<span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          type={inputType}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setLocalError("") }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }}
          placeholder={placeholder}
          className={cn(inputClassName, "flex-1")}
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-foreground/80 active:scale-[0.97]"
        >
          Add
        </button>
      </div>
      {localError && <p className="mt-1.5 text-[11px] text-orange-300/80">{localError}</p>}
    </fieldset>
  )
}

const inputClassName = "w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:border-white/20 focus:outline-none"
const textareaClassName = `${inputClassName} resize-none leading-6`

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">{label}</span>
      {children}
    </label>
  )
}
