"use client"

import { useState, useMemo } from "react"
import { ArrowLeft, UserPlus, Mail, Phone, Trash2, ChevronDown, ChevronUp, X, Check, Users, Pencil, Globe, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact, type ImportedContact, type Message, deriveInitials } from "@/lib/store"
import {
  buildPeopleActivityStats,
  compareBySearchScore,
  scoreImportedContactSearch,
  scoreRegisteredPersonSearch,
} from "@/lib/smart-search"
import { ImportContactsModal } from "@/components/import-contacts-modal"
import { MakeGlobalModal } from "@/components/make-global-modal"

const CONTACT_COLORS = [
  "bg-emerald-600",
  "bg-amber-600",
  "bg-cyan-600",
  "bg-purple-600",
  "bg-pink-600",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-orange-600",
  "bg-sky-600",
  "bg-rose-600",
]

function getImportedContactColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return CONTACT_COLORS[hash % CONTACT_COLORS.length]
}

interface PeopleScreenProps {
  contacts: Contact[]
  currentUser: Contact
  importedContacts: ImportedContact[]
  registeredUsers: Contact[]
  messages: Message[]
  onBack: () => void
  onSaveImportedContacts: (contacts: Omit<ImportedContact, "id">[]) => Promise<void>
  onInviteContact: (contact: ImportedContact) => void
  onAddTagToContact: (contactId: string, tag: string) => Promise<void>
  onRemoveTagFromContact: (contactId: string, tag: string) => Promise<void>
  onDeleteImportedContact: (contactId: string) => Promise<void>
  onUpdateImportedContact: (contactId: string, updates: { email?: string | null; phone?: string | null }) => Promise<void>
  onSetContactVisibility: (contactId: string, visibility: "private" | "global") => Promise<void>
  className?: string
}

