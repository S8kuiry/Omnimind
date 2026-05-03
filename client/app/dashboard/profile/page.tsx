'use client'
import { useSession } from 'next-auth/react'

const stats = [
    { label: 'Active Models', value: '4', change: '+1 this week' },
    { label: 'API Requests', value: '12.4k', change: '+18% vs last week' },
    { label: 'Knowledge Bases', value: '7', change: '2 syncing' },
    { label: 'Avg Response', value: '1.2s', change: '-0.3s improved' },
]

const recentActivity = [
    { action: 'Model GPT-4o connected', time: '2 min ago', type: 'model' },
    { action: 'Knowledge base "Docs v2" synced', time: '14 min ago', type: 'knowledge' },
    { action: 'New user subharthy@gmail.com joined', time: '1 hr ago', type: 'user' },
    { action: 'Analytics report generated', time: '3 hr ago', type: 'analytics' },
    { action: 'Integration Slack enabled', time: 'Yesterday', type: 'integration' },
]

const typeColors: Record<string, string> = {
    model: 'rgba(210,140,160,0.8)',
    knowledge: 'rgba(100,180,210,0.8)',
    user: 'rgba(140,210,160,0.8)',
    analytics: 'rgba(210,180,100,0.8)',
    integration: 'rgba(180,140,210,0.8)',
}

const quickActions = [
    {
        title: 'Connect a Model',
        desc: 'Add GPT-4, Claude, Gemini and more',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" strokeLinecap="round" />
            </svg>
        )
    },
    {
        title: 'Upload Knowledge',
        desc: 'Feed PDFs, docs, and URLs',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" strokeLinecap="round" />
                <path d="M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15z" />
            </svg>
        )
    },
    {
        title: 'View Analytics',
        desc: 'Track usage and performance',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3v18h18" strokeLinecap="round" />
                <path d="M7 16l4-5 4 3 4-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )
    },
]

export default function DashboardPage() {
    const { data: session } = useSession()
    const firstName = session?.user?.name?.split(' ')[0] ?? 'there'

    return (
        <div className="min-h-full p-6 space-y-8" style={{ color: 'rgba(255,255,255,0.85)' }}>

            {/* Greeting */}
            <div className="space-y-1">
                <p className="text-xs tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
                <h1 className="text-2xl font-light tracking-tight">
                    Good {getTimeOfDay()},{' '}
                    <span style={{ color: 'rgba(210,140,160,0.9)' }} className="font-semibold">{firstName}</span>
                </h1>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    Here's what's happening with your workspace today.
                </p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {stats.map((stat) => (
                    <div key={stat.label} className="rounded-xl p-4 space-y-2"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <p className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {stat.label}
                        </p>
                        <p className="text-2xl font-light">{stat.value}</p>
                        <p className="text-[11px]" style={{ color: 'rgba(210,140,160,0.6)' }}>{stat.change}</p>
                    </div>
                ))}
            </div>

            {/* Main content — 2 col */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

                {/* Quick actions */}
                <div className="lg:col-span-1 rounded-xl p-5 space-y-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h2 className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        Quick Actions
                    </h2>
                    <div className="space-y-2">
                        {quickActions.map((action) => (
                            <button key={action.title}
                                className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-150"
                                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <span style={{ color: 'rgba(210,140,160,0.7)' }}>{action.icon}</span>
                                <div>
                                    <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>{action.title}</p>
                                    <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{action.desc}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recent activity */}
                <div className="lg:col-span-2 rounded-xl p-5 space-y-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h2 className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        Recent Activity
                    </h2>
                    <div className="space-y-1">
                        {recentActivity.map((item, i) => (
                            <div key={i} className="flex items-center gap-3 py-2.5"
                                style={{ borderBottom: i < recentActivity.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                    style={{ background: typeColors[item.type] }} />
                                <p className="flex-1 text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>{item.action}</p>
                                <p className="text-[10px] flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>{item.time}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Usage bar */}
            {/* <div className="rounded-xl p-5 space-y-3"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Monthly Usage</h2>
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>12,400 / 50,000 requests</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: '24.8%', background: 'linear-gradient(90deg, rgba(210,140,160,0.6), rgba(210,140,160,0.9))' }} />
                </div>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    24.8% used — 37,600 requests remaining this month
                </p>
            </div> */}
        </div>
    )
}

function getTimeOfDay() {
    const h = new Date().getHours()
    if (h < 12) return 'morning'
    if (h < 17) return 'afternoon'
    return 'evening'
}