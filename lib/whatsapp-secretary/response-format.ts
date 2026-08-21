/**
 * Model-facing presentation contracts for the WhatsApp Secretary.
 *
 * Tool data remains the source of truth. These compact contracts tell the
 * model which small slice is worth presenting when a user asks for details,
 * so a Directory profile, an application and a project do not each invent a
 * different response shape. They intentionally contain no ids, URLs, or
 * attachment targets — those stay in `SecretaryToolResult.presentation`.
 */

const MAX_TITLE_CHARACTERS = 120
const MAX_FIELD_LABEL_CHARACTERS = 40
const MAX_FIELD_VALUE_CHARACTERS = 280
const MAX_SECTION_LABEL_CHARACTERS = 48
const MAX_SECTION_ITEM_CHARACTERS = 360
const MAX_FIELDS = 6
const MAX_SECTIONS = 3
const MAX_SECTION_ITEMS = 4

export type SecretaryResponseField = {
  label: string
  value: string
}

export type SecretaryResponseSection = {
  label: string
  items: string[]
}

/** A one-record profile: title, labelled facts, then at most a few short sections. */
export type SecretaryDetailCardFormat = {
  kind: "detail-card"
  title: string
  fields: SecretaryResponseField[]
  sections?: SecretaryResponseSection[]
}

/** An ordered, time-based result such as clock history or Communications. */
export type SecretaryTimelineFormat = {
  kind: "timeline"
  title: string
  fields?: SecretaryResponseField[]
  items: string[]
}

export type SecretaryResponseFormat = SecretaryDetailCardFormat | SecretaryTimelineFormat

function clean(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function cleanFields(fields: Array<SecretaryResponseField | null | undefined>): SecretaryResponseField[] {
  return fields
    .flatMap((field) => (field ? [field] : []))
    .map((field) => ({ label: clean(field.label, MAX_FIELD_LABEL_CHARACTERS), value: clean(field.value, MAX_FIELD_VALUE_CHARACTERS) }))
    .filter((field) => field.label && field.value)
    .slice(0, MAX_FIELDS)
}

function cleanSections(sections: Array<SecretaryResponseSection | null | undefined>): SecretaryResponseSection[] {
  return sections
    .flatMap((section) => (section ? [section] : []))
    .map((section) => ({
      label: clean(section.label, MAX_SECTION_LABEL_CHARACTERS),
      items: section.items.map((item) => clean(item, MAX_SECTION_ITEM_CHARACTERS)).filter(Boolean).slice(0, MAX_SECTION_ITEMS),
    }))
    .filter((section) => section.label && section.items.length > 0)
    .slice(0, MAX_SECTIONS)
}

export function detailCard(input: {
  title: string
  fields: Array<SecretaryResponseField | null | undefined>
  sections?: Array<SecretaryResponseSection | null | undefined>
}): SecretaryDetailCardFormat {
  const sections = cleanSections(input.sections ?? [])
  return {
    kind: "detail-card",
    title: clean(input.title, MAX_TITLE_CHARACTERS),
    fields: cleanFields(input.fields),
    ...(sections.length > 0 ? { sections } : {}),
  }
}

export function timeline(input: {
  title: string
  fields?: Array<SecretaryResponseField | null | undefined>
  items: string[]
}): SecretaryTimelineFormat {
  const fields = cleanFields(input.fields ?? [])
  return {
    kind: "timeline",
    title: clean(input.title, MAX_TITLE_CHARACTERS),
    ...(fields.length > 0 ? { fields } : {}),
    items: input.items.map((item) => clean(item, MAX_SECTION_ITEM_CHARACTERS)).filter(Boolean).slice(0, MAX_SECTION_ITEMS),
  }
}