export function PeopleScreen({
  contacts,
  currentUser,
  importedContacts,
  registeredUsers,
  messages,
  onBack,
  onSaveImportedContacts,
  onInviteContact,
  onAddTagToContact,
  onRemoveTagFromContact,
  onDeleteImportedContact,
  onUpdateImportedContact,
  onSetContactVisibility,
  className,
}: PeopleScreenProps) {
  const [showImportModal, setShowImportModal] = useState(false)
  const [query, setQuery] = useState("")

  const allRegistered = useMemo(() => {
    const seen = new Set<string>()
    const list: Contact[] = []
    ;[currentUser, ...contacts].forEach((c) => {
      if (c && !seen.has(c.id)) {
        seen.add(c.id)
        list.push(c)
      }
    })
    return list
  }, [currentUser, contacts])

  const lq = query.trim().toLowerCase()
  const peopleActivity = useMemo(() => buildPeopleActivityStats(messages), [messages])

  const filteredRegistered = useMemo(() => {
    return allRegistered
      .map((person) => {
        const activity = peopleActivity.get(person.id)
        return {
          item: person,
          score: scoreRegisteredPersonSearch(person, query, activity),
          label: person.name,
          activity,
        }
      })
      .filter((entry) => !lq || entry.score > 0)
      .sort(compareBySearchScore)
      .map((entry) => entry.item)
  }, [allRegistered, lq, peopleActivity, query])

  const filteredImported = useMemo(() => {
    return importedContacts
      .map((contact) => {
        const activity = peopleActivity.get(contact.id)
        return {
          item: contact,
          score: scoreImportedContactSearch(contact, query, activity),
          label: contact.name,
          activity,
        }
      })
      .filter((entry) => !lq || entry.score > 0)
      .sort(compareBySearchScore)
      .map((entry) => entry.item)
  }, [importedContacts, lq, peopleActivity, query])

  const now = Date.now()
  const cutoff = 90_000

  return (
    <div className={cn("flex-1 flex flex-col stream-glass-screen overflow-hidden", className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 animate-slide-down">
        <div className="max-w-2xl mx-auto px-4 md:px-6 app-topbar flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 hover:bg-white/8 transition-all duration-150"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <h1 className="text-base font-bold tracking-tight flex-1">People</h1>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-semibold active:scale-95 transition-all duration-150"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Import
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-2xl mx-auto w-full px-4 md:px-6 pt-4 pb-2">
        <div className="relative">
          <input
            type="text"
            placeholder="Search people..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/60 outline-none focus:border-primary/40 focus:bg-white/8 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-2xl mx-auto px-4 md:px-6 pb-10">

          {/* ── Registered users ── */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3 pt-2">
              <Users className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
                Active members
              </span>
              <span className="text-xs text-muted-foreground/40 ml-auto">{filteredRegistered.length}</span>
            </div>

            {filteredRegistered.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 py-4 text-center">No members found.</p>
            ) : (
              <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
                {filteredRegistered.map((person, i) => {
                  const isOnline = !!person.lastSeen && now - person.lastSeen.getTime() < cutoff
                  const isMe = person.id === currentUser.id
                  return (
                    <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="relative shrink-0">
                        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white", person.color)}>
                          {person.initials}
                        </div>
                        {isOnline && (
                          <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-progress border-2 border-background" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate">{person.name}</span>
                          {isMe && (
                            <span className="text-[10px] text-muted-foreground/50 font-normal">(you)</span>
                          )}
                        </div>
                        {person.email && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Mail className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                            <span className="text-xs text-muted-foreground/60 truncate">{person.email}</span>
                          </div>
                        )}
                      </div>
                      {isOnline && (
                        <span className="text-[10px] text-progress font-medium shrink-0">Online</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Imported / not registered ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
                Not registered contacts
              </span>
              {importedContacts.length > 0 && (
                <span className="text-xs text-muted-foreground/40 ml-auto">{filteredImported.length}</span>
              )}
            </div>

            {importedContacts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 flex flex-col items-center gap-3 py-10 px-6 text-center">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground/70">No people yet</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">Add or import contacts so they can be used as recipients.</p>
                </div>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="px-4 py-2 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold active:scale-95 transition-all"
                >
                  Import from Google
                </button>
              </div>
            ) : filteredImported.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 py-4 text-center">No results found. Try a different search.</p>
            ) : (
              <div className="rounded-2xl bg-card border border-white/10 overflow-hidden divide-y divide-white/8">
                {filteredImported.map((contact) => (
                  <ImportedContactRow
                    key={contact.id}
                    contact={contact}
                    currentUserId={currentUser.id}
                    registeredUsers={registeredUsers}
                    onInvite={() => onInviteContact(contact)}
                    onAddTag={(tag) => onAddTagToContact(contact.id, tag)}
                    onRemoveTag={(tag) => onRemoveTagFromContact(contact.id, tag)}
                    onDelete={() => onDeleteImportedContact(contact.id)}
                    onUpdateContact={(updates) => onUpdateImportedContact(contact.id, updates)}
                    onSetVisibility={(vis) => onSetContactVisibility(contact.id, vis)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showImportModal && (
        <ImportContactsModal
          currentUserId={currentUser.id}
          registeredUsers={registeredUsers}
          existingImported={importedContacts}
          onClose={() => setShowImportModal(false)}
          onImported={async (newContacts) => {
            await onSaveImportedContacts(newContacts)
            setShowImportModal(false)
          }}
        />
      )}
    </div>
  )
}

// ── Imported contact row ───────────────────────────────────────────────

interface ImportedContactRowProps {
  contact: ImportedContact
  currentUserId: string
  registeredUsers: Contact[]
  onInvite: () => void
  onAddTag: (tag: string) => Promise<void>
  onRemoveTag: (tag: string) => Promise<void>
  onDelete: () => void
  onUpdateContact: (updates: { email?: string | null; phone?: string | null }) => Promise<void>
  onSetVisibility: (visibility: "private" | "global") => Promise<void>
}

function ImportedContactRow({
  contact,
  currentUserId,
  registeredUsers,
  onInvite,
  onAddTag,
  onRemoveTag,
  onDelete,
  onUpdateContact,
  onSetVisibility,
}: ImportedContactRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [newTag, setNewTag] = useState("")
  const [addingTag, setAddingTag] = useState(false)
  const [showTagInput, setShowTagInput] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Inline edit for email / phone
  const [editField, setEditField] = useState<"email" | "phone" | null>(null)
  const [editValue, setEditValue] = useState("")
  const [savingField, setSavingField] = useState(false)

  // Inline label editing
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editTagValue, setEditTagValue] = useState("")
  const [savingTag, setSavingTag] = useState(false)
  const [showGlobalModal, setShowGlobalModal] = useState(false)
  const [settingVisibility, setSettingVisibility] = useState(false)

  const initials = deriveInitials(contact.name)
  const color = getImportedContactColor(contact.id)
  const linkedUser = contact.linkedUserId
    ? registeredUsers.find((u) => u.id === contact.linkedUserId)
    : null
  const canEditContact = contact.ownerUserId === currentUserId

  const handleAddTag = async () => {
    if (!canEditContact) return
    const trimmed = newTag.trim()
    if (!trimmed) return
    setAddingTag(true)
    try {
      await onAddTag(trimmed)
      setNewTag("")
      setShowTagInput(false)
    } finally {
      setAddingTag(false)
    }
  }

  const startEditField = (field: "email" | "phone") => {
    if (!canEditContact) return
    setEditField(field)
    setEditValue(field === "email" ? (contact.email ?? "") : (contact.phone ?? ""))
  }

  const cancelEditField = () => {
    setEditField(null)
    setEditValue("")
  }

  const saveEditField = async () => {
    if (!editField || savingField) return
    setSavingField(true)
    try {
      await onUpdateContact({ [editField]: editValue.trim() || null })
      setEditField(null)
      setEditValue("")
    } finally {
      setSavingField(false)
    }
  }

  const clearField = async (field: "email" | "phone") => {
    if (!canEditContact) return
    await onUpdateContact({ [field]: null })
  }

  const startEditTag = (tag: string) => {
    if (!canEditContact) return
    setEditingTag(tag)
    setEditTagValue(tag)
  }

  const cancelEditTag = () => {
    setEditingTag(null)
    setEditTagValue("")
  }

  const saveEditTag = async () => {
    if (!canEditContact || !editingTag || savingTag) return
    const newVal = editTagValue.trim()
    if (!newVal || newVal === editingTag) {
      cancelEditTag()
      return
    }
    setSavingTag(true)
    try {
      await onRemoveTag(editingTag)
      await onAddTag(newVal)
      setEditingTag(null)
      setEditTagValue("")
    } finally {
      setSavingTag(false)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Compact row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer active:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0", color)}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold truncate">{contact.name}</span>
            {linkedUser && (
              <span className="text-[10px] bg-progress/15 text-progress border border-progress/25 rounded-full px-1.5 py-0.5 font-medium shrink-0">
                Registered
              </span>
            )}
            {contact.source === "google" && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">Google</span>
            )}
          </div>
          {contact.email && (
            <span className="text-xs text-muted-foreground/60 truncate block">{contact.email}</span>
          )}
          {contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {contact.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] bg-white/8 border border-white/12 text-muted-foreground rounded-full px-1.5 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {confirmDelete ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                className="text-[10px] font-semibold text-muted-foreground bg-white/8 border border-white/15 px-2 py-1 rounded-lg active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="text-[10px] font-semibold text-destructive bg-destructive/12 border border-destructive/25 px-2 py-1 rounded-lg active:scale-95 transition-all"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              {!linkedUser && (
                <button
                  onClick={(e) => { e.stopPropagation(); onInvite() }}
                  className="text-xs font-semibold text-primary bg-primary/12 border border-primary/25 px-2.5 py-1 rounded-lg active:scale-95 transition-all"
                >
                  Invite
                </button>
              )}
              {canEditContact && !expanded && (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                  className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all hover:bg-destructive/10 hover:border-destructive/25"
                >
                  <Trash2 className="w-3 h-3 text-muted-foreground/50" />
                </button>
              )}
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
              )}
            </>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 flex flex-col gap-3 bg-white/3 border-t border-white/8">

          {/* Contact details — editable */}
          <div className="flex flex-col gap-2 pt-2">

            {/* Email */}
            {linkedUser ? (
              linkedUser.email ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate flex-1">{linkedUser.email}</span>
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">registered</span>
                </div>
              ) : null
            ) : canEditContact && editField === "email" ? (
              <div className="flex items-center gap-2">
                <Mail className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                <input
                  type="email"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEditField()
                    if (e.key === "Escape") cancelEditField()
                  }}
                  autoFocus
                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-primary/40 transition-colors"
                />
                <button
                  onClick={saveEditField}
                  disabled={savingField}
                  className="w-6 h-6 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                >
                  <Check className="w-3 h-3 text-primary" />
                </button>
                <button
                  onClick={cancelEditField}
                  className="w-6 h-6 rounded-md bg-white/5 border border-white/15 flex items-center justify-center active:scale-95 transition-all"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ) : contact.email ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="w-3 h-3 shrink-0" />
                <span className="truncate flex-1">{contact.email}</span>
                {canEditContact && (
                  <>
                    <button
                      onClick={() => startEditField("email")}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                    >
                      <Pencil className="w-2.5 h-2.5 text-muted-foreground/50" />
                    </button>
                    <button
                      onClick={() => clearField("email")}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors"
                    >
                      <X className="w-2.5 h-2.5 text-muted-foreground/40" />
                    </button>
                  </>
                )}
              </div>
            ) : canEditContact ? (
              <button
                onClick={() => startEditField("email")}
                className="flex items-center gap-2 text-xs text-primary/60 hover:text-primary transition-colors self-start"
              >
                <Mail className="w-3 h-3" />
                <span>+ Add email</span>
              </button>
            ) : null}

            {/* Phone */}
            {canEditContact && editField === "phone" ? (
              <div className="flex items-center gap-2">
                <Phone className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                <input
                  type="tel"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEditField()
                    if (e.key === "Escape") cancelEditField()
                  }}
                  autoFocus
                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-xs outline-none focus:border-primary/40 transition-colors"
                />
                <button
                  onClick={saveEditField}
                  disabled={savingField}
                  className="w-6 h-6 rounded-md bg-primary/15 border border-primary/25 flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                >
                  <Check className="w-3 h-3 text-primary" />
                </button>
                <button
                  onClick={cancelEditField}
                  className="w-6 h-6 rounded-md bg-white/5 border border-white/15 flex items-center justify-center active:scale-95 transition-all"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ) : contact.phone ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="w-3 h-3 shrink-0" />
                <span className="flex-1">{contact.phone}</span>
                {canEditContact && (
                  <>
                    <button
                      onClick={() => startEditField("phone")}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
                    >
                      <Pencil className="w-2.5 h-2.5 text-muted-foreground/50" />
                    </button>
                    <button
                      onClick={() => clearField("phone")}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 transition-colors"
                    >
                      <X className="w-2.5 h-2.5 text-muted-foreground/40" />
                    </button>
                  </>
                )}
              </div>
            ) : canEditContact ? (
              <button
                onClick={() => startEditField("phone")}
                className="flex items-center gap-2 text-xs text-primary/60 hover:text-primary transition-colors self-start"
              >
                <Phone className="w-3 h-3" />
                <span>+ Add phone</span>
              </button>
            ) : null}

            {linkedUser && (
              <div className="flex items-center gap-2 text-xs text-progress">
                <Check className="w-3 h-3 shrink-0" />
                <span>Linked to <strong>{linkedUser.name}</strong></span>
              </div>
            )}
          </div>

          {/* Labels */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Labels</span>
              {canEditContact && (
                <button
                  onClick={() => setShowTagInput((v) => !v)}
                  className="text-[10px] text-primary font-semibold ml-auto"
                >
                  + Add
                </button>
              )}
            </div>
            {contact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {contact.tags.map((tag) =>
                  editingTag === tag ? (
                    <div key={tag} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editTagValue}
                        onChange={(e) => setEditTagValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditTag()
                          if (e.key === "Escape") cancelEditTag()
                        }}
                        autoFocus
                        className="bg-white/5 border border-primary/40 rounded-full px-2 py-0.5 text-xs outline-none w-24 transition-colors"
                      />
                      <button
                        onClick={saveEditTag}
                        disabled={savingTag}
                        className="w-5 h-5 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                      >
                        <Check className="w-2.5 h-2.5 text-primary" />
                      </button>
                      <button
                        onClick={cancelEditTag}
                        className="w-5 h-5 rounded-full bg-white/5 border border-white/15 flex items-center justify-center active:scale-95 transition-all"
                      >
                        <X className="w-2.5 h-2.5 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <div key={tag} className="flex items-center gap-1 bg-white/8 border border-white/12 rounded-full px-2 py-0.5">
                      <span className="text-xs text-foreground/80">{tag}</span>
                      {canEditContact && (
                        <>
                          <button
                            onClick={() => startEditTag(tag)}
                            className="text-muted-foreground/30 hover:text-muted-foreground transition-colors ml-0.5"
                          >
                            <Pencil className="w-2 h-2" />
                          </button>
                          <button
                            onClick={() => onRemoveTag(tag)}
                            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
            {canEditContact && showTagInput && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. client, vendor..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTag()
                    if (e.key === "Escape") { setShowTagInput(false); setNewTag("") }
                  }}
                  autoFocus
                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-primary/40 transition-colors"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim() || addingTag}
                  className="px-3 py-1.5 rounded-lg bg-primary text-background text-xs font-semibold disabled:opacity-40 active:scale-95 transition-all"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          {/* Visibility — owner only */}
          {canEditContact ? (
            <div className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2">
                {contact.visibility === "global" ? (
                  <Globe className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-muted-foreground/40" />
                )}
                <span className="text-xs text-muted-foreground">
                  {contact.visibility === "global" ? "Visible to everyone" : "Private contact"}
                </span>
              </div>
              {contact.visibility === "global" ? (
                <button
                  disabled={settingVisibility}
                  onClick={async () => {
                    setSettingVisibility(true)
                    try { await onSetVisibility("private") } finally { setSettingVisibility(false) }
                  }}
                  className="text-xs text-muted-foreground/60 hover:text-foreground disabled:opacity-40 transition-colors"
                >
                  Make private
                </button>
              ) : (
                <button
                  onClick={() => setShowGlobalModal(true)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Globe className="w-3 h-3" />
                  Make global
                </button>
              )}
            </div>
          ) : contact.visibility === "global" ? (
            <div className="flex items-center gap-2 py-0.5">
              <Globe className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-muted-foreground">Shared contact</span>
            </div>
          ) : null}

          {/* Delete (only visible when expanded) */}
          {canEditContact && (
          <div className="flex justify-end pt-1">
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs text-destructive/70 hover:text-destructive transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Remove contact
            </button>
          </div>
          )}
        </div>
      )}

      {/* Make Global modal */}
      {canEditContact && (
        <MakeGlobalModal
          open={showGlobalModal}
          contactName={contact.name}
          onConfirm={async () => {
            setShowGlobalModal(false)
            setSettingVisibility(true)
            try { await onSetVisibility("global") } finally { setSettingVisibility(false) }
          }}
          onCancel={() => setShowGlobalModal(false)}
        />
      )}
    </div>
  )
}
