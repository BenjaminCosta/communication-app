/// <reference lib="webworker" />

import MiniSearch from "minisearch"
import { DIRECTORY_MINISEARCH_CONFIG, type DirectorySearchDoc } from "@/lib/directory"

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

self.onmessage = (event: MessageEvent<{ documents: DirectorySearchDoc[] }>) => {
  try {
    const miniSearch = new MiniSearch<DirectorySearchDoc>({
      idField: DIRECTORY_MINISEARCH_CONFIG.idField,
      fields: [...DIRECTORY_MINISEARCH_CONFIG.fields],
      storeFields: [...DIRECTORY_MINISEARCH_CONFIG.storeFields],
      processTerm: normalizeSearchText,
    })
    miniSearch.addAll(event.data.documents)
    self.postMessage({ indexJson: JSON.stringify(miniSearch) })
  } catch {
    self.postMessage({})
  }
}

export {}
