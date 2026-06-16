'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchDocumentPage, fetchDocumentFull } from '@/lib/api'
import { resolveDocName } from '@/lib/docName'
import { normalizeChunkedPageText, prepareDocumentExportText } from '@/lib/markdownNormalize'
import { findRelevantExcerpt } from '@/lib/sectionSources'
import { X, Pencil, Check, Download, FileText, Loader2, ChevronDown } from 'lucide-react'
import jsPDF from 'jspdf'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
  Header,
  Footer,
  PageNumber,
} from 'docx'
import { saveAs } from 'file-saver'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Shared Markdown Parser ───────────────────────────────────────────────────

type InlineSegment =
  | { kind: 'text'; text: string; bold: boolean; italic: boolean }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'image'; alt: string; src: string }

/** Parse inline markdown: **bold**, *italic*, [text](url), ![alt](src), bare URLs */
function parseInline(raw: string): InlineSegment[] {
  const TOKEN =
    /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|(https?:\/\/[^\s)>"]+)/g
  const out: InlineSegment[] = []
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = TOKEN.exec(raw)) !== null) {
    if (m.index > cursor)
      out.push({ kind: 'text', text: raw.slice(cursor, m.index), bold: false, italic: false })

    if (m[1] !== undefined)       out.push({ kind: 'image', alt: m[1], src: m[2] })
    else if (m[3] !== undefined)  out.push({ kind: 'link', text: m[3], url: m[4] })
    else if (m[5] !== undefined)  out.push({ kind: 'text', text: m[5], bold: true,  italic: false })
    else if (m[6] !== undefined)  out.push({ kind: 'text', text: m[6], bold: false, italic: true })
    else if (m[7] !== undefined)  out.push({ kind: 'link', text: m[7], url: m[7] })

    cursor = m.index + m[0].length
  }

  if (cursor < raw.length)
    out.push({ kind: 'text', text: raw.slice(cursor), bold: false, italic: false })

  return out
}

// Page-header sentinel lines injected by the allPages fetcher, e.g. "— Page 3 —"
const PAGE_SENTINEL_RE = /^—\s*Page\s+\d+\s*—$/

type LineKind =
  | { type: 'h1' | 'h2' | 'h3'; text: string }
  | { type: 'bullet' | 'body'; text: string }
  | { type: 'numbered'; text: string; n: number }
  | { type: 'name' | 'location' | 'contact' | 'salutation' | 'metadata'; text: string }
  | { type: 'hr' | 'blank' }

/** Letters/resumes: body is the document — skip decorative page headers. */
function isLetterStyleDocument(text: string): boolean {
  return /\bDear\s+/i.test(prepareDocumentExportText(text))
}

const EXPORT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+(\s*\|\s*.+)?$/
const EXPORT_PHONE_RE = /^\+?\d[\d\s-]{7,}\d(\s*\|\s*.+)?$/
const EXPORT_CITY_RE = /^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*$/
const EXPORT_NAME_RE = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/

