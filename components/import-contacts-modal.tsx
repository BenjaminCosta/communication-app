"use client"

import { useState, useCallback, useRef } from "react"
import { X, RefreshCw, CheckSquare, Square, Search, AlertCircle, Plus, Trash2, Upload, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact, type ImportedContact, type ImportedContactSource, deriveInitials } from "@/lib/store"

// ── Google People API types ────────────────────────────────────────────

interface GooglePerson {
  resourceName: string
  names?: { displayName: string; givenName?: string; familyName?: string }[]
  emailAddresses?: { value: string }[]
  phoneNumbers?: { value: string; canonicalForm?: string }[]
}

interface GoogleConnectionsResponse {
  connections?: GooglePerson[]
  nextPageToken?: string
  totalPeople?: number
}

// ── Fetch helpers ──────────────────────────────────────────────────────

async function fetchGoogleContacts(accessToken: string): Promise<GooglePerson[]> {
  const params = new URLSearchParams({
    personFields: "names,emailAddresses,phoneNumbers",
    pageSize: "200",
    sortOrder: "FIRST_NAME_ASCENDING",
  })
  const url = `https://people.googleapis.com/v1/people/me/connections?${params}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Google People API error: ${res.status} ${res.statusText}`)
  }
  const data: GoogleConnectionsResponse = await res.json()
  return data.connections ?? []
}

