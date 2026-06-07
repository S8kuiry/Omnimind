'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Mail, RefreshCw, LogOut } from 'lucide-react'
import {
  fetchEmails, fetchEmailStats, markEmailAsRead, revokeGmailAuth, syncEmailAgent,
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
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [lastSyncProcessed, setLastSyncProcessed] = useState<number | null>(null)
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
    if (emailData.error === 'database_disconnected') {
      setInboxError('MongoDB is not connected on the email-agent-server. Gmail counts work, but the inbox list is stored in the database — add Atlas network access or check MONGODB_URI on the server.')
    } else if (emailData.error) {
      setInboxError('Could not load inbox from the server. Check that the email-agent-server is running.')
    } else {
      setInboxError(null)
    }
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
      const syncResult = await syncEmailAgent(userEmail)
      if (syncResult?.sync_processed != null) {
        setLastSyncProcessed(syncResult.sync_processed)
      }
      if (syncResult?.db_connected === false) {
        setInboxError('MongoDB is not connected on the email-agent-server. Gmail thread counts (201) are live from Google, but emails must be triaged and saved to MongoDB before they appear in this inbox.')
      }
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
          const syncResult = await syncEmailAgent(userEmail)
          if (cancelled) return
          if (syncResult?.sync_processed != null) {
            setLastSyncProcessed(syncResult.sync_processed)
          }
          if (syncResult?.db_connected === false) {
            setInboxError('MongoDB is not connected on the email-agent-server. Gmail thread counts are live from Google, but the inbox list requires MongoDB.')
          }
          setLoadMessage('Loading inbox...')
          const [emailData, statsData] = await Promise.all([
            fetchEmails(userEmail, { page_size: 40 }),
            fetchEmailStats(userEmail),
          ])
          if (cancelled) return
          if (emailData.error === 'database_disconnected') {
            setInboxError('MongoDB is not connected on the email-agent-server. Check MONGODB_URI and Atlas Network Access (allow your IP or 0.0.0.0/0).')
          }
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

  const handleSelect = async (email: EmailItem) => {
    // Check if we are opening a new email or closing the current one
    const isOpening = selected?._id !== email._id

    // Toggle selection panel layout
    setSelected(prev => prev?._id === email._id ? null : email)

    // If we are opening an email and it is currently unread, update it
    if (isOpening && !email.is_read) {
      
      // 1. OPTIMISTIC UPDATE: Instantly change local state so UI updates without lag
      setEmails(prevEmails =>
        prevEmails.map(item => 
          item._id === email._id ? { ...item, is_read: true } : item
        )
      )

      try {
        // 2. BACKEND SYNC: Fire background network request to FastAPI
        await markEmailAsRead(userEmail, email._id)

        // 3. COUNTER SYNC: Refresh the stats bar quietly to update the counts
        const statsData = await fetchEmailStats(userEmail)
        setStats(statsData)
        
      } catch (err) {
        console.error("[Dashboard Error] Failed to mark email as read on server:", err)
        
        // Fallback: Rollback local state if network completely failed
        setEmails(prevEmails =>
          prevEmails.map(item => 
            item._id === email._id ? { ...item, is_read: false } : item
          )
        )
      }
    }
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
          ) : inboxError ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
              <Mail size={22} style={{ color: 'rgba(255,170,0,0.35)' }} />
              <p className="text-xs leading-relaxed max-w-md" style={{ color: 'rgba(255,190,80,0.85)' }}>
                {inboxError}
              </p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.28)' }}>
                Top stats (monitored threads) come from Gmail directly. This inbox list comes from MongoDB after AI triage.
              </p>
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2.5 px-4">
              <Mail size={22} style={{ color: 'rgba(255,255,255,0.08)' }} />
              <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.22)' }}>
                {lastSyncProcessed === 0
                  ? 'No new unread emails to process — try Refresh or check Gmail filters (only unread inbox messages are synced).'
                  : 'No processed emails yet — click sync to fetch from Gmail'}
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
