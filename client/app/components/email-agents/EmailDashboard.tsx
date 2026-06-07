'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Mail, RefreshCw, LogOut } from 'lucide-react'
import {
  fetchEmails, fetchEmailStats, revokeGmailAuth, syncEmailAgent,
  type EmailItem, type EmailStats,
} from '@/lib/automationApi'
import EmailCard from './EmailCard'
import EmailStatsBar from './EmailStats'
import EmailDetail from './EmailDetail'

const CATEGORIES = ['all', 'work', 'personal', 'bill', 'newsletter', 'spam', 'critical']
const PRIORITIES = ['all', 'high', 'medium', 'low']

function InboxLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-6">
      <RefreshCw size={18} className="animate-spin" style={{ color: 'rgba(210,140,160,0.75)' }} />
      <p className="text-[11px] font-mono text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {message}
      </p>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1 h-1 rounded-full animate-pulse"
            style={{ background: 'rgba(210,140,160,0.45)', animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div
      className="grid flex-shrink-0"
      style={{
        gridTemplateColumns: 'repeat(6, 1fr)',
        background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        gap: '1px',
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center py-3 gap-1.5" style={{ background: '#010003' }}>
          <div className="h-4 w-8 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-2 w-10 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
        </div>
      ))}
    </div>
  )
}

export default function EmailDashboard({ userEmail }: { userEmail: string }) {
  const [emails, setEmails] = useState<EmailItem[]>([])
  const [stats, setStats] = useState<EmailStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadMessage, setLoadMessage] = useState('Syncing inbox from Gmail...')
  const [category, setCategory] = useState('all')
  const [priority, setPriority] = useState('all')
  const [selected, setSelected] = useState<EmailItem | null>(null)
  const initialSyncDone = useRef(false)
  const skipFilterReload = useRef(true)

  const fetchInboxData = useCallback(async () => {
    const [emailData, statsData] = await Promise.all([
      fetchEmails(userEmail, {
        page_size: 40,
        category: category !== 'all' ? category : undefined,
        priority: priority !== 'all' ? priority : undefined,
      }),
      fetchEmailStats(userEmail),
    ])
    setEmails(emailData.emails ?? [])
    setStats(statsData)
  }, [userEmail, category, priority])

  const syncAndLoad = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
      setLoadMessage('Refreshing inbox...')
    } else {
      setLoading(true)
      setLoadMessage('Syncing inbox from Gmail...')
    }

    try {
      setLoadMessage('Fetching & triaging emails...')
      await syncEmailAgent(userEmail)
      setLoadMessage('Loading inbox...')
      await fetchInboxData()
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userEmail, fetchInboxData])

  // Auto-sync once when connected / email is available
  useEffect(() => {
    if (!userEmail) return

    initialSyncDone.current = false
    skipFilterReload.current = true
    let cancelled = false

      ; (async () => {
        setLoading(true)
        setLoadMessage('Syncing inbox from Gmail...')
        try {
          setLoadMessage('Fetching & triaging emails...')
          await syncEmailAgent(userEmail)
          if (cancelled) return
          setLoadMessage('Loading inbox...')
          const [emailData, statsData] = await Promise.all([
            fetchEmails(userEmail, { page_size: 40 }),
            fetchEmailStats(userEmail),
          ])
          if (cancelled) return
          setEmails(emailData.emails ?? [])
          setStats(statsData)
          initialSyncDone.current = true
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()

    return () => { cancelled = true }
  }, [userEmail])

  // Filter changes: reload list only (no full Gmail sync)
  useEffect(() => {
    if (skipFilterReload.current) {
      skipFilterReload.current = false
      return
    }
    if (!initialSyncDone.current || loading) return

    let cancelled = false
      ; (async () => {
        setRefreshing(true)
        await fetchInboxData()
        if (!cancelled) setRefreshing(false)
      })()
    return () => { cancelled = true }
  }, [category, priority, fetchInboxData, loading])

  const handleSync = async () => {
    await syncAndLoad(true)
  }

  const handleRevoke = async () => {
    if (!confirm('Disconnect Gmail? OAuth tokens will be removed.')) return
    await revokeGmailAuth(userEmail)
    window.location.reload()
  }

  const handleSelect = (email: EmailItem) => {
    setSelected(prev => prev?._id === email._id ? null : email)
  }

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden border"
      style={{ background: '#010003', borderColor: 'rgba(255, 255, 255, 0.21)', minHeight: '480px' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
        // style={{ borderBottom: '1px solid rgba(255, 255, 255, 0)' }}
        >
        <div className="flex items-center gap-2.5">
          <Mail size={14} style={{ color: 'rgba(210,140,160,0.65)' }} />
          <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.78)' }}>
            Inbox
          </span>
          {stats && !loading && (
            <span className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(210,140,160,0.08)', color: 'rgba(210,140,160,0.65)' }}>
              {stats.total} processed
            </span>
          )}
          {(loading || refreshing) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: 'rgba(210,140,160,0.06)', color: 'rgba(210,140,160,0.55)' }}>
              <RefreshCw size={9} className="animate-spin" />
              {loading ? 'syncing' : 'updating'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleSync} disabled={loading || refreshing}
            className="p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            title="Sync from Gmail"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleRevoke}
            className="p-1.5 rounded-lg cursor-pointer transition-colors"
            style={{ color: 'rgba(255,80,80,0.4)' }}
            title="Disconnect"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>


      <div className="  w-[100%]">
        {loading ? <StatsSkeleton /> : stats ? <EmailStatsBar stats={stats} /> : null}
      </div>


      {/* Filters */}
      <div className="px-4 py-2.5 space-y-2 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.21)' }}>
        <div className="flex gap-1 flex-wrap my-2">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer capitalize disabled:opacity-40"
              style={{
                background: category === c ? 'rgba(210,140,160,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${category === c ? 'rgba(210,140,160,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: category === c ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)',
              }}
            >{c}</button>
          ))}
        </div>
        <div className="flex gap-1 mt-4 mb-2">
          {PRIORITIES.map(p => (
            <button key={p} onClick={() => setPriority(p)} disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer capitalize disabled:opacity-40"
              style={{
                background: priority === p ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: priority === p ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.25)',
              }}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* List + detail */}
      <div className="flex flex-1 min-h-0 transition-all duration-300" style={{ maxHeight: selected ? '800px' : '540px' }}>
        <div className="flex flex-col flex-shrink-0 overflow-y-auto"
          style={{
            width: selected ? '340px' : '100%',
            borderRight: selected ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}>
          {loading ? (
            <InboxLoader message={loadMessage} />
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2.5 px-4">
              <Mail size={22} style={{ color: 'rgba(255,255,255,0.08)' }} />
              <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.22)' }}>
                No processed emails yet — inbox will sync automatically when connected
              </p>
            </div>
          ) : (
            emails.map(email => (
              <EmailCard
                key={email._id}
                email={email}
                selected={selected?._id === email._id}
                onClick={() => handleSelect(email)}
                userEmail={userEmail}
                onUpdate={() => syncAndLoad(true)}
              />
            ))
          )}
        </div>

        {selected && !loading && (
          <div className="flex-1 min-w-0 overflow-hidden">
            <EmailDetail
              email={selected}
              userEmail={userEmail}
              onClose={() => setSelected(null)}
              onUpdate={() => syncAndLoad(true)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
