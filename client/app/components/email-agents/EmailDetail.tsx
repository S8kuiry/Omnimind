'use client'
import { useState } from 'react'
import { X, Pencil, Send, Trash2, RotateCcw } from 'lucide-react'
import { generateDraft, sendReply, deleteEmail, type EmailItem } from '@/lib/automationApi'

const PRIORITY_STYLE: Record<string, { bg: string; text: string }> = {
  high:   { bg: 'rgba(255,80,80,0.1)',   text: 'rgba(255,110,110,0.9)' },
  medium: { bg: 'rgba(255,180,50,0.1)',  text: 'rgba(255,195,65,0.9)'  },
  low:    { bg: 'rgba(80,200,80,0.08)', text: 'rgba(90,215,90,0.85)'  },
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
  onUpdate: () => void
}

export default function EmailDetail({ email, userEmail, onClose, onUpdate }: Props) {
  const [draft, setDraft]           = useState(email.draft_body ?? email.reply_draft ?? '')
  const [generating, setGenerating] = useState(false)
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [error, setError]           = useState('')

  const ps = PRIORITY_STYLE[email.priority] ?? { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.4)' }
  const showReply = (email.needs_reply || email.llm_action === 'draft_saved') && !sent

  // Helper function to safely parse lines, identify tracking links, and format them cleanly
 // Helper function to safely parse lines, intercept junk dividers, and linkify URLs
 const renderFormattedBody = (text: string) => {
  if (!text) return <p style={{ color: 'rgba(255,255,255,0.3)' }}>No body preview available.</p>;

  // 1. Catch absolute URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  // 2. Catch lines that are just repeated plain-text dividers (e.g., ----, ===, ____, --==--)
  const dividerRegex = /^[=\-_*\s]{3,}$/;

  return text.split('\n').map((line, lineIndex) => {
    const trimmedLine = line.trim();

    // Handle blank lines
    if (trimmedLine === '') {
      return <div key={lineIndex} className="h-3" />;
    }

    // Intercept plain-text dividers and swap with a clean UI border component
    if (dividerRegex.test(trimmedLine)) {
      return (
        <hr 
          key={lineIndex} 
          className="my-3 border-0 h-[1px] w-full opacity-60 flex-shrink-0" 
          style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.12), rgba(255,255,255,0.02))' }} 
        />
      );
    }

    // Handle normal lines containing text and potential URLs
    const parts = line.split(urlRegex);
    return (
      <p key={lineIndex} className="mb-1 tracking-normal leading-relaxed break-words">
        {parts.map((part, partIndex) => {
          if (part.match(urlRegex)) {
            return (
              <a
                key={partIndex}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-opacity hover:opacity-80 inline-block max-w-full truncate align-bottom font-sans text-[11px]"
                style={{ color: 'rgba(210,140,160,0.95)' }}
                title={part}
              >
                {part.length > 55 ? `${part.substring(0, 55)}...` : part}
              </a>
            );
          }
          return part;
        })}
      </p>
    );
  });
};

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
      await sendReply(userEmail, email._id, {
        to: email.from_address,
        subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
        body: draft,
      })
      setSent(true)
      onUpdate()
    } catch {
      setError('Send failed. Check your connection.')
    }
    setSending(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this email?')) return
    setError('')
    try {
      await deleteEmail(userEmail, email._id)
      onClose()  // Safely close the display modal on success
      onUpdate() // Refresh the parent data states to reflect changes
    } catch (err) {
      console.error("Delete Error:", err)
      setError('Failed to delete email. Check backend server logs.')
    }
  }
  return (
    <div className="flex flex-col min-h-[600px] max-h-[800px] px-6 py-5 overflow-y-auto" style={{ background: 'rgba(255, 255, 255, 0.06)' }}>
      
      {/* Header Panel */}
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
          <button onClick={handleDelete} className="p-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
            style={{ color: 'rgba(255,80,80,0.5)' }}><Trash2 size={13} /></button>
          <button onClick={onClose} className="p-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
            style={{ color: 'rgba(255,255,255,0.35)' }}><X size={14} /></button>
        </div>
      </div>

      {/* AI Summary Banner */}
      {email.summary && (
        <div className="mb-5 px-4 py-3.5 rounded-xl text-xs leading-relaxed flex-shrink-0"
          style={{ background: 'rgba(210,140,160,0.04)', border: '1px solid rgba(210,140,160,0.12)', color: 'rgba(255,255,255,0.65)' }}>
          <span className="font-semibold" style={{ color: 'rgba(210,140,160,0.85)' }}>Summary · </span>
          {email.summary}
        </div>
      )}

      {/* Main Formatted Email Body View */}
      <div className="flex-1 text-[12px] mb-6 min-h-0 overflow-y-auto pr-1"
        style={{ color: 'rgba(255,255,255,0.68)' }}>
        {renderFormattedBody(email.body_text || email.snippet)}
      </div>

      {/* Action Interface Panel */}
      {showReply && (
        <div className="flex-shrink-0 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Reply to {email.from_address}
            </span>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg cursor-pointer transition-all hover:bg-pink-400/15"
              style={{ background: 'rgba(210,140,160,0.07)', color: 'rgba(210,140,160,0.8)', border: '1px solid rgba(210,140,160,0.18)' }}
            >
              {generating
                ? <><RotateCcw size={9} className="animate-spin" /> Drafting…</>
                : <><Pencil size={9} /> AI Draft</>
              }
            </button>
          </div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4}
            placeholder="Write a reply or click AI Draft…"
            className="w-full resize-none rounded-xl px-3.5 py-2.5 text-xs outline-none leading-relaxed"
            style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.75)' }}
          />
          {error && <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,100,100,0.8)' }}>{error}</p>}
          <button onClick={handleSend} disabled={!draft.trim() || sending}
            className="mt-2.5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all"
            style={{ background: 'rgba(210,140,160,0.1)', border: '1px solid rgba(210,140,160,0.25)', color: 'rgba(210,140,160,0.9)', opacity: !draft.trim() || sending ? 0.5 : 1 }}
          >
            <Send size={11} />
            {sending ? 'Sending…' : 'Send Reply'}
          </button>
        </div>
      )}

      {sent && (
        <div className="flex-shrink-0 text-center py-3 rounded-xl text-xs"
          style={{ background: 'rgba(80,200,80,0.07)', color: 'rgba(100,220,100,0.85)', border: '1px solid rgba(80,200,80,0.18)' }}>
          ✓ Reply sent
        </div>
      )}
    </div>
  )
}