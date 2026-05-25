/** Match backend `main._normalize_doc_name` so citations resolve to Pinecone `source`. */
export function normalizeDocName(name: string): string {
  return name.trim().replace(/\.pdf$/i, '').replace(/ /g, '_')
}

/** Pick the stored doc id when the LLM cited a shortened or human-readable name. */
export function resolveDocName(requested: string, knownDocs: string[]): string {
  const norm = normalizeDocName(requested)
  if (!knownDocs.length) return norm

  const exact = knownDocs.find(d => d === norm || normalizeDocName(d) === norm)
  if (exact) return exact

  const lower = norm.toLowerCase()
  const contains = knownDocs.find(d => {
    const dn = normalizeDocName(d).toLowerCase()
    return dn.includes(lower) || lower.includes(dn)
  })
  return contains ? contains : norm
}
