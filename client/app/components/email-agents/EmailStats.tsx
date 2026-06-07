'use client'
import type { EmailStats } from '@/lib/automationApi'

export default function EmailStatsBar({ stats }: { stats: EmailStats }) {
  const items = [
    {
      label: 'Total',
      value: stats.total,
      color: 'rgba(255,255,255,0.65)',
    },
    {
      label: 'Unread',
      value: stats.unread,
      color: 'rgba(255,190,60,0.85)',
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
    {
      label: 'High',
      value: stats.by_priority?.high ?? 0,
      color: 'rgba(255,140,80,0.85)',
    },
    {
      label: 'Work',
      value: stats.by_category?.work ?? 0,
      color: 'rgba(100,150,255,0.75)',
    },
  ]

  return (
    <div
      className="grid flex-shrink-0 "
      style={{
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
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