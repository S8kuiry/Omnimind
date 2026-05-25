export type ChunkRef = { source: string; page: number; snippet: string; text?: string }

export type SourceRef = {
  source: string
  page: number
  snippet?: string
  label?: string
  /** Assistant section text — used to find the right PDF excerpt in the viewer */
  sectionContext?: string
}

/** Extra weight when matching Pinecone chunks to a section heading */
const SECTION_KEYWORDS: Record<string, string[]> = {
  overview: ['summary', 'contact', 'email', 'portfolio', 'kolkata'],
  'technical skills': ['skills', 'frontend', 'backend', 'languages', 'frameworks'],
  projects: ['project', 'built', 'platform', 'stack', 'github', 'sign talk', 'orbithire'],
  experience: ['intern', 'pawmax', 'android', 'hybrid', 'developer', 'play store', 'employment'],
  education: ['university', 'b.tech', 'degree', 'graduation', 'adamas', 'engineering'],
}

/** Normalize section titles for matching LLM headings to source labels. */
export function normalizeHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Map section label → source for inline citation chips on ## headings. */
export function citationMapFromSources(sources: SourceRef[] | undefined): Map<string, SourceRef> {
  const map = new Map<string, SourceRef>()
  if (!sources) return map
  for (const s of sources) {
    if (!s.label) continue
    map.set(normalizeHeading(s.label), s)
  }
  return map
}

export function hasInlineSectionCitations(sources: SourceRef[] | undefined): boolean {
  return Boolean(sources?.some(s => s.label))
}

const STOP = new Set(
  'a an the and or for with from your you are is in on at to of by as be has have'.split(' '),
)

function tokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  return new Set(words.filter(w => !STOP.has(w)))
}

function overlapScore(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let n = 0
  for (const w of ta) if (tb.has(w)) n++
  return n / Math.sqrt(ta.size * tb.size)
}

function chunkProbeText(c: ChunkRef): string {
  return (c.text || c.snippet || '').trim()
}

function scoreChunkForSection(heading: string, body: string, chunk: ChunkRef): number {
  const probe = `${heading} ${body}`
  let score = overlapScore(probe, chunkProbeText(chunk))
  const boosts = SECTION_KEYWORDS[normalizeHeading(heading)] ?? []
  const lower = chunkProbeText(chunk).toLowerCase()
  for (const kw of boosts) {
    if (lower.includes(kw)) score += 0.12
  }
  return score
}

/** Best sentence(s) in chunk text for this section (not the whole chunk). */
export function pickSnippetFromChunk(chunkText: string, heading: string, body: string, maxLen = 280): string {
  const probe = `${heading} ${body}`
  const sentences = chunkText.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 20)
  let best = ''
  let bestScore = 0
  for (const s of sentences) {
    const sc = overlapScore(probe, s)
    if (sc > bestScore) {
      bestScore = sc
      best = s
    }
  }
  if (bestScore > 0.06 && best) return best.slice(0, maxLen)
  return chunkText.slice(0, maxLen)
}

/** Find the PDF paragraph that best matches the assistant section (for source viewer). */
export function findRelevantExcerpt(pageText: string, context: string, maxLen = 520): string {
  if (!pageText.trim()) return ''
  if (!context.trim()) return pageText.slice(0, maxLen)

  const blocks = pageText.split(/\n{2,}|\n(?=[A-Z][a-z])/).map(b => b.trim()).filter(b => b.length > 30)
  let best = blocks[0] ?? pageText
  let bestScore = 0

  for (const block of blocks) {
    const sc = overlapScore(context, block)
    if (sc > bestScore) {
      bestScore = sc
      best = block
    }
  }

  if (bestScore < 0.04) {
    const sentences = pageText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 25)
    for (const s of sentences) {
      const sc = overlapScore(context, s)
      if (sc > bestScore) {
        bestScore = sc
        best = s
      }
    }
  }

  const out = best.trim()
  return out.length > maxLen ? `${out.slice(0, maxLen)}…` : out
}

export type ContentSection = {
  heading: string | null
  body: string
  source?: SourceRef
}

