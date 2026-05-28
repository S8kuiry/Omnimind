'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchDocumentPage } from '@/lib/api'
import { resolveDocName } from '@/lib/docName'
import { findRelevantExcerpt } from '@/lib/sectionSources'
import { X, Pencil, Check, Download, FileText, Loader2 } from 'lucide-react'
import jsPDF from 'jspdf'

interface Props {
  docName: string
  page: number
  snippet?: string
  sectionContext?: string
  userId: string
  chatId: string
  knownDocs?: string[]
  allPages?: boolean
  onClose: () => void
}

function formatLoadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('404'))
    return 'No text found for this page. The citation may point to the wrong page, or the PDF was removed from this chat.'
  if (/failed to fetch|networkerror|load failed/i.test(raw))
    return 'Could not reach the API server. Check your NEXT_PUBLIC_BASE_URL env var.'
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
  allPages = false,
  onClose,
}: Props) {
  const resolvedDoc = resolveDocName(docName, knownDocs)

  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPage, setLoadingPage] = useState<number | null>(null)
  const [showFullPage, setShowFullPage] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editedText, setEditedText] = useState<string>('')
  const [savedIndicator, setSavedIndicator] = useState(false)

  const markRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const contextForMatch = sectionContext?.trim() || snippet?.trim() || ''
  const lsKey = `omnimind_edit_${chatId}_${resolvedDoc}_${allPages ? 'all' : `p${page}`}`

  // ── Seed editedText when text loads ────────────────────────────
  useEffect(() => {
    if (!text) return
    try {
      const raw = localStorage.getItem(lsKey)
      if (raw) {
        const { text: saved, savedAt, ttl } = JSON.parse(raw)
        if (Date.now() - savedAt < ttl) { setEditedText(saved); return }
        localStorage.removeItem(lsKey)
      }
    } catch { }
    setEditedText(text)
  }, [text])

  // ── Persist edits ───────────────────────────────────────────────
  useEffect(() => {
    if (!editedText || !editMode) return
    try {
      localStorage.setItem(lsKey, JSON.stringify({
        text: editedText,
        savedAt: Date.now(),
        ttl: 7 * 24 * 60 * 60 * 1000,
      }))
    } catch { }
  }, [editedText, editMode])

  // ── Fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    setText(null)
    setShowFullPage(false)
    setEditMode(false)

    if (!chatId) {
      setText('Chat session not ready yet.')
      setLoading(false)
      return
    }

    if (allPages) {
      ; (async () => {
        let fullText = ''
        let p = 1
        while (true) {
          setLoadingPage(p)
          try {
            const data = await fetchDocumentPage(resolvedDoc, p, userId, chatId)
            fullText += (p > 1 ? '\n\n' : '') + `— Page ${p} —\n\n${data.text}`
            p++
          } catch {
            break
          }
        }
        setLoadingPage(null)
        setText(fullText.trim() || 'No content found.')
        setLoading(false)
      })()
      return
    }

    fetchDocumentPage(resolvedDoc, page, userId, chatId, snippet)
      .then(data => {
        const excerpt = contextForMatch
          ? findRelevantExcerpt(data.text, contextForMatch)
          : snippet || data.text.slice(0, 520)
        setText(excerpt || data.text.slice(0, 520))
      })
      .catch(err => setText(formatLoadError(err)))
      .finally(() => setLoading(false))
  }, [resolvedDoc, page, userId, chatId, snippet, sectionContext, allPages])

  // ── Scroll highlight ────────────────────────────────────────────
  useEffect(() => {
    if (markRef.current)
      markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [text])

  // ── Focus textarea on edit mode ─────────────────────────────────
  useEffect(() => {
    if (editMode && textareaRef.current) {
      const ta = textareaRef.current
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [editMode])

  // ── Auto-resize textarea ────────────────────────────────────────
  useEffect(() => {
    if (!editMode || !textareaRef.current) return
    const ta = textareaRef.current
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [editedText, editMode])

  const handleSaveDone = () => {
    setEditMode(false)
    setSavedIndicator(true)
    setTimeout(() => setSavedIndicator(false), 2000)
  }

  const handleExport = () => {
    const doc = new jsPDF()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(150)
    doc.text(`${docName}${allPages ? '' : `  ·  Page ${page}`}`, 20, 12)
    doc.setTextColor(0)
    doc.line(20, 15, 190, 15)
    doc.setFontSize(11)
    const lines = doc.splitTextToSize(editedText, 170)
    doc.text(lines, 20, 22)
    doc.save(`${docName}${allPages ? '-full' : `-p${page}`}-edited.pdf`)
  }

  const renderHighlighted = (src: string) => {
    if (!contextForMatch) return <p className="whitespace-pre-wrap">{src}</p>
    const lower = src.toLowerCase()
    const keywords = contextForMatch
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g)
      ?.filter(w => !['with', 'from', 'that', 'this', 'your', 'have', 'been'].includes(w))
      .slice(0, 8) ?? []
    let start = -1, end = -1
    for (const kw of keywords) {
      const idx = lower.indexOf(kw)
      if (idx !== -1) { start = idx; end = Math.min(src.length, idx + Math.max(kw.length, 40)); break }
    }
    if (start === -1) return <p className="whitespace-pre-wrap">{src}</p>
    return (
      <p className="whitespace-pre-wrap">
        {src.slice(0, start)}
        <mark ref={markRef} className="rounded px-0.5"
          style={{ background: 'rgba(210,140,160,0.35)', color: 'inherit' }}>
          {src.slice(start, end)}
        </mark>
        {src.slice(end)}
      </p>
    )
  }

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: 'rgba(210,140,160,0.6)' }} />
          {loadingPage && (
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Loading page {loadingPage}…
            </p>
          )}
        </div>
      )
    }
    if (!text) return null
    if (editMode) {
      return (
        <textarea
          ref={textareaRef}
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          className="w-full bg-transparent outline-none resize-none text-sm leading-relaxed"
          style={{
            color: 'rgba(255,255,255,0.82)',
            fontFamily: 'Georgia, serif',
            caretColor: 'rgba(210,140,160,0.9)',
            minHeight: '300px',
          }}
          spellCheck={false}
        />
      )
    }
    return renderHighlighted(text)
  }

  return (
    <div className="flex flex-col h-full w-full"
      style={{ background: 'rgba(39, 35, 35, 0.86)', borderLeft: '1px solid rgba(210,140,160,0.1)' }}>

      <div className='w-[100%] w-auto flex flex-col pt-2'    style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>

        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={13} style={{ color: 'rgba(210,140,160,0.6)', flexShrink: 0 }} />
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}
                title={resolvedDoc}>{docName}</p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {allPages ? 'Full document' : `Page ${page}`}
                {savedIndicator && <span className="ml-2" style={{ color: 'rgba(210,140,160,0.8)' }}>✓ saved</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => editMode ? handleSaveDone() : setEditMode(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer hover:text-rose-400 hover:bg-rose-400/10"
              style={{
                background: editMode ? 'rgba(210,140,160,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${editMode ? 'rgba(210,140,160,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: editMode ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.45)',
              }}
            >
              {editMode ? <><Check size={11} /> Done</> : <><Pencil size={11} /> Edit</>}
            </button>

            {text && !loading && editMode && (
              <button onClick={handleExport}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(210,140,160,0.9)'; e.currentTarget.style.borderColor = 'rgba(210,140,160,0.3)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
              >
                <Download size={11} /> Save as PDF
              </button>
            )}

            <button onClick={onClose}
              className="p-1.5 rounded-md transition-colors cursor-pointer"
              style={{ color: 'rgba(255,255,255,0.3)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {editMode && (
          <div className="w-full text-left w-auto py-3 px-4">
            <p className="text-xs text-left">Edited PDFs will not be save. It is adviced to download immediately after Editing </p>
           
          </div>
        )}

      </div>

      {!loading && text && !editMode && !allPages && (
        <div className="px-4 pt-2.5 flex-shrink-0">
          <button type="button"
            onClick={() => {
              setShowFullPage(true); setLoading(true)
              fetchDocumentPage(resolvedDoc, page, userId, chatId, snippet)
                .then(data => setText(data.text))
                .catch(err => setText(formatLoadError(err)))
                .finally(() => setLoading(false))
            }}
            className="text-[11px] underline transition-colors"
            style={{ color: 'rgba(210,140,160,0.6)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(210,140,160,0.9)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(210,140,160,0.6)')}
          >
            {showFullPage ? 'Showing full page' : 'View full page'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-xl p-5 min-h-full text-sm leading-relaxed"
          style={{
            background: editMode ? 'rgba(142, 97, 109, 0.86)' : 'rgba(96, 91, 91, 0.75)',
            border: editMode ? '1px solid rgba(210,140,160,0.2)' : '1px solid rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.75)',
            fontFamily: 'Georgia, serif',
            transition: 'border 0.2s, background 0.2s',
          }}
        >
          {renderBody()}
        </div>
        {/* {editMode && (
          <p className="mt-2 text-[10px] text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Ctrl+Z / Cmd+Z to undo · Auto-saved locally · Export to download as PDF
          </p>
        )} */}
      </div>
    </div>
  )
}