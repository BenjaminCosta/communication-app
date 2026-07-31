"use client"

/**
 * Search-and-tap-to-add list over Contact + ImportedContact — the same
 * data + scoring compose-screen/tag-sheet already use for picking people
 * (lib/smart-search.ts), just re-skinned in Quest Coral's own primitives.
 *
 * Not a QcSheet itself: the caller embeds this inside whatever sheet/step
 * is already open (create-project-sheet's "People" step, or Project
 * Detail's "People involved" sheet) rather than stacking a second sheet.
 */

import { useMemo, useState } from "react"
import { Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar } from "@/components/quest-coral/ui/quest-coral-primitives"
import { compareBySearchScore, scoreImportedContactSearch, scoreRegisteredPersonSearch } from "@/lib/smart-search"
import { initialsFromName, type ProjectPerson } from "@/lib/quest-coral-core"
import type { Contact, ImportedContact } from "@/lib/store"

const MAX_RESULTS = 30

interface PeopleSearchPickerProps {
  contacts: Contact[]
  importedContacts: ImportedContact[]
  /** IDs to hide from results — already on the project, or the current user (added separately as owner). */
  excludeIds: string[]
  /** Current staged selection. Tapping a row only toggles this selection. */
  selectedIds: string[]
  onToggle: (person: ProjectPerson) => void
}

export function PeopleSearchPicker({ contacts, importedContacts, excludeIds, selectedIds, onToggle }: PeopleSearchPickerProps) {
  const [query, setQuery] = useState("")
  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])
  const q = query.trim()

  const filteredContacts = useMemo(() => {
    const pool = contacts.filter((person) => !excluded.has(person.id))
    if (!q) return pool.slice(0, MAX_RESULTS)
    return pool
      .map((person) => ({ item: person, score: scoreRegisteredPersonSearch(person, q), label: person.name }))
      .filter((entry) => entry.score > 0)
      .sort(compareBySearchScore)
      .map((entry) => entry.item)
      .slice(0, MAX_RESULTS)
  }, [contacts, excluded, q])

  // Registered imported contacts are already reachable via `contacts` above
  // (same convention as compose-screen.tsx) — showing both would duplicate them.
  const filteredImported = useMemo(() => {
    const pool = importedContacts.filter((contact) => contact.status === "not_registered" && !excluded.has(contact.id))
    if (!q) return pool.slice(0, MAX_RESULTS)
    return pool
      .map((contact) => ({ item: contact, score: scoreImportedContactSearch(contact, q), label: contact.name }))
      .filter((entry) => entry.score > 0)
      .sort(compareBySearchScore)
      .map((entry) => entry.item)
      .slice(0, MAX_RESULTS)
  }, [importedContacts, excluded, q])

  const hasResults = filteredContacts.length > 0 || filteredImported.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-[var(--coral-border)] bg-[var(--coral-surface)] px-3.5 focus-within:border-[var(--coral)] focus-within:shadow-[0_0_0_3px_rgba(255,122,89,0.10)]">
        <Search className="h-4 w-4 shrink-0 text-[var(--coral-text-muted)]" strokeWidth={2} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or email"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-[var(--coral-text)] outline-none placeholder:text-[#94A3B8]"
        />
      </div>

      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
        {!hasResults && (
          <p className="py-4 text-center text-[0.8125rem] text-[var(--coral-text-muted)]">
            {q ? "No one matches that search." : "No contacts available yet."}
          </p>
        )}

        {filteredContacts.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="px-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">Team</p>
            {filteredContacts.map((person) => {
              const selected = selectedIds.includes(person.id)
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggle({ id: person.id, name: person.name, initials: person.initials })}
                  className={cn("quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-2 text-left", selected ? "bg-[var(--coral-soft)]" : "hover:bg-[var(--coral-surface-2)]")}
                >
                  <Avatar initials={person.initials} className="h-8 w-8 text-[0.625rem]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--coral-text)]">{person.name}</span>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", selected ? "border-[var(--coral)] bg-[var(--coral)] text-white" : "border-[var(--coral-border)] bg-white text-transparent")} aria-hidden="true">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {filteredImported.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="px-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--coral-text-muted)]">Not registered</p>
            {filteredImported.map((contact) => {
              const initials = initialsFromName(contact.name)
              const selected = selectedIds.includes(contact.id)
              return (
                <button
                  key={contact.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggle({ id: contact.id, name: contact.name, initials })}
                  className={cn("quest-coral-tap flex min-h-12 items-center gap-3 rounded-xl px-2 text-left opacity-80 hover:opacity-100", selected ? "bg-[var(--coral-soft)]" : "hover:bg-[var(--coral-surface-2)]")}
                >
                  <Avatar initials={initials} className="h-8 w-8 text-[0.625rem]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--coral-text)]">{contact.name}</span>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", selected ? "border-[var(--coral)] bg-[var(--coral)] text-white" : "border-[var(--coral-border)] bg-white text-transparent")} aria-hidden="true">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