function classifyLine(line: string): LineKind {
  const t = line.trimEnd()
  const trimmed = t.trim()
  if (!trimmed) return { type: 'blank' }
  if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(trimmed)) return { type: 'hr' }
  if (PAGE_SENTINEL_RE.test(trimmed)) return { type: 'metadata', text: trimmed }
  if (/^Page\s+\d+$/i.test(trimmed)) return { type: 'metadata', text: trimmed }
  if (/^[A-Za-z0-9_.\s-]+[:·]\s*Page\s+\d+\s*:?\s*$/i.test(trimmed))
    return { type: 'metadata', text: trimmed }
  if (/^[A-Za-z0-9_.-]{8,}$/.test(trimmed) && trimmed.includes('_'))
    return { type: 'metadata', text: trimmed }
  if (t.startsWith('### ')) return { type: 'h3', text: t.slice(4) }
  if (t.startsWith('## '))  return { type: 'h2', text: t.slice(3) }
  if (t.startsWith('# '))   return { type: 'h1', text: t.slice(2) }
  if (EXPORT_EMAIL_RE.test(trimmed) || EXPORT_PHONE_RE.test(trimmed))
    return { type: 'contact', text: trimmed }
  if (/^Dear\s+.+,?\s*$/i.test(trimmed))
    return { type: 'salutation', text: trimmed }
  if (trimmed.length <= 40 && EXPORT_NAME_RE.test(trimmed))
    return { type: 'name', text: trimmed }
  if (trimmed.length <= 60 && EXPORT_CITY_RE.test(trimmed))
    return { type: 'location', text: trimmed }
  const bullet   = t.match(/^[-*+]\s+(.*)/)
  if (bullet)    return { type: 'bullet', text: bullet[1] }
  const numbered = t.match(/^(\d+)\.\s+(.*)/)
  if (numbered)  return { type: 'numbered', n: parseInt(numbered[1]), text: numbered[2] }
  return { type: 'body', text: t }
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function exportPdf(opts: {
  docName: string
  page: number
  allPages: boolean
  userId?: string
  editedText: string
}) {
  const { docName, page, allPages, userId, editedText } = opts
  const content = prepareDocumentExportText(editedText)
  const letterStyle = isLetterStyleDocument(editedText)

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({
    title: docName,
    subject: allPages ? 'Full Document' : `Page ${page}`,
    author: userId || '',
    creator: 'Document Viewer',
  })

  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const ML = 20, MR = 20, MT = letterStyle ? 20 : 25, MB = 20
  const CW = PW - ML - MR
  let y = MT

  // ── Header / footer ──────────────────────────────────────────────────────────
  const drawHeader = () => {
    if (letterStyle) return
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(153, 153, 153)
    doc.text(`${docName}${allPages ? '  ·  Full Document' : `  ·  Page ${page}`}`, ML, 12)
    doc.setDrawColor(161, 98, 112)
    doc.setLineWidth(0.4)
    doc.line(ML, 15, PW - MR, 15)
  }

  const drawFooter = () => {
    if (letterStyle) return
    const n = (doc.internal as any).getNumberOfPages()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(153, 153, 153)
    doc.text(String(n), PW / 2, PH - 8, { align: 'center' })
  }

  const newPage = () => {
    drawFooter()
    doc.addPage()
    drawHeader()
    y = MT
  }

  const guard = (h: number) => { if (y + h > PH - MB) newPage() }

  drawHeader()

  // ── Inline renderer: renders one logical line, advancing y ────────────────
  const renderInlinePdf = (rawText: string, xStart: number, fontSize: number, lineH: number) => {
    const segs = parseInline(rawText)

    segs.forEach((seg) => {
      if (seg.kind === 'image') {
        // Embed base64 data-URI images; skip remote URLs (cross-origin in browser)
        if (seg.src.startsWith('data:image/')) {
          const fmt = /png/i.test(seg.src) ? 'PNG' : 'JPEG'
          guard(55)
          try { doc.addImage(seg.src, fmt, xStart, y, 80, 60); y += 65 } catch { /* skip */ }
        }
        return
      }

      if (seg.kind === 'link') {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(fontSize)
        doc.setTextColor(0, 102, 204)
        const wrapped = doc.splitTextToSize(seg.text, CW - (xStart - ML))
        wrapped.forEach((ln: string) => {
          guard(lineH)
          doc.text(ln, xStart, y)
          // Clickable hitbox: y offset accounts for baseline vs. top-left anchor
          doc.link(xStart, y - lineH * 0.75, doc.getTextWidth(ln), lineH * 0.9, { url: seg.url })
          y += lineH
        })
        return
      }

      // plain / bold / italic text
      const weight = seg.bold ? 'bold' : seg.italic ? 'italic' : 'normal'
      doc.setFont('helvetica', weight)
      doc.setFontSize(fontSize)
      doc.setTextColor(43, 43, 43)
      const wrapped = doc.splitTextToSize(seg.text, CW - (xStart - ML))
      wrapped.forEach((ln: string) => {
        guard(lineH)
        doc.text(ln, xStart, y)
        y += lineH
      })
    })
  }

  // ── Main render loop ──────────────────────────────────────────────────────
  content.split('\n').forEach((rawLine) => {
    const cl = classifyLine(rawLine)

    switch (cl.type) {
      case 'blank': y += 4; return
      case 'metadata': return

      case 'hr':
        guard(6)
        doc.setDrawColor(161, 98, 112); doc.setLineWidth(0.3)
        doc.line(ML, y, PW - MR, y); y += 6
        return

      case 'h1':
        guard(12)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18)
        doc.setTextColor(161, 98, 112)
        doc.text(cl.text, ML, y); y += 12
        return

      case 'h2':
        guard(10)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
        doc.setTextColor(43, 43, 43)
        doc.text(cl.text, ML, y); y += 10
        return

      case 'h3':
        guard(8)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
        doc.setTextColor(43, 43, 43)
        doc.text(cl.text, ML, y); y += 8
        return

      case 'name': {
        guard(10)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
        doc.setTextColor(43, 43, 43)
        doc.text(cl.text, PW / 2, y, { align: 'center' }); y += 7
        return
      }

      case 'location': {
        guard(6)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5)
        doc.setTextColor(80, 80, 80)
        doc.text(cl.text, PW / 2, y, { align: 'center' }); y += 6
        return
      }

      case 'contact': {
        guard(6)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
        doc.setTextColor(80, 80, 80)
        doc.text(cl.text, PW / 2, y, { align: 'center' }); y += 12
        return
      }

      case 'salutation': {
        guard(6)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5)
        doc.setTextColor(43, 43, 43)
        doc.text(cl.text, ML, y); y += 10
        return
      }

      case 'bullet': {
        guard(6)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
        doc.setTextColor(161, 98, 112); doc.text('•', ML, y)
        const beforeY = y
        renderInlinePdf(cl.text, ML + 5, 10, 6)
        if (y === beforeY) y += 6
        y += 2
        return
      }

      case 'numbered': {
        guard(6)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
        doc.setTextColor(161, 98, 112); doc.text(`${cl.n}.`, ML, y)
        const beforeY = y
        renderInlinePdf(cl.text, ML + 7, 10, 6)
        if (y === beforeY) y += 6
        y += 2
        return
      }

      case 'body': {
        guard(6)
        const beforeY = y
        renderInlinePdf(cl.text, ML, 10.5, 6)
        if (y === beforeY) y += 6
        y += 2
        return
      }
    }
  })

  drawFooter()
  doc.save(`${docName}${allPages ? '-full' : `-p${page}`}.pdf`)
}

