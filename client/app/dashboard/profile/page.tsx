'use client'
import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'

interface ModelStat {
    model: string
    usage: number
}

// Kept your quick actions exactly the same
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
    const userId = session?.user?.id

    // 1. Core State Hooks
    const [dbStats, setDbStats] = useState<ModelStat[]>([])
    const [loading, setLoading] = useState(true)
    
    // 2. Hydration-Safe Clock State
    const [time, setTime] = useState<Date | null>(null)

    // Clock Effect: Ticks every 1000ms
    useEffect(() => {
        setTime(new Date()) // Set immediately on client mount
        const timer = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(timer) // Cleanup on unmount
    }, [])

    // Fetch Effect: Pulls MongoDB usage data
    useEffect(() => {
        if (!userId) return

        async function fetchWorkspaceStats() {
            try {
                const res = await fetch(`/api/llm/${userId}`)
                const json = await res.json()
                if (json.success) {
                    setDbStats(json.stats)
                }
            } catch (err) {
                console.error("Error pulling analytics records:", err)
            } finally {
                setLoading(false)
            }
        }

        fetchWorkspaceStats()
    }, [userId])

    // 3. DERIVED ANALYTICS (This catches the interviewer's eye!)
    const totalRequests = dbStats.reduce((acc, curr) => acc + curr.usage, 0)
    const activeModelsCount = dbStats.filter(m => m.usage > 0).length
    
    // Find the model with the highest usage
    const topModel = dbStats.length > 0 
        ? dbStats.reduce((prev, current) => (prev.usage > current.usage) ? prev : current) 
        : null
    
    // Calculate the traffic share percentage of the top model
    const topModelShare = (topModel && totalRequests > 0) 
        ? Math.round((topModel.usage / totalRequests) * 100) 
        : 0

    // Format the model name cleanly (removes vendor prefix like "qwen/" if it exists)
    const formattedTopModelName = topModel ? topModel.model.split('/').pop() : 'None'

    const dynamicStats = [
        { label: 'Active Models', value: loading ? '...' : String(activeModelsCount), change: 'In use' },
        { label: 'Total Requests', value: loading ? '...' : totalRequests.toLocaleString(), change: 'Lifetime queries' },
        // Replaced Knowledge Bases with Top Model data
        { label: 'Top Model', value: loading ? '...' : formattedTopModelName, change: topModelShare > 0 ? `${topModelShare}% of all traffic` : 'Awaiting data' },
        // Replaced Avg Response with Average Usage per Model
        { label: 'Avg / Model', value: loading ? '...' : activeModelsCount ? Math.round(totalRequests / activeModelsCount).toLocaleString() : '0', change: 'Requests per model' },
    ]

    return (
        <div className="min-h-full p-6 space-y-8" style={{ color: 'rgba(255,255,255,0.85)' }}>

            {/* Header Section with Clock */}
            <div className="flex items-end justify-between relative">
                <div className="space-y-1">
                    <p className="text-xs font-mono tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                    <h1 className="text-2xl font-light tracking-wider font-mono">
                        Good {getTimeOfDay()},{' '}
                        <span style={{ color: 'rgba(210,140,160,0.9)' }} className="font-semibold">{firstName}</span>
                    </h1>
                    <p className="text-sm font-mono tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        Here's what's happening with your workspace today.
                    </p>
                </div>
                
                {/* Live Clock UI (Only renders on client to prevent SSR errors) */}
                {time && (
                    <div className="absolute top-4 right-10 flex items-center gap-2 px-3 py-1.5 rounded-full" style={{  }}>
                        {/* Blinking Live Indicator */}
                        {/* <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgba(210,140,160,0.9)' }} /> */}
                        <span className="font-mono text-xl font-medium tracking-widest" style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {time.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                    </div>
                )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {dynamicStats.map((stat) => (
                    <div key={stat.label} className="rounded-xl p-4 space-y-2"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <p className=" font-mono text-[10px] uppercase tracking-widest line-clamp-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {stat.label}
                        </p>
                        <p className="text-2xl font-light truncate font-mono ">{stat.value}</p>
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
                                className="w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-150 hover:bg-white/5"
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

                {/* Activity Leaderboard */}
                <div className="lg:col-span-2 rounded-xl p-5 space-y-4"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            Model Usage Leaderboard
                        </h2>
                    </div>
                    
                    {loading ? (
                         <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading analytics...</p>
                    ) : dbStats.length === 0 ? (
                        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No models used yet. Send a message to start tracking!</p>
                    ) : (
                        <div className="space-y-1">
                            {dbStats.map((item, i) => (
                                <div key={i} className="flex items-center gap-3 py-2.5"
                                    style={{ borderBottom: i < dbStats.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                        style={{ background: i === 0 ? 'rgba(210,140,160,1)' : 'rgba(255,255,255,0.2)' }} />
                                    <p className="flex-1 text-xs font-medium" style={{ color: i === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.55)' }}>
                                        {item.model}
                                    </p>
                                    <p className="text-[11px] font-mono flex-shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>
                                        {item.usage.toLocaleString()} req
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function getTimeOfDay() {
    const h = new Date().getHours()
    if (h < 12) return 'morning'
    if (h < 17) return 'afternoon'
    return 'evening'
}