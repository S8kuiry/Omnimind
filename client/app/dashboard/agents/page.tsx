'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Mail, Clock } from 'lucide-react'

const AGENTS = [
  {
    id: 'email',
    label: 'Email Agent',
    description: 'Categorize, summarize and draft replies for your Gmail inbox automatically.',
    href: '/dashboard/agents/email',
    icon: <Mail size={20} />,
    status: 'available',   // available | coming_soon
  },
  {
    id: 'tracker',
    label: 'Package Tracker',
    description: 'Track shipments from any carrier and get notified on status changes.',
    href: '/dashboard/agents/tracker',
    icon: <Clock size={20} />,
    status: 'coming_soon',
  },
]

export default function AgentsPage() {
  const { data: session } = useSession()

  return (
    <div className="flex-1 h-screen overflow-y-auto px-8 py-10" style={{ background: '#010003' }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-[0.25em] mb-2" style={{ color: 'rgba(210,140,160,0.6)' }}>
            OmniMind
          </p>
          <h1 className="text-2xl font-light text-white/90 tracking-tight">Agents</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Autonomous agents that work in the background on your behalf.
          </p>
        </div>

        {/* Agent cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AGENTS.map(agent => (
            agent.status === 'available' ? (
              <Link key={agent.id} href={agent.href}>
                <div
                  className="group p-5 rounded-xl cursor-pointer transition-all duration-200"
                  style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(210,140,160,0.06)'
                    e.currentTarget.style.borderColor = 'rgba(210,140,160,0.25)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.025)'
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-2 rounded-lg flex-shrink-0"
                      style={{ background: 'rgba(210,140,160,0.1)', color: 'rgba(210,140,160,0.8)' }}>
                      {agent.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-white/85">{agent.label}</p>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                          style={{ background: 'rgba(100,200,100,0.1)', color: 'rgba(100,220,100,0.8)', border: '1px solid rgba(100,200,100,0.2)' }}>
                          Live
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {agent.description}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div key={agent.id}
                className="p-5 rounded-xl opacity-50"
                style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' }}>
                    {agent.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white/50">{agent.label}</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)' }}>
                        Soon
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {agent.description}
                    </p>
                  </div>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  )
}