function personToContact(
  person: GooglePerson,
  ownerUserId: string,
  registeredUsers: Contact[],
  existingImported: ImportedContact[]
): Omit<ImportedContact, "id"> | null {
  const name = person.names?.[0]?.displayName?.trim()
  if (!name) return null

  const email = person.emailAddresses?.[0]?.value?.trim().toLowerCase() || undefined
  const phone = (person.phoneNumbers?.[0]?.canonicalForm ?? person.phoneNumbers?.[0]?.value?.trim()) || undefined

  // Detect if already imported (dedup by email or resource name)
  if (email && existingImported.some((c) => c.email?.toLowerCase() === email)) return null

  // Check if linked to a registered user
  const linkedUser = email ? registeredUsers.find((u) => u.email?.toLowerCase() === email) : undefined

  return {
    ownerUserId,
    name,
    email,
    phone,
    source: "google" as const,
    tags: [],
    linkedUserId: linkedUser?.id ?? null,
    status: linkedUser ? ("registered" as const) : ("not_registered" as const),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// ── CSV parsing ───────────────────────────────────────────────────────

function parseCSV(text: string): { name: string; email: string; phone: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const sep = lines[0].includes(";") ? ";" : ","
  const firstRow = lines[0].toLowerCase()
  const hasHeader = firstRow.includes("name") || firstRow.includes("email") || firstRow.includes("phone")
  const headerCols = lines[0].split(sep).map((h) => h.trim().replace(/["']/g, "").toLowerCase())
  const nameIdx = hasHeader ? headerCols.findIndex((h) => h.includes("name")) : 0
  const emailIdx = hasHeader ? headerCols.findIndex((h) => h.includes("email") || h.includes("mail")) : 1
  const phoneIdx = hasHeader ? headerCols.findIndex((h) => h.includes("phone") || h.includes("tel") || h.includes("mobile")) : 2
  const dataLines = hasHeader ? lines.slice(1) : lines
  return dataLines
    .map((line) => {
      const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""))
      return {
        name: (nameIdx >= 0 ? cols[nameIdx] : cols[0]) ?? "",
        email: (emailIdx >= 0 ? cols[emailIdx] : cols[1]) ?? "",
        phone: (phoneIdx >= 0 ? cols[phoneIdx] : cols[2]) ?? "",
      }
    })
    .filter((r) => r.name.trim())
}

// ── Component ──────────────────────────────────────────────────────────

type Tab = "google" | "manual" | "csv"
type Step = "auth" | "loading" | "review" | "error"

interface ManualEntry {
  name: string
  email: string
  phone: string
}

interface ImportContactsModalProps {
  currentUserId: string
  registeredUsers: Contact[]
  existingImported: ImportedContact[]
  onClose: () => void
  onImported: (contacts: Omit<ImportedContact, "id">[]) => Promise<void>
}

export function ImportContactsModal({
  currentUserId,
  registeredUsers,
  existingImported,
  onClose,
  onImported,
}: ImportContactsModalProps) {
  // ── shared ──
  const [tab, setTab] = useState<Tab>("google")
  const [saving, setSaving] = useState(false)

  // ── google tab ──
  const [step, setStep] = useState<Step>("auth")
  const [fetchedContacts, setFetchedContacts] = useState<Omit<ImportedContact, "id">[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  // ── manual tab ──
  const emptyEntry = (): ManualEntry => ({ name: "", email: "", phone: "" })
  const [entries, setEntries] = useState<ManualEntry[]>([emptyEntry()])

  // ── csv tab ──
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvEntries, setCsvEntries] = useState<{ name: string; email: string; phone: string }[]>([])
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  const handleCSVFile = (file: File | null) => {
    if (!file) return
    setCsvError(null)
    setCsvEntries([])
    setCsvFileName(null)
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setCsvError("Please upload a .csv file.")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      if (parsed.length === 0) {
        setCsvError("No valid rows found. Make sure the CSV has at least a 'name' column.")
        return
      }
      setCsvEntries(parsed)
      setCsvFileName(file.name)
    }
    reader.onerror = () => setCsvError("Could not read file.")
    reader.readAsText(file)
  }

  const validCsvEntries = csvEntries.filter((e) => e.name.trim())

  const handleCSVConfirm = async () => {
    if (validCsvEntries.length === 0) return
    setSaving(true)
    try {
      const contacts: Omit<ImportedContact, "id">[] = []
      for (const e of validCsvEntries) {
        const email = e.email.trim().toLowerCase() || undefined
        const phone = e.phone.trim() || undefined
        const linkedUser = email ? registeredUsers.find((u) => u.email?.toLowerCase() === email) : undefined
        const isDup = email ? existingImported.some((c) => c.email?.toLowerCase() === email) : false
        if (isDup) continue
        const contact: Omit<ImportedContact, "id"> = {
          ownerUserId: currentUserId,
          name: e.name.trim(),
          source: "manual" as ImportedContactSource,
          tags: [],
          linkedUserId: linkedUser?.id ?? null,
          status: linkedUser ? ("registered" as const) : ("not_registered" as const),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(email && { email }),
          ...(phone && { phone }),
        }
        contacts.push(contact)
      }
      if (contacts.length === 0) {
        setCsvError("All rows already exist as imported contacts (duplicates filtered).")
        return
      }
      await onImported(contacts)
    } finally {
      setSaving(false)
    }
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  // ─── Google OAuth ───────────────────────────────────────────────────

  const startGoogleAuth = useCallback(async () => {
    if (!clientId) {
      setErrorMessage(
        "Google Client ID is not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to your .env.local file."
      )
      setStep("error")
      return
    }

    const scopes = "https://www.googleapis.com/auth/contacts.readonly"
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${window.location.origin}/google-oauth-callback`,
      response_type: "token",
      scope: scopes,
      include_granted_scopes: "true",
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
    const popup = window.open(authUrl, "google_oauth", "width=500,height=600,left=200,top=100")

    if (!popup) {
      setErrorMessage("Popup was blocked. Please allow popups for this site and try again.")
      setStep("error")
      return
    }

    const handleResult = async (accessToken: string | null, error: string | null) => {
      if (error) {
        setErrorMessage(`Authentication error: ${error}`)
        setStep("error")
      } else if (accessToken) {
        await loadContacts(accessToken)
      }
    }

    // Primary: BroadcastChannel (survives COOP navigation through Google pages)
    const bc = new BroadcastChannel("google_oauth_callback")
    bc.onmessage = async (e: MessageEvent) => {
      bc.close()
      window.removeEventListener("message", onMessage)
      const { accessToken, error } = e.data as { accessToken: string | null; error: string | null }
      await handleResult(accessToken, error)
    }

    // Fallback: postMessage via window.opener
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== "google_oauth_callback") return
      window.removeEventListener("message", onMessage)
      bc.close()
      const { accessToken, error } = event.data as { accessToken: string | null; error: string | null }
      await handleResult(accessToken, error)
    }
    window.addEventListener("message", onMessage)
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts(accessToken: string) {
    setStep("loading")
    try {
      const people = await fetchGoogleContacts(accessToken)
      const contacts = people
        .map((p) => personToContact(p, currentUserId, registeredUsers, existingImported))
        .filter((c): c is Omit<ImportedContact, "id"> => c !== null)
      setFetchedContacts(contacts)
      setSelected(new Set(contacts.map((_, i) => i)))
      setStep("review")
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load contacts. Please try again.")
      setStep("error")
    }
  }

  const toggleAll = () => {
    if (selected.size === filteredIndices.length) setSelected(new Set())
    else setSelected(new Set(filteredIndices))
  }

  const toggle = (index: number) => {
    const next = new Set(selected)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelected(next)
  }

  const lq = searchQuery.trim().toLowerCase()
  const filteredIndices = fetchedContacts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) =>
      !lq || c.name.toLowerCase().includes(lq) || (c.email ?? "").toLowerCase().includes(lq)
    )
    .map(({ i }) => i)

  const handleGoogleConfirm = async () => {
    const toImport = [...selected].map((i) => fetchedContacts[i])
    if (toImport.length === 0) return
    setSaving(true)
    try { await onImported(toImport) } finally { setSaving(false) }
  }

  // ─── Manual ────────────────────────────────────────────────────────

  const updateEntry = (i: number, field: keyof ManualEntry, value: string) => {
    setEntries((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e))
  }

  const addEntry = () => setEntries((prev) => [...prev, emptyEntry()])

  const removeEntry = (i: number) => {
    setEntries((prev) => prev.length === 1 ? [emptyEntry()] : prev.filter((_, idx) => idx !== i))
  }

  const validManualEntries = entries.filter((e) => e.name.trim())

  const handleManualConfirm = async () => {
    if (validManualEntries.length === 0) return
    setSaving(true)
    try {
      const contacts: Omit<ImportedContact, "id">[] = validManualEntries.map((e) => {
        const email = e.email.trim().toLowerCase() || undefined
        const linkedUser = email ? registeredUsers.find((u) => u.email?.toLowerCase() === email) : undefined
        return {
          ownerUserId: currentUserId,
          name: e.name.trim(),
          email,
          phone: e.phone.trim() || undefined,
          source: "manual" as const,
          tags: [],
          linkedUserId: linkedUser?.id ?? null,
          status: linkedUser ? ("registered" as const) : ("not_registered" as const),
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      })
      await onImported(contacts)
    } finally {
      setSaving(false)
    }
  }

  // ─── Modal title helper ────────────────────────────────────────────

  const modalTitle =
    tab === "manual" ? "Add contacts manually" :
    tab === "csv" ? "Import from CSV" :
    "Import from Google Contacts"
  const googleSubtitle =
    step === "review"
      ? `${fetchedContacts.length} contacts found${existingImported.length > 0 ? " · duplicates filtered" : ""}`
      : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 z-50 md:inset-0 md:flex md:items-center md:justify-center">
        <div className="glass-modal border border-white/10 rounded-t-3xl md:rounded-3xl shadow-2xl w-full md:max-w-lg overflow-hidden flex flex-col max-h-[90dvh] md:max-h-[80vh] animate-in slide-in-from-bottom md:slide-in-from-bottom-0 md:fade-in duration-200">

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
            <div className="flex-1">
              <h2 className="text-base font-bold">{modalTitle}</h2>
              {googleSubtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{googleSubtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-all"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 px-5 pt-3 pb-0 shrink-0">
            {(["google", "manual", "csv"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                  tab === t
                    ? "bg-primary/15 border border-primary/30 text-primary"
                    : "bg-white/5 border border-white/10 text-muted-foreground"
                )}
              >
                {t === "google" ? "Google" : t === "csv" ? "CSV" : "Manual"}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">

            {/* ── GOOGLE TAB ── */}
            {tab === "google" && (
              <>
                {step === "auth" && (
                  <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <GoogleG className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground/90">Connect Google Contacts</p>
                      <p className="text-xs text-muted-foreground mt-1.5 max-w-[280px] mx-auto leading-relaxed">
                        Authorize read-only access to your Google Contacts. Only contacts you select will be saved.
                      </p>
                    </div>
                    <button
                      onClick={startGoogleAuth}
                      className="flex items-center gap-2.5 px-5 py-3 rounded-xl bg-white text-gray-800 text-sm font-semibold active:scale-95 transition-all shadow-lg hover:shadow-xl"
                    >
                      <GoogleG className="w-4 h-4" />
                      Sign in with Google
                    </button>
                    {!clientId && (
                      <p className="text-[11px] text-amber-500/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 max-w-[300px]">
                        <strong>Dev note:</strong> Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.local to enable this feature.
                      </p>
                    )}
                  </div>
                )}

                {step === "loading" && (
                  <div className="flex flex-col items-center gap-4 py-16 px-6">
                    <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading contacts…</p>
                  </div>
                )}

                {step === "error" && (
                  <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                      <AlertCircle className="w-5 h-5 text-destructive" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground/90">Something went wrong</p>
                      <p className="text-xs text-muted-foreground mt-1.5 max-w-[280px] leading-relaxed">{errorMessage}</p>
                    </div>
                    <button
                      onClick={() => { setStep("auth"); setErrorMessage("") }}
                      className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold active:scale-95 transition-all"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {step === "review" && (
                  <div className="flex flex-col">
                    {fetchedContacts.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 py-12 text-center px-6">
                        <p className="text-sm font-semibold text-foreground/70">No new contacts found</p>
                        <p className="text-xs text-muted-foreground">
                          All your Google contacts are already imported or have no name.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="px-4 pt-4 pb-2 flex flex-col gap-2 sticky top-0 bg-[rgba(7,13,24,0.95)] backdrop-blur-md z-10 border-b border-white/8">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                            <input
                              type="text"
                              placeholder="Search…"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 transition-colors"
                            />
                          </div>
                          <button
                            onClick={toggleAll}
                            className="flex items-center gap-2 text-xs text-muted-foreground/70 hover:text-foreground transition-colors py-1"
                          >
                            {selected.size === filteredIndices.length ? (
                              <CheckSquare className="w-3.5 h-3.5 text-primary" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                            {selected.size === filteredIndices.length
                              ? "Deselect all"
                              : `Select all (${filteredIndices.length})`}
                          </button>
                        </div>
                        <div className="divide-y divide-white/8">
                          {filteredIndices.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-6">No results.</p>
                          ) : (
                            filteredIndices.map((i) => {
                              const contact = fetchedContacts[i]
                              const isSelected = selected.has(i)
                              const initials = deriveInitials(contact.name)
                              return (
                                <button
                                  key={i}
                                  onClick={() => toggle(i)}
                                  className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                                    isSelected ? "bg-primary/8" : "active:bg-white/5"
                                  )}
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                                  ) : (
                                    <Square className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                                  )}
                                  <div className="w-8 h-8 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[10px] font-bold text-foreground/70 shrink-0">
                                    {initials}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-sm font-semibold truncate">{contact.name}</span>
                                      {contact.status === "registered" && (
                                        <span className="text-[10px] text-progress bg-progress/12 border border-progress/25 rounded-full px-1.5 py-0.5 font-medium shrink-0">
                                          In app
                                        </span>
                                      )}
                                    </div>
                                    {contact.email && (
                                      <span className="text-xs text-muted-foreground/60 truncate block">{contact.email}</span>
                                    )}
                                  </div>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── MANUAL TAB ── */}
            {tab === "manual" && (
              <div className="flex flex-col gap-0 px-5 py-4">
                <p className="text-xs text-muted-foreground mb-4">
                  Add contacts one by one. Only <strong>Name</strong> is required.
                </p>

                {entries.map((entry, i) => (
                  <div
                    key={i}
                    className="mb-3 rounded-2xl bg-white/4 border border-white/10 overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8">
                      <div className="w-6 h-6 rounded-full bg-white/8 border border-white/12 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground/70 flex-1">Contact {i + 1}</span>
                      {entries.length > 1 && (
                        <button
                          onClick={() => removeEntry(i)}
                          className="text-destructive/60 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col divide-y divide-white/8">
                      <ManualField
                        placeholder="Name *"
                        value={entry.name}
                        onChange={(v) => updateEntry(i, "name", v)}
                        required
                      />
                      <ManualField
                        placeholder="Email (optional)"
                        value={entry.email}
                        onChange={(v) => updateEntry(i, "email", v)}
                        type="email"
                      />
                      <ManualField
                        placeholder="Phone (optional)"
                        value={entry.phone}
                        onChange={(v) => updateEntry(i, "phone", v)}
                        type="tel"
                      />
                    </div>
                  </div>
                ))}

                <button
                  onClick={addEntry}
                  className="flex items-center gap-2 text-sm text-primary font-semibold py-2 active:scale-95 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  Add another
                </button>
              </div>
            )}

            {/* ── CSV TAB ── */}
            {tab === "csv" && (
              <div className="flex flex-col gap-4 px-5 py-5">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleCSVFile(e.target.files?.[0] ?? null)}
                />
                {csvFileName ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
                    <FileText className="w-5 h-5 text-primary shrink-0" />
                    <span className="flex-1 text-sm font-semibold truncate">{csvFileName}</span>
                    <button
                      onClick={() => { setCsvEntries([]); setCsvFileName(null); setCsvError(null); if (csvInputRef.current) csvInputRef.current.value = "" }}
                      className="text-muted-foreground active:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => csvInputRef.current?.click()}
                    className="flex flex-col items-center gap-3 px-6 py-8 rounded-2xl border-2 border-dashed border-white/15 text-muted-foreground active:bg-white/5 transition-colors"
                  >
                    <Upload className="w-8 h-8" />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground/80">Upload CSV file</p>
                      <p className="text-xs mt-1">Columns: name, email, phone (header row optional)</p>
                    </div>
                  </button>
                )}
                {csvError && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/25">
                    <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">{csvError}</p>
                  </div>
                )}
                {validCsvEntries.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">{validCsvEntries.length} rows detected</p>
                    <div className="max-h-52 overflow-y-auto scrollbar-hide flex flex-col gap-1">
                      {validCsvEntries.slice(0, 50).map((e, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/5 border border-white/8">
                          <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold text-white/50 shrink-0">
                            {(e.name.match(/\b\w/g) ?? []).slice(0, 2).join("").toUpperCase() || "?"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{e.name}</p>
                            {e.email && <p className="text-[10px] text-muted-foreground truncate">{e.email}</p>}
                          </div>
                          {e.phone && <span className="text-[10px] text-muted-foreground shrink-0">{e.phone}</span>}
                        </div>
                      ))}
                      {validCsvEntries.length > 50 && (
                        <p className="text-xs text-muted-foreground text-center py-2">+{validCsvEntries.length - 50} more rows</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {tab === "google" && step === "review" && fetchedContacts.length > 0 && (
            <div className="px-5 py-4 border-t border-white/10 shrink-0">
              <button
                onClick={handleGoogleConfirm}
                disabled={selected.size === 0 || saving}
                className={cn(
                  "w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]",
                  selected.size > 0 && !saving
                    ? "bg-primary text-background"
                    : "bg-white/5 text-muted-foreground cursor-not-allowed"
                )}
              >
                {saving
                  ? "Importing…"
                  : selected.size === 0
                  ? "Select contacts to import"
                  : `Import ${selected.size} contact${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {tab === "manual" && (
            <div className="px-5 py-4 border-t border-white/10 shrink-0">
              <button
                onClick={handleManualConfirm}
                disabled={validManualEntries.length === 0 || saving}
                className={cn(
                  "w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]",
                  validManualEntries.length > 0 && !saving
                    ? "bg-primary text-background"
                    : "bg-white/5 text-muted-foreground cursor-not-allowed"
                )}
              >
                {saving
                  ? "Saving…"
                  : validManualEntries.length === 0
                  ? "Enter at least one name"
                  : `Save ${validManualEntries.length} contact${validManualEntries.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}

          {tab === "csv" && (
            <div className="px-5 py-4 border-t border-white/10 shrink-0">
              <button
                onClick={handleCSVConfirm}
                disabled={validCsvEntries.length === 0 || saving}
                className={cn(
                  "w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]",
                  validCsvEntries.length > 0 && !saving
                    ? "bg-primary text-background"
                    : "bg-white/5 text-muted-foreground cursor-not-allowed"
                )}
              >
                {saving
                  ? "Importing…"
                  : validCsvEntries.length === 0
                  ? "Upload a CSV file first"
                  : `Import ${validCsvEntries.length} contact${validCsvEntries.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── helpers ────────────────────────────────────────────────────────────

function ManualField({
  placeholder,
  value,
  onChange,
  type = "text",
  required,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full bg-transparent px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 outline-none focus:bg-white/3 transition-colors",
        required && !value.trim() && "placeholder:text-muted-foreground/70"
      )}
    />
  )
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

    // Use the browser's OAuth2 implicit flow via a popup
