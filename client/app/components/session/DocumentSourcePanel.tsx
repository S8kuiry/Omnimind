'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchDocumentPage } from '@/lib/api'
import { resolveDocName } from '@/lib/docName'
import { findRelevantExcerpt } from '@/lib/sectionSources'
import { X } from 'lucide-react'

interface Props {
  docName: string
  page: number
  snippet?: string
  sectionContext?: string
  userId: string
  chatId: string
  knownDocs?: string[]
  onClose: () => void
}

function formatLoadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('404')) {
    return 'No text found for this page. The citation may point to the wrong page, or the PDF was removed from this chat.'
  }
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return 'Could not reach the API server. Set NEXT_PUBLIC_BASE_URL on Vercel to your Render (or other) backend URL, then redeploy.'
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw || 'Unknown error'
}

export default function DocumentSourcePanel({
  docName,
  page,
  snippet,
  sectionContext,
  userId,
  chatId,
  knownDocs = [],
  onClose,
}: Props) {
  const resolvedDoc = resolveDocName(docName, knownDocs)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showFullPage, setShowFullPage] = useState(false)
  const markRef = useRef<HTMLElement | null>(null)

  const contextForMatch = sectionContext?.trim() || snippet?.trim() || ''

  useEffect(() => {
    setLoading(true)
    setText(null)
    setShowFullPage(false)

    if (!chatId) {
      setText('Chat session not ready yet.')
      setLoading(false)
      return
    }

    fetchDocumentPage(resolvedDoc, page, userId, chatId, snippet)
      .then(data => {
        const excerpt = contextForMatch
          ? findRelevantExcerpt(data.text, contextForMatch)
          : (snippet || data.text.slice(0, 520))
        setText(excerpt || data.text.slice(0, 520))
      })
      .catch(err => setText(formatLoadError(err)))
      .finally(() => setLoading(false))
  }, [resolvedDoc, page, userId, chatId, snippet, sectionContext])

  useEffect(() => {
    if (markRef.current) {
      markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [text])

  const renderText = () => {
    if (!text) return null
    if (showFullPage) {
      return <p className="whitespace-pre-wrap">{text}</p>
    }

    if (!contextForMatch) {
      return <p className="whitespace-pre-wrap">{text}</p>
    }

    const lowerText = text.toLowerCase()
    const keywords = contextForMatch
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g)
      ?.filter(w => !['with', 'from', 'that', 'this', 'your', 'have', 'been'].includes(w))
      .slice(0, 8) ?? []

    let highlightStart = -1
    let highlightEnd = -1
    for (const kw of keywords) {
      const idx = lowerText.indexOf(kw)
      if (idx !== -1) {
        highlightStart = idx
        highlightEnd = Math.min(text.length, idx + Math.max(kw.length, 40))
        break
      }
    }

    if (highlightStart === -1) {
      return <p className="whitespace-pre-wrap">{text}</p>
    }

    return (
      <p className="whitespace-pre-wrap">
        {text.slice(0, highlightStart)}
        <mark
          ref={markRef}
          className="bg-yellow-200 text-yellow-900 rounded px-0.5"
        >
          {text.slice(highlightStart, highlightEnd)}
        </mark>
        {text.slice(highlightEnd)}
      </p>
    )
  }

  return (
    <div className="flex flex-col h-full w-full bg-white border-l border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate" title={resolvedDoc}>
            {docName}
          </p>
          <p className="text-xs text-gray-400">Page {page}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!loading && text && (
          <button
            type="button"
            onClick={() => {
              setShowFullPage(true)
              setLoading(true)
              fetchDocumentPage(resolvedDoc, page, userId, chatId, snippet)
                .then(data => setText(data.text))
                .catch(err => setText(formatLoadError(err)))
                .finally(() => setLoading(false))
            }}
            className="mb-3 text-xs text-rose-600 hover:text-rose-700 underline"
          >
            View full page
          </button>
        )}
        <div
          className="rounded-lg p-6 min-h-full text-sm leading-relaxed text-gray-800"
          style={{ backgroundColor: '#f5f2eb', fontFamily: 'Georgia, serif' }}
        >
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="h-3 bg-gray-300 rounded"
                  style={{ width: `${70 + (i % 3) * 10}%` }}
                />
              ))}
            </div>
          ) : (
            renderText()
          )}
        </div>
      </div>
    </div>
  )
}
