'use client'

import type { SourceRef } from '@/lib/sectionSources'
import { normalizeDocName } from '@/lib/docName'

/** Short doc label for inline chips, e.g. `Resume_Final-p1` */
export function formatSourceChipLabel(source: SourceRef, maxLen = 22): string {
  const doc = source.source.replace(/\.pdf$/i, '').replace(/_/g, ' ')
  const short = doc.length > maxLen ? `${doc.slice(0, maxLen - 1)}…` : doc
  return `${short}-p${source.page}`
}

export default function SourceChip({
  source,
  onOpen,
  compact = false,
}: {
  source: SourceRef
  onOpen?: (docName: string, page: number, snippet?: string, sectionContext?: string) => void
  /** Inline citation beside a section heading */
  compact?: boolean
}) {
  const doc = normalizeDocName(source.source)
  const label = source.label ?? doc.replace(/_/g, ' ')

  return (
    <button
      type="button"
      onClick={() => onOpen?.(doc, source.page, source.snippet, source.sectionContext)}
      title={`${doc.replace(/_/g, ' ')}, page ${source.page}`}
      className={`text-[10px] rounded-full cursor-pointer transition-all duration-200 shrink-0 ${
        compact ? 'px-2 py-0.5 max-w-[160px] truncate' : 'px-2.5 py-1'
      }`}
      style={{
        background: 'rgba(210,140,160,0.08)',
        color: 'rgba(255,255,255,0.35)',
        border: '1px solid rgba(210,140,160,0.15)',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget
        el.style.background = 'rgba(210,140,160,0.18)'
        el.style.color = 'rgba(210,140,160,0.95)'
        el.style.borderColor = 'rgba(210,140,160,0.5)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.background = 'rgba(210,140,160,0.08)'
        el.style.color = 'rgba(255,255,255,0.35)'
        el.style.borderColor = 'rgba(210,140,160,0.15)'
      }}
    >
      {compact ? formatSourceChipLabel(source) : `📄 ${label} · p${source.page}`}
    </button>
  )
}
