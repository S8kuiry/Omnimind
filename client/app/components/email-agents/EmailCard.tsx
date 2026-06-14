'use client'
import { EmailItem } from '@/lib/automationApi'

// Structured styles for the new priority micro-badges
const PRIORITY_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  high: {
    text: 'rgba(255, 100, 100, 0.95)',
    bg: 'rgba(255, 100, 100, 0.08)',
    border: 'rgba(255, 100, 100, 0.2)',
  },
  medium: {
    text: 'rgba(255, 190, 60, 0.95)',
    bg: 'rgba(255, 190, 60, 0.08)',
    border: 'rgba(255, 190, 60, 0.2)',
  },
  low: {
    text: 'rgba(80, 210, 80, 0.85)',
    bg: 'rgba(80, 210, 80, 0.08)',
    border: 'rgba(80, 210, 80, 0.2)',
  },
}

const CATEGORY_COLOR: Record<string, string> = {
  work:       'rgba(100, 150, 255, 0.7)',
  newsletter: 'rgba(160, 160, 160, 0.5)',
  bill:       'rgba(255, 200, 50, 0.7)',
  personal:   'rgba(210, 140, 160, 0.7)',
  spam:       'rgba(120, 120, 120, 0.4)',
  critical:   'rgba(255, 100, 100, 0.7)',
}

export default function EmailCard({
  email, selected, onClick, readOnly = false,
}: {
  email: EmailItem
  selected: boolean
  onClick: () => void
  userEmail?: string
  readOnly?: boolean
}) {
  const isAutoReplied = readOnly || email.llm_action === 'auto_replied'
  const isUnread = !isAutoReplied && !email.is_read
  const pStyle = PRIORITY_STYLE[email.priority] || {
    text: 'rgba(255,255,255,0.4)',
    bg: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.1)',
  }

  return (
    <div
      onClick={onClick}
      className="px-4 py-3 cursor-pointer transition-all duration-150 border-b select-none"
      style={{
        background: selected ? 'rgba(210,140,160,0.07)' : 'transparent',
        borderColor: 'rgba(255,255,255,0.04)',
        borderLeft: selected ? '2px solid rgba(210,140,160,0.5)' : '2px solid transparent',
      }}
      onMouseEnter={e => {
        if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'
      }}
      onMouseLeave={e => {
        if (!selected) e.currentTarget.style.background = 'transparent'
      }}
    >
      <div className="flex items-start gap-3">
        
        {/* Left Section: pulse dot = unread; green = auto-replied; empty when read */}
        <div className="mt-1.5 w-1.5 h-1.5 flex-shrink-0 flex items-center justify-center">
          {isAutoReplied ? (
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'rgba(100, 220, 130, 0.95)' }}
              title="Auto-replied"
            />
          ) : isUnread ? (
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'rgba(255, 190, 60, 0.95)' }}
              title="Unread"
            />
          ) : null}
        </div>

        {/* Right Section: Content Details */}
        <div className="min-w-0 flex-1">
          {/* Sender metadata row */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className="text-xs truncate transition-colors"
              style={{
                fontWeight: isUnread ? '600' : '400',
                color: isUnread ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)',
              }}
            >
              {email.from_name ? email.from_name.trim() : email.from_address}
            </span>
            
            {/* Categorization & Priority Group tags */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[9px] capitalize tracking-wide"
                style={{ color: CATEGORY_COLOR[email.category] ?? 'rgba(255,255,255,0.3)' }}>
                {email.category}
              </span>
              
              {/* Clean text badge replacing the old priority dot */}
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider border"
                style={{
                  color: pStyle.text,
                  background: pStyle.bg,
                  borderColor: pStyle.border,
                }}
              >
                {email.priority}
              </span>
            </div>
          </div>

          {/* Subject Line */}
          <p
            className="text-xs truncate mb-1 transition-colors"
            style={{
              fontWeight: isUnread ? '550' : '400',
              color: isUnread ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)',
            }}
          >
            {email.subject}
          </p>

          {/* Summary/Snippet body */}
          <p
            className="text-[10px] truncate leading-relaxed transition-colors"
            style={{ color: isUnread ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.22)' }}
          >
            {isAutoReplied ? (email.reply_preview || email.snippet) : (email.summary || email.snippet)}
          </p>

          {/* System LLM automation status flags */}
          <div className="flex items-center gap-1.5 mt-2">
            {isAutoReplied && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(80,200,120,0.1)', color: 'rgba(100,220,130,0.85)', border: '1px solid rgba(80,200,120,0.2)' }}>
                auto-replied
              </span>
            )}
            {!isAutoReplied && (email.draft_body || email.llm_action === 'draft_saved') && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(210,140,160,0.1)', color: 'rgba(210,140,160,0.7)', border: '1px solid rgba(210,140,160,0.2)' }}>
                draft ready
              </span>
            )}
            {email.llm_action === 'alert_sent' && !email.draft_body && !isAutoReplied && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(100,150,255,0.1)', color: 'rgba(100,150,255,0.7)', border: '1px solid rgba(100,150,255,0.2)' }}>
                needs review
              </span>
            )}
            {email.category === 'critical' && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(255,150,50,0.1)', color: 'rgba(255,160,60,0.8)', border: '1px solid rgba(255,150,50,0.2)' }}>
                urgent alert
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}