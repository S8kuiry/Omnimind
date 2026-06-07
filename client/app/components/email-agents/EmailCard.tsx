'use client'
import { EmailItem } from '@/lib/automationApi'

const PRIORITY_DOT: Record<string, string> = {
  high:   'rgba(255,100,100,0.9)',
  medium: 'rgba(255,190,60,0.9)',
  low:    'rgba(80,210,80,0.8)',
}

// Updated to perfectly align with your backend category schema
const CATEGORY_COLOR: Record<string, string> = {
  work:       'rgba(100,150,255,0.7)',
  newsletter: 'rgba(160,160,160,0.5)',
  bill:       'rgba(255,200,50,0.7)',
  personal:   'rgba(210,140,160,0.7)',
  spam:       'rgba(120,120,120,0.4)',
  critical:   'rgba(255,100,100,0.7)',
}

export default function EmailCard({
  email, selected, onClick, userEmail, onUpdate,
}: {
  email: EmailItem
  selected: boolean
  onClick: () => void
  userEmail: string // Changed from userId to userEmail
  onUpdate: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="px-4 py-3 cursor-pointer transition-all duration-150 border-b"
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
      <div className="flex items-start gap-2.5">
        {/* Priority dot */}
        <div className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: PRIORITY_DOT[email.priority] ?? 'rgba(255,255,255,0.2)' }} />

        <div className="min-w-0 flex-1">
          {/* Sender + category */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {/* Fixed: Uses from_name and from_address instead of old sender fields */}
              {email.from_name ? email.from_name.trim() : email.from_address}
            </span>
            <span className="text-[9px] flex-shrink-0 capitalize"
              style={{ color: CATEGORY_COLOR[email.category] ?? 'rgba(255,255,255,0.3)' }}>
              {email.category}
            </span>
          </div>

          {/* Subject */}
          <p className="text-xs truncate mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {email.subject}
          </p>

          {/* Summary or snippet */}
          <p className="text-[10px] truncate leading-relaxed" style={{ color: 'rgba(255,255,255,0.28)' }}>
            {email.summary || email.snippet}
          </p>

          {/* Badges mapped directly onto backend llm_action states */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {email.llm_action === 'draft_saved' && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(210,140,160,0.1)', color: 'rgba(210,140,160,0.7)', border: '1px solid rgba(210,140,160,0.2)' }}>
                reply drafted
              </span>
            )}
            {email.llm_action === 'auto_replied' && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(100,220,100,0.1)', color: 'rgba(100,220,100,0.7)', border: '1px solid rgba(100,220,100,0.2)' }}>
                auto-replied
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