// ─── DOCX Export ──────────────────────────────────────────────────────────────

function segmentsToDocxChildren(segs: InlineSegment[]) {
  return segs.flatMap((seg): (TextRun | ExternalHyperlink)[] => {
    if (seg.kind === 'image') return []
 
    if (seg.kind === 'link') {
      return [new ExternalHyperlink({
        link: seg.url,
        children: [new TextRun({ text: seg.text, style: 'Hyperlink', font: 'Segoe UI', size: 22 })],
      })]
    }
 
    return [new TextRun({
      text: seg.text,
      bold: seg.bold,
      italics: seg.italic,
      font: 'Segoe UI',
      size: 22,
      color: seg.bold ? '111111' : '333333',
    })]
  })
}
 
// We skip these so they don't appear as stray body text in the exported doc.

async function exportDocx(opts: {
  docName: string
  page: number
  allPages: boolean
  editedText: string
}) {
  const { docName, page, allPages, editedText } = opts
  const content = prepareDocumentExportText(editedText)
  const letterStyle = isLetterStyleDocument(editedText)

  const children: Paragraph[] = []

  content.split('\n').forEach((raw) => {
    const cl = classifyLine(raw)

    switch (cl.type) {
      case 'blank': return

      case 'metadata': return

      case 'hr':
        children.push(new Paragraph({
          children: [],
          border: { bottom: { color: 'AAAAAA', space: 4, style: BorderStyle.SINGLE, size: 4 } },
          spacing: { before: 120, after: 120 },
        }))
        return

      case 'h1':
        children.push(new Paragraph({
          children: segmentsToDocxChildren(parseInline(cl.text)),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }))
        return

      case 'h2':
        children.push(new Paragraph({
          children: segmentsToDocxChildren(parseInline(cl.text)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }))
        return

      case 'h3':
        children.push(new Paragraph({
          children: segmentsToDocxChildren(parseInline(cl.text)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }))
        return

      case 'name':
        children.push(new Paragraph({
          children: [new TextRun({
            text: cl.text,
            bold: true,
            font: 'Segoe UI',
            size: 32,
            color: '111111',
          })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 40 },
        }))
        return

      case 'location':
        children.push(new Paragraph({
          children: [new TextRun({
            text: cl.text,
            font: 'Segoe UI',
            size: 22,
            color: '555555',
          })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 60 },
        }))
        return

      case 'contact':
        children.push(new Paragraph({
          children: [new TextRun({
            text: cl.text,
            font: 'Segoe UI',
            size: 20,
            color: '666666',
          })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 280 },
        }))
        return

      case 'salutation':
        children.push(new Paragraph({
          children: segmentsToDocxChildren(parseInline(cl.text)),
          spacing: { before: 120, after: 120 },
        }))
        return

      case 'bullet':
        children.push(new Paragraph({
          numbering: { reference: 'doc-bullets', level: 0 },
          children: segmentsToDocxChildren(parseInline(cl.text)),
          spacing: { before: 60, after: 60 },
        }))
        return

      case 'numbered':
        children.push(new Paragraph({
          numbering: { reference: 'doc-numbers', level: 0 },
          children: segmentsToDocxChildren(parseInline(cl.text)),
          spacing: { before: 60, after: 60 },
        }))
        return

      case 'body':
        children.push(new Paragraph({
          children: segmentsToDocxChildren(parseInline(cl.text)),
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        }))
        return
    }
  })
 
  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'doc-bullets',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720, hanging: 360 } },
              run: { font: 'Segoe UI', color: '333333' },
            },
          }],
        },
        {
          reference: 'doc-numbers',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720, hanging: 360 } },
              run: { font: 'Segoe UI', bold: true, color: '333333' },
            },
          }],
        },
      ],
    },
    styles: {
      default: { document: { run: { font: 'Segoe UI', size: 22, color: '333333' } } },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 36, bold: true, font: 'Segoe UI', color: '111111' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'Segoe UI', color: '222222' },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Segoe UI', color: '333333' },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 },
        },
        {
          id: 'Hyperlink', name: 'Hyperlink', basedOn: 'Normal',
          run: { color: '0066CC', underline: {} },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      ...(letterStyle ? {} : {
        headers: {
          default: new Header({
            children: [new Paragraph({
              children: [
                new TextRun({ text: docName, font: 'Segoe UI', size: 18, color: '444444', bold: true }),
                new TextRun({ text: allPages ? '' : `  ·  Page ${page}`, font: 'Segoe UI', size: 16, color: '888888' }),
              ],
              border: { bottom: { color: 'CCCCCC', space: 6, style: BorderStyle.SINGLE, size: 4 } },
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              children: [
                new TextRun({ text: 'Page ', font: 'Segoe UI', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Segoe UI', size: 16, color: '888888' }),
                new TextRun({ text: ' of ', font: 'Segoe UI', size: 16, color: '888888' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Segoe UI', size: 16, color: '888888' }),
              ],
              alignment: AlignmentType.CENTER,
            })],
          }),
        },
      }),
      children,
    }],
  })
 
  const blob = await Packer.toBlob(document)
  saveAs(blob, `${docName}${allPages ? '-full' : `-p${page}`}.docx`)
}
 