/** Strip inline citations from visible markdown (chips handle sources). */
export function stripCitationTags(text: string): string {
  return text
    .replace(/\[Source:[^\]]*\]/gi, '')
    .replace(/^\s*Source:\s*[^\n]+\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Split on ## and ### headings for per-section citation chips. */
export function parseCitationSections(content: string): ContentSection[] {
  const trimmed = stripCitationTags(content.trim())
  if (!trimmed) return []

  const parts = trimmed.split(/(?=^#{2,3}\s+)/m)
  const sections: ContentSection[] = []

  for (const part of parts) {
    const block = part.trim()
    if (!block) continue
    const headMatch = block.match(/^(#{2,3})\s+(.+?)(?:\r?\n|$)([\s\S]*)/)
    if (headMatch) {
      sections.push({
        heading: headMatch[2].trim(),
        body: headMatch[3].trim(),
      })
    } else if (sections.length === 0) {
      sections.push({ heading: null, body: block })
    } else {
      sections[sections.length - 1].body += `\n\n${block}`
    }
  }

  return sections.length ? sections : [{ heading: null, body: trimmed }]
}

/** @deprecated use parseCitationSections */
export function parseContentSections(content: string): ContentSection[] {
  return parseCitationSections(content)
}

/**
 * Match each ## section to the best retrieved chunk so every section gets its own citation chip.
 */
export function buildSectionSources(
  content: string,
  chunks: ChunkRef[],
): SourceRef[] {
  if (!chunks.length) return []

  const sections = parseCitationSections(content)
  const used = new Set<number>()
  const out: SourceRef[] = []

  const norm = (s: string) => s.replace(/\.pdf$/i, '')

  for (const sec of sections) {
    const probe = `${sec.heading ?? ''} ${sec.body}`.trim()
    if (!probe) continue

    let bestIdx = -1
    let bestScore = 0
    chunks.forEach((c, i) => {
      const score = scoreChunkForSection(sec.heading ?? '', sec.body, c)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    })

    const c = chunks[bestIdx >= 0 ? bestIdx : 0]
    const label = sec.heading ?? undefined
    if (!label) continue

    const key = normalizeHeading(label)
    if (out.some(s => s.label && normalizeHeading(s.label) === key)) continue

    if (bestIdx >= 0) used.add(bestIdx)
    out.push({
      source: norm(c.source),
      page: c.page,
      snippet: pickSnippetFromChunk(chunkProbeText(c), label, sec.body),
      sectionContext: sec.body.slice(0, 800),
      label,
    })
  }

  return out
}

/** One citation chip per ## heading — uses chunk overlap when possible, else cycles chunks. */
export function sectionSourcesFromHeadings(
  content: string,
  chunks: ChunkRef[],
): SourceRef[] {
  const sections = parseCitationSections(content).filter(s => s.heading)
  if (!sections.length || !chunks.length) return []

  const norm = (s: string) => s.replace(/\.pdf$/i, '')

  return sections.map((sec, i) => {
    const probe = `${sec.heading} ${sec.body}`.trim()
    let best = chunks[i % chunks.length]
    let bestScore = 0
    chunks.forEach(c => {
      const score = scoreChunkForSection(sec.heading!, sec.body, c)
      if (score >= bestScore) {
        bestScore = score
        best = c
      }
    })
    return {
      source: norm(best.source),
      page: best.page,
      snippet: pickSnippetFromChunk(chunkProbeText(best), sec.heading!, sec.body),
      sectionContext: sec.body.slice(0, 800),
      label: sec.heading!,
    }
  })
}

/**
 * Guarantee inline chips: use labeled sources from stream, or build from ## headings + doc.
 */
export function ensureSectionSources(
  content: string,
  sources: SourceRef[] | undefined,
  defaultDoc?: string,
): SourceRef[] | undefined {
  const sections = parseCitationSections(content).filter(s => s.heading)

  if (hasInlineSectionCitations(sources)) {
    return sources!.map(s => {
      if (s.sectionContext || !s.label) return s
      const sec = sections.find(
        x => x.heading && normalizeHeading(x.heading) === normalizeHeading(s.label!),
      )
      return sec ? { ...s, sectionContext: sec.body.slice(0, 800) } : s
    })
  }
  if (!sections.length) return sources

  const base: SourceRef | null =
    sources?.[0] ??
    (defaultDoc
      ? { source: defaultDoc.replace(/\.pdf$/i, ''), page: 1 }
      : null)

  if (!base?.source) return sources

  return sections.map(sec => ({
    source: base.source,
    page: base.page ?? 1,
    snippet: base.snippet,
    sectionContext: sec.body.slice(0, 800),
    label: sec.heading!,
  }))
}

/** Merge LLM-parsed sources with section-based ones (prefer labeled section entries). */
export function mergeSourceLists(
  llmSources: SourceRef[],
  sectionSources: SourceRef[],
): SourceRef[] {
  const seen = new Set<string>()
  const merged: SourceRef[] = []

  for (const s of sectionSources) {
    const key = `${s.label ?? ''}|${s.source}|${s.page}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(s)
  }

  for (const s of llmSources) {
    const key = `|${s.source}|${s.page}`
    if (sectionSources.some(ss => ss.source === s.source && ss.page === s.page && ss.label)) {
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(s)
  }

  return merged
}
