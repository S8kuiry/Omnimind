'use client'
import { useState, useEffect } from 'react'
import { X, Pencil, Send, Trash2, RotateCcw } from 'lucide-react'
import {
  generateDraft,
  sendReply,
  analyzeEmail,
  fetchEmailDetail,
  type EmailItem,
} from '@/lib/automationApi'
import EmailBodyViewer from './EmailBodyViewer'

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  high:   { bg: 'rgba(255,80,80,0.1)',   text: 'rgba(255,110,110,0.9)' },
  medium: { bg: 'rgba(255,180,50,0.1)',  text: 'rgba(255,195,65,0.9)'  },
  low:    { bg: 'rgba(80,200,80,0.08)',  text: 'rgba(90,215,90,0.85)'  },
}

const CATEGORY_COLOR: Record<string, string> = {
  work:       'rgba(100,150,255,0.7)',
  bill:       'rgba(255,200,50,0.75)',
  critical:   'rgba(255,100,100,0.75)',
  newsletter: 'rgba(160,160,160,0.5)',
  spam:       'rgba(120,120,120,0.4)',
  personal:   'rgba(210,140,160,0.75)',
}

interface Props {
  email: EmailItem
  userEmail: string
  onClose: () => void
  onDismiss: () => void
  onRemove: (emailId: string) => void
  onDelete: (emailId: string) => void
  readOnly?: boolean
}

