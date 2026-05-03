type Tab = 'chat' | 'guidance' | 'analytics' | 'compare'

const tabs: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'guidance', label: 'Guidance' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'compare', label: 'Compare' },
]

export default function TabBar({ active, onChange, docName }: {
  active: Tab; onChange: (t: Tab) => void; docName: string
}) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: '#0e0f10' }}>
      <span className="text-xs mr-3 truncate max-w-[160px]"
        style={{ color: 'rgba(255,255,255,0.25)' }}>
        {docName}
      </span>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: active === t.id ? 'rgba(210,140,160,0.15)' : 'transparent',
            color: active === t.id ? 'rgba(210,140,160,0.95)' : 'rgba(255,255,255,0.4)',
            border: active === t.id ? '1px solid rgba(210,140,160,0.25)' : '1px solid transparent'
          }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}