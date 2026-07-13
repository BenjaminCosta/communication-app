import type { DirectoryProfileViewModel } from "@/lib/directory-view-models"

const STORAGE_KEY = "svc-directory-profile-lru-v1"
const MAX_PROFILES = 20

interface CachedProfile {
  id: string
  vm: DirectoryProfileViewModel
  savedAt: number
}

function readAll(): CachedProfile[] {
  if (typeof window === "undefined") return []
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string") : []
  } catch {
    return []
  }
}

export function readCachedDirectoryProfile(id: string): DirectoryProfileViewModel | null {
  return readAll().find((entry) => entry.id === id)?.vm ?? null
}

export function writeCachedDirectoryProfile(vm: DirectoryProfileViewModel): void {
  if (typeof window === "undefined") return
  try {
    const next = [
      { id: vm.id, vm, savedAt: Date.now() },
      ...readAll().filter((entry) => entry.id !== vm.id),
    ].slice(0, MAX_PROFILES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode/quota errors should never block the profile.
  }
}
