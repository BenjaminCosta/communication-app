import { doc, getDoc } from "firebase/firestore/lite"
import { parseDirectoryId } from "@/lib/directory"
import { directoryDb } from "@/lib/firebase"
import {
  buildProfileViewModel,
  type BuildProfileOptions,
  type DirectoryProfileViewModel,
  type ProfileIndexInput,
} from "@/lib/directory-view-models"

const inflight = new Map<string, Promise<DirectoryProfileViewModel>>()

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function loadDirectoryProfileViewModel(
  directoryId: string,
  force = false,
  options: BuildProfileOptions = {},
): Promise<DirectoryProfileViewModel> {
  // Keyed on canModerate too: a hover/press prefetch (no options) must not
  // hand an admin's later load the non-moderate view model it cached first.
  const cacheKey = `${directoryId}::${options.canModerate ? "mod" : "std"}`
  if (!force) {
    const existing = inflight.get(cacheKey)
    if (existing) return existing
  }
  const request = (async () => {
    const parsed = parseDirectoryId(directoryId)
    if (!parsed) throw Object.assign(new Error("not-found"), { code: "not-found" })
    const sourceCollection = parsed.type === "person" ? "contacts" : "contexts"
    const [snapshot, sourceSnapshot] = await Promise.all([
      getDoc(doc(directoryDb, "directoryIndex", directoryId)),
      getDoc(doc(directoryDb, sourceCollection, parsed.sourceId)),
    ])
    if (!snapshot.exists()) throw Object.assign(new Error("not-found"), { code: "not-found" })
    const data = snapshot.data()
    const sourceId = text(data.sourceId) || parsed.sourceId
    const index: ProfileIndexInput = {
      id: snapshot.id,
      type: parsed.type,
      sourceCollection,
      sourceId,
      name: text(data.name),
      subtitle: text(data.subtitle) || null,
      role: text(data.role) || null,
      location: text(data.location) || null,
      companyName: text(data.companyName) || null,
      companyEntityId: text(data.companyEntityId) || null,
      linkedUserId: text(data.linkedUserId) || null,
      quality: (data.quality && typeof data.quality === "object" ? data.quality : null) as ProfileIndexInput["quality"],
    }
    return buildProfileViewModel(index, (sourceSnapshot.data() ?? {}) as Record<string, unknown>, options)
  })()
  inflight.set(cacheKey, request)
  void request
    .finally(() => {
      if (inflight.get(cacheKey) === request) inflight.delete(cacheKey)
    })
    .catch(() => {})
  return request
}

export function prefetchDirectoryProfile(directoryId: string): void {
  loadDirectoryProfileViewModel(directoryId).catch(() => {})
}