// ─── Component ────────────────────────────────────────────────────────────────

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
  const [downloadDropdownOpen, setDownloadDropdownOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const markRef = useRef<HTMLElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const contextForMatch = sectionContext?.trim() || snippet?.trim() || ''
  const lsKey = `doc_edit_${chatId}_${resolvedDoc}_${allPages ? 'all' : `p${page}`}`

  const readSavedEdit = (): string | null => {
    try {
      const raw = localStorage.getItem(lsKey)
      if (!raw) return null
      const { text: saved, savedAt, ttl } = JSON.parse(raw)
      if (Date.now() - savedAt >= ttl) {
        localStorage.removeItem(lsKey)
        return null
      }
      return saved
    } catch {
      return null
    }
  }

  /** True when a localStorage save covers the full page, not a truncated excerpt. */
  const isCompleteSave = (saved: string, fullText: string): boolean => {
    if (saved.length < fullText.length * 0.97) return false
    const tail = fullText.trim().slice(-40)
    if (tail.length < 15) return true
    return saved.trim().includes(tail.slice(-30))
  }

  /** Prefer a saved full-page edit; ignore stale or truncated saves. */
  const pickEditText = (fullText: string): string => {
    const saved = readSavedEdit()
    if (saved && isCompleteSave(saved, fullText)) return saved
    if (saved) localStorage.removeItem(lsKey)
    return fullText
  }

  // ── Seed editedText when text loads (preview only — not while editing) ───
  useEffect(() => {
    if (!text || editMode) return
    setEditedText(text)
  }, [text, editMode])

  // ── Persist edits ─────────────────────────────────────────────────────────
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

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true); setText(null); setShowFullPage(false); setEditMode(false)

    if (!chatId) { setText('Chat session not ready yet.'); setLoading(false); return }

    if (allPages) {
      fetchDocumentFull(resolvedDoc, userId, chatId)
        .then(data => setText(data.text.trim() || 'No content found.'))
        .catch(err => setText(formatLoadError(err)))
        .finally(() => setLoading(false))
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

  // ── Scroll highlight ──────────────────────────────────────────────────────
  useEffect(() => {
    if (markRef.current) markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [text])

  // ── Focus textarea ────────────────────────────────────────────────────────
  useEffect(() => {
    if (editMode && textareaRef.current) {
      const ta = textareaRef.current
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)
    }
  }, [editMode])

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  useEffect(() => {
    if (!editMode || !textareaRef.current) return
    const ta = textareaRef.current
    ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`
  }, [editedText, editMode])

  const handleSaveDone = () => {
    setEditMode(false); setSavedIndicator(true)
    setTimeout(() => setSavedIndicator(false), 2000)
  }

  const fetchFullPageText = async (): Promise<string> => {
    if (allPages) return text ?? editedText
    const data = await fetchDocumentPage(resolvedDoc, page, userId, chatId)
    return normalizeChunkedPageText(data.text)
  }

  const handleEnterEdit = async () => {
    setLoading(true)
    try {
      const fullText = await fetchFullPageText()
      setText(fullText)
      setEditedText(pickEditText(fullText))
      setShowFullPage(true)
      setEditMode(true)
    } catch {
      if (text) setEditedText(pickEditText(text))
      setEditMode(true)
    } finally {
      setLoading(false)
    }
  }

  const resolveExportText = async (): Promise<string> => {
    if (allPages || showFullPage) return editedText
    try {
      return await fetchFullPageText()
    } catch {
      return editedText
    }
  }

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const exportText = await resolveExportText()
      exportPdf({ docName, page, allPages, userId, editedText: exportText })
    } finally { setExporting(false) }
  }

  const handleExportDocx = async () => {
    setExporting(true)
    try {
      const exportText = await resolveExportText()
      await exportDocx({ docName, page, allPages, editedText: exportText })
    } finally { setExporting(false) }
  }

  // ── Highlight render ──────────────────────────────────────────────────────
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
    if (loading) return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <Loader2 size={18} className="animate-spin" style={{ color: 'rgba(210,140,160,0.6)' }} />
        {loadingPage && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Loading page {loadingPage}…
          </p>
        )}
      </div>
    )
    if (!text) return null
    if (editMode) return (
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
    return renderHighlighted(text)
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full"
      style={{ background: 'rgba(39, 35, 35, 0.86)', borderLeft: '1px solid rgba(210,140,160,0.1)' }}>

      <div className="w-full flex flex-col pt-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>

        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
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
              onClick={() => editMode ? handleSaveDone() : handleEnterEdit()}
              disabled={loading && !editMode}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer hover:text-rose-400 hover:bg-rose-400/10"
              style={{
                background: editMode ? 'rgba(210,140,160,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${editMode ? 'rgba(210,140,160,0.4)' : 'rgba(255,255,255,0.08)'}`,
                color: editMode ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.45)',
                opacity: loading && !editMode ? 0.5 : 1,
              }}
            >
              {editMode ? <><Check size={11} /> Done</> : <><Pencil size={11} /> Edit</>}
            </button>

            {text && !loading && editMode && (
              <div className="relative inline-block text-left">
                <button
                  onClick={() => setDownloadDropdownOpen(v => !v)}
                  disabled={exporting}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer select-none"
                  style={{
                    background: downloadDropdownOpen ? 'rgba(210,140,160,0.15)' : 'rgba(255,255,255,0.04)',
                    border: downloadDropdownOpen ? '1px solid rgba(210,140,160,0.4)' : '1px solid rgba(255,255,255,0.08)',
                    color: downloadDropdownOpen ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.45)',
                    opacity: exporting ? 0.5 : 1,
                  }}
                  onMouseEnter={e => {
                    if (!downloadDropdownOpen) {
                      e.currentTarget.style.color = 'rgba(210,140,160,0.9)'
                      e.currentTarget.style.borderColor = 'rgba(210,140,160,0.3)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!downloadDropdownOpen) {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.45)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                    }
                  }}
                >
                  {exporting
                    ? <><Loader2 size={11} className="animate-spin" /> Exporting…</>
                    : <><Download size={11} /> Save As <ChevronDown size={10} className="ml-0.5" /></>
                  }
                </button>

                {downloadDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setDownloadDropdownOpen(false)} />
                    <div
                      className="absolute right-0 mt-1.5 w-40 rounded-md shadow-xl z-40 py-1 overflow-hidden text-[11px]"
                      style={{
                        background: 'rgb(39, 35, 35)',
                        border: '1px solid rgba(210,140,160,0.25)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <button
                        onClick={() => { handleExportPdf(); setDownloadDropdownOpen(false) }}
                        className="w-full text-left px-3 py-2 text-white/70 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        PDF Document (.pdf)
                      </button>
                      <button
                        onClick={() => { handleExportDocx(); setDownloadDropdownOpen(false) }}
                        className="w-full text-left px-3 py-2 text-white/70 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        Word Document (.docx)
                      </button>
                    </div>
                  </>
                )}
              </div>
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
          <div className="w-full py-3 px-4">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Edits are saved locally. Download immediately — changes won't persist after clearing browser data.
            </p>
          </div>
        )}
      </div>

      {!loading && text && !editMode && !allPages && (
        <div className="px-4 pt-2.5 flex-shrink-0">
          <button type="button"
            onClick={() => {
              setShowFullPage(true); setLoading(true)
              fetchFullPageText()
                .then(full => setText(full))
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
      </div>
    </div>
  )
}