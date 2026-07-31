import { effectiveProjectStatus, type Project } from "@/lib/quest-coral-core"

export interface ProjectAccent {
  ring: string
  track: string
  soft: string
  border: string
  text: string
}

/** One status color system for project cards and their detail view. */
export function projectAccent(project: Project): ProjectAccent {
  const status = effectiveProjectStatus(project)
  if (status === "completed") {
    return { ring: "#35B868", track: "#E6F7EC", soft: "#FFFFFF", border: "#C7EED5", text: "#229654" }
  }
  if (status === "at_risk") {
    return { ring: "#F2A93B", track: "#FEF0D6", soft: "#FFFFFF", border: "#F9E2B6", text: "#B76A04" }
  }
  if (status === "planning") {
    return { ring: "#5B91F1", track: "#E9F1FF", soft: "#FFFFFF", border: "#D6E5FE", text: "#3E78D5" }
  }
  return { ring: "#FF6B52", track: "#FFE9E2", soft: "#FFFFFF", border: "#FFDCD2", text: "#E8593A" }
}