export default function EmailDetail({ email, userEmail, onDelete, onClose, onDismiss, onRemove, readOnly = false }: Props) {
  const [draft, setDraft]           = useState(email.draft_body ?? email.reply_draft ?? '')
  const [summary, setSummary]       = useState(email.summary ?? '')
  const [bodyText, setBodyText]     = useState(email.body_text || email.snippet || '')
  const [bodyHtml, setBodyHtml]     = useState<string | null>(null)
  const [loadingBody, setLoadingBody] = useState(true)
  const [analyzing, setAnalyzing]   = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [error, setError]           = useState('')

  const showReply = !sent && !readOnly
  const isAutoReplied = readOnly || email.llm_action === 'auto_replied'

  // Lazy-load full HTML + images only when this email is opened
  useEffect(() => {
    if (!userEmail || !email._id) return

    let cancelled = false
    setLoadingBody(true)
    setBodyHtml(null)

    ;(async () => {
      const detail = await fetchEmailDetail(userEmail, email._id)
      if (cancelled) return
      if (detail) {
        if (detail.body_text?.trim()) setBodyText(detail.body_text)
        if (detail.has_html && detail.body_html) setBodyHtml(detail.body_html)
      }
      setLoadingBody(false)
    })()

    return () => { cancelled = true }
  }, [userEmail, email._id])

  useEffect(() => {
    setDraft(email.draft_body ?? email.reply_draft ?? '')
    setSummary(email.summary ?? '')
    setBodyText(email.body_text || email.snippet || '')
    setSent(false)
    setError('')
  }, [email._id, email.draft_body, email.reply_draft, email.summary, email.body_text, email.snippet])

  useEffect(() => {
    const needsAnalyze = !readOnly && !email.summary?.trim() && !email.draft_body?.trim()
    if (!needsAnalyze) return
    let cancelled = false
    ;(async () => {
      setAnalyzing(true)
      const result = await analyzeEmail(userEmail, email._id)
      if (cancelled || !result) {
        if (!cancelled) setAnalyzing(false)
        return
      }
      setSummary(result.summary)
      if (result.draft_body) setDraft(result.draft_body)
      setAnalyzing(false)
    })()
    return () => { cancelled = true }
  }, [userEmail, email._id, email.summary, email.draft_body, readOnly])

  const ps = PRIORITY_STYLE[email.priority] ?? { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.4)' }

  const handleGenerate = async () => {
    setGenerating(true)
    setError('')
    try {
      const result = await generateDraft(userEmail, email._id)
      setDraft(result.draft_body)
    } catch {
      setError('Draft generation failed. Try again.')
    }
    setGenerating(false)
  }

  const handleSend = async () => {
    if (!draft.trim()) return
    setSending(true)
    setError('')
    try {
      await sendReply(
        userEmail,
        email._id,
        {
          to: email.from_address,
          subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
          body: draft,
        },
        email.provider ?? 'gmail',
      )
      setSent(true)
      onRemove(email._id)
    } catch {
      setError('Send failed. Check your connection.')
    }
    setSending(false)
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-hidden px-6 pt-5 pb-5"
      style={{ background: 'rgba(255, 255, 255, 0.06)' }}>

      <div className="flex items-start justify-between mb-5 flex-shrink-0">
        <div className="min-w-0 flex-1 pr-4">
          <h2 className="text-sm font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {email.subject || '(no subject)'}
          </h2>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {email.from_name || email.from_address}
            {email.from_name && (
              <span style={{ color: 'rgba(255,255,255,0.25)' }}> &lt;{email.from_address}&gt;</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[9px] px-2 py-0.5 rounded-full capitalize"
            style={{ background: ps.bg, color: ps.text }}>{email.priority}</span>
          <span className="text-[9px] px-2 py-0.5 rounded-full capitalize"
            style={{ background: 'rgba(255,255,255,0.05)', color: CATEGORY_COLOR[email.category] ?? 'rgba(255,255,255,0.4)' }}>
            {email.category}
          </span>
          <button onClick={()=> onDelete(email._id)}
            className="p-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
            style={{ color: 'rgba(255,80,80,0.5)', display: isAutoReplied ? 'none' : undefined }}
            title="Dismiss — marks as reviewed">
            <Trash2 size={13} />
          </button>
          <button onClick={onClose}
            className="p-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {analyzing && (
        <div className="mb-5 px-4 py-3 rounded-xl text-xs flex items-center gap-2 flex-shrink-0"
          style={{ background: 'rgba(210,140,160,0.04)', border: '1px solid rgba(210,140,160,0.12)', color: 'rgba(255,255,255,0.45)' }}>
          <RotateCcw size={11} className="animate-spin" style={{ color: 'rgba(210,140,160,0.7)' }} />
          Analyzing email…
        </div>
      )}
      {!analyzing && summary && (
        <div className="mb-5 px-4 py-3.5 rounded-xl text-xs leading-relaxed flex-shrink-0"
          style={{ background: 'rgba(210,140,160,0.04)', border: '1px solid rgba(210,140,160,0.12)', color: 'rgba(255,255,255,0.65)' }}>
          <span className="font-semibold" style={{ color: 'rgba(210,140,160,0.85)' }}>Summary · </span>
          {summary}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 mb-2">
        {loadingBody && (
          <p className="text-[10px] mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <RotateCcw size={10} className="animate-spin" />
            Loading full message…
          </p>
        )}
        {!loadingBody && (
          <EmailBodyViewer bodyHtml={bodyHtml} bodyText={bodyText} />
        )}
      </div>

      {showReply ? (
        <div className="flex-shrink-0 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Reply to {email.from_address}
            </span>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg cursor-pointer transition-all hover:bg-pink-400/15"
              style={{ background: 'rgba(210,140,160,0.07)', color: 'rgba(210,140,160,0.8)', border: '1px solid rgba(210,140,160,0.18)' }}>
              {generating
                ? <><RotateCcw size={9} className="animate-spin" /> Drafting…</>
                : <><Pencil size={9} /> AI Draft</>}
            </button>
          </div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4}
            placeholder="Write a reply or click AI Draft…"
            className="w-full resize-none rounded-xl px-3.5 py-2.5 text-xs outline-none leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
          />
          {error && <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,100,100,0.8)' }}>{error}</p>}
          <button onClick={handleSend} disabled={!draft.trim() || sending}
            className="mt-2.5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all"
            style={{ background: 'rgba(210,140,160,0.15)', border: '1px solid rgba(210,140,160,0.35)', color: 'rgba(210,140,160,0.95)', opacity: !draft.trim() || sending ? 0.5 : 1 }}>
            <Send size={11} />
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
      ) : isAutoReplied ? (
        <div className="flex-shrink-0 pt-3 border-t border-white/10">
          <span className="text-[10px] font-medium block mb-2" style={{ color: 'rgba(100,220,130,0.75)' }}>
            Auto-reply sent
          </span>
          <div className="rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap"
            style={{ background: 'rgba(80,200,120,0.06)', border: '1px solid rgba(80,200,120,0.18)', color: 'rgba(255,255,255,0.75)' }}>
            {email.reply_preview || draft || 'Reply sent automatically.'}
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 text-center py-3 rounded-xl text-xs"
          style={{ background: 'rgba(80,200,80,0.07)', color: 'rgba(100,220,100,0.85)', border: '1px solid rgba(80,200,80,0.18)' }}>
          ✓ Reply sent
        </div>
      )}
    </div>
  )
}
