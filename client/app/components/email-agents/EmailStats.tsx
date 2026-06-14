'use client'
import type { EmailStats } from '@/lib/automationApi'

export default function EmailStatsBar({ stats }: { stats: EmailStats }) {
  const items = [
    {
      label: 'Pending',
      value: stats.activeCards,
      color: 'rgba(255,190,60,0.85)',
    },
    {
      label: 'Auto-replied',
      value: stats.autoSendCountToday ?? stats.autoRepliesTotal ?? 0,
      color: 'rgba(100,220,100,0.85)',
    },
    {
      label: 'Manual',
      value: stats.manualAttentionTotal,
      color: 'rgba(210,140,160,0.85)',
    },
    {
      label: 'Dropped',
      value: stats.systemDroppedTotal,
      color: 'rgba(160,160,160,0.7)',
    },
    {
      label: 'Critical',
      value: stats.critical_unread,
      color: 'rgba(255,100,100,0.85)',
    },
    {
      label: 'Today',
      value: stats.today_processed,
      color: 'rgba(100,200,150,0.8)',
    },
  ]

  return (
    <div
      className="grid flex-shrink-0"
      style={{
        gridTemplateColumns: 'repeat(6, 1fr)',
        background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.21)',
        gap: '1px',
      }}
    >
      {items.map(item => (
        <div
          key={item.label}
          className="flex flex-col items-center py-3"
          style={{ background: '#010003' }}
        >
          <span
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: item.color }}
          >
            {item.value}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider mt-0.5"
            style={{ color: 'rgba(255,255,255,0.22)' }}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}
