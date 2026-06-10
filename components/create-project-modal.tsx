"use client"

import { useState } from "react"
import { X, Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { type Contact, type TagCategory, type CategoryItem, SYSTEM_CATEGORIES, CATEGORY_CONFIG } from "@/lib/store"
import { CategoryIcon } from "@/components/category-icon"

interface CreateProjectModalProps {
  onClose: () => void
  onSubmit: (name: string, memberIds: string[], category: TagCategory) => void
  contacts: Contact[]
  customCategories?: CategoryItem[]
  initialCategory?: TagCategory
}

export function CreateProjectModal({ onClose, onSubmit, contacts: _contacts, customCategories = [], initialCategory = "" }: CreateProjectModalProps) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState<TagCategory>(initialCategory)
  const [isSuccess, setIsSuccess] = useState(false)
  const [categorySearch, setCategorySearch] = useState("")
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)

  const _sysNames = new Set(SYSTEM_CATEGORIES.map(s => s.name.toLowerCase()).concat(["custom","type"]))
  const allCategories: CategoryItem[] = [
    ...SYSTEM_CATEGORIES.filter(c => c.id !== "date"),
    ...customCategories.filter(c =>
      !SYSTEM_CATEGORIES.some(s => s.id === c.id) &&
      !_sysNames.has(c.name.trim().toLowerCase())
    ),
  ]

  const handleCreate = () => {
    setIsSuccess(true)
    setTimeout(() => onSubmit(name.trim(), [], category || "custom"), 750)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
      />

      {/* Modal card */}
      <div className="relative z-10 w-full max-w-sm glass-modal rounded-3xl border border-white/10 shadow-2xl overflow-y-auto max-h-[92dvh] animate-spring-pop -translate-y-[5%]">

        {/* ── Success overlay ── */}
        {isSuccess && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 glass-modal rounded-3xl animate-fade-in">
            <div className="animate-sent-pop">
              <div className="w-20 h-20 rounded-full bg-progress flex items-center justify-center shadow-[0_0_48px_rgba(34,197,94,0.55)]">
                <svg className="w-9 h-9" viewBox="0 0 36 36" fill="none">
                  <path
                    d="M7 19L14 26L29 11"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      strokeDasharray: 32,
                      strokeDashoffset: 32,
                      animation: "check-draw 0.4s cubic-bezier(0.22,0.97,0.52,1) 0.12s forwards",
                    }}
                  />
                </svg>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1 animate-fade-up">
              <p className="text-base font-bold text-foreground">{name.trim()}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-muted-foreground">Tag created</p>
                <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-primary/70 font-mono">
                  · {CATEGORY_CONFIG[category]?.label ?? "Custom"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="flex items-center justify-end px-5 pt-5 pb-0">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* ── Name + Category ── */}
        <div className="px-5 pt-5 pb-6 animate-fade-up">
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-1">New Tag</p>
            <h2 className="text-xl font-bold mb-1">Tag name</h2>
            <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
              Give it a clear, recognizable name.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && handleCreate()}
              placeholder="e.g. Cool Breeze Phase 2"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors mb-4"
            />

            {/* Category selector */}
            <p className="text-[10px] font-bold tracking-[2px] uppercase text-muted-foreground font-mono mb-2">Category</p>
            {/* Selected category chip — only shown when user explicitly picked one */}
            {category && category !== "" && (
              <div className="mb-2">
                <span className="flex items-center gap-3 rounded-xl border border-primary/35 bg-primary/12 px-3 py-2.5 text-xs font-semibold text-foreground">
                  <CategoryIcon categoryId={category} />
                  <span className="min-w-0 flex-1 truncate">{allCategories.find(c => c.id === category)?.name ?? "Custom"}</span>
                  <button
                    type="button"
                    onClick={() => { setCategory(""); setCategorySearch("") }}
                    className="shrink-0 active:scale-90"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 mb-2">
              <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <input
                value={categorySearch}
                onChange={e => setCategorySearch(e.target.value)}
                onFocus={() => setShowCategoryPicker(true)}
                onBlur={() => setTimeout(() => setShowCategoryPicker(false), 120)}
                placeholder="Search categories…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
            </label>
            {showCategoryPicker && (
              <div className="flex flex-col mb-3 max-h-[140px] overflow-y-auto scrollbar-hide rounded-xl border border-white/10 bg-white/5">
                {allCategories
                  .filter(c => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()))
                  .map(cat => {
                    const selected = category === cat.id
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onPointerDown={() => { setCategory(cat.id); setCategorySearch("") }}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 transition-colors text-left",
                          selected ? "bg-primary/15" : "hover:bg-white/5 active:bg-white/5"
                        )}
                      >
                        <CategoryIcon categoryId={cat.id} />
                        <span className={cn("text-sm font-semibold flex-1", selected ? "text-primary" : "text-foreground/90")}>
                          {cat.name}
                        </span>
                        {!cat.isSystem && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 font-mono">custom</span>
                        )}
                        {selected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                      </button>
                    )
                  })}
                {allCategories.filter(c => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase())).length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-3">No categories found.</p>
                )}
              </div>
            )}

            <button
              onClick={() => name.trim() && handleCreate()}
              disabled={!name.trim()}
              className={cn(
                "w-full py-3.5 rounded-xl text-sm font-semibold tracking-wide transition-all",
                name.trim()
                  ? "bg-primary text-white shadow-[0_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.98]"
                  : "bg-white/5 text-muted-foreground/40"
              )}
            >
              Create Tag
            </button>
          </div>
      </div>
    </div>
  )
}
