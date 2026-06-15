'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Mail, RefreshCw, LogOut, Wifi } from 'lucide-react'
import {
  fetchEmails,
  fetchEmailStats,
  fetchAutoRepliedToday,
  revokeGmailAuth,
  subscribeEmailStream,
  dismissEmail,
  deleteEmail,
  type EmailItem,
  type EmailStats,
  type AutoRepliedItem,
  type MetricsUpdatedPayload,
  markEmailAsRead,
  isSystemDropEmail,
} from '@/lib/automationApi'
import {
  loadQueue,
  saveQueue,
  addCard as storageAddCard,
  removeCard as storageRemoveCard,
} from '@/lib/attentionStorage'
import { loadMetrics, saveMetrics } from '@/lib/metricsStorage'
import { useAttentionToast } from './AttentionToast'
import EmailCard from './EmailCard'
import EmailStatsBar from './EmailStats'
import EmailDetail from './EmailDetail'
import DeleteConfirmationModal from './DeleteConfirmationModal'
import { isEmailFromUser } from '@/lib/emailText'

const CATEGORIES = ['all', 'work', 'personal', 'bill', 'newsletter', 'spam', 'critical', 'auto-replied']
const PRIORITIES = ['all', 'high', 'medium', 'low']
const INBOX_PAGE_SIZE = 100

const LIST_MIN_WIDTH = 220
const LIST_MAX_WIDTH = 640
const LIST_DEFAULT_WIDTH = 340

const EMPTY_STATS: EmailStats = {
  activeCards: 0,
  autoRepliesTotal: 0,
  systemDroppedTotal: 0,
  manualAttentionTotal: 0,
  total: 0,
  unread: 0,
  critical_unread: 0,
  today_processed: 0,
  by_category: {},
  by_priority: {},
}

function dedupeEmails(emails: EmailItem[]): EmailItem[] {
  const seen = new Set<string>()
  return emails.filter(e => {
    if (isSystemDropEmail(e)) return false
    const id = e._id || e.gmail_message_id
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function matchesFilters(email: EmailItem, category: string, priority: string): boolean {
  if (category !== 'all' && email.category !== category) return false
  if (priority !== 'all' && email.priority !== priority) return false
  return true
}

/** Preserve is_read from localStorage when server list does not carry read state. */
function mergeReadState(fetched: EmailItem[], cached: EmailItem[]): EmailItem[] {
  const readIds = new Set(
    cached.filter(e => e.is_read).flatMap(e => [e._id, e.gmail_message_id].filter(Boolean))
  )
  if (readIds.size === 0) return fetched
  return fetched.map(email => {
    const id = email._id || email.gmail_message_id
    return readIds.has(id) ? { ...email, is_read: true } : email
  })
}

function syncStatsWithQueue(stats: EmailStats, queue: EmailItem[]): EmailStats {
  const pending = queue.filter(e => !e.is_read).length
  return {
    ...stats,
    activeCards: pending,
    total: queue.length,
    unread: pending,
    critical_unread: queue.filter(e => e.category === 'critical' && !e.is_read).length,
  }
}

function metricsFromWS(payload: MetricsUpdatedPayload): Partial<EmailStats> {
  return {
    autoRepliesTotal: payload.auto_replies_total,
    systemDroppedTotal: payload.system_dropped_total,
    manualAttentionTotal: payload.manual_attention_historical_total,
    automationRate: payload.automation_rate,
    autoSendCountToday: payload.auto_send_count_today,
    inboxCleanedTotal: payload.inbox_cleaned_total,
    today_processed: payload.auto_replies_total + payload.system_dropped_total,
  }
}

function isValidAutoRepliedItem(item: AutoRepliedItem): boolean {
  return Boolean(
    item.subject?.trim()
    || item.from_name?.trim()
    || item.from_address?.trim()
    || item.snippet?.trim()
    || item.reply_preview?.trim()
  )
}

function autoRepliedToEmailItem(item: AutoRepliedItem): EmailItem {
  const id = item._id || item.message_id
  return {
    _id: id,
    gmail_message_id: item.message_id,
    thread_id: '',
    subject: item.subject || '(no subject)',
    from_name: item.from_name || '',
    from_address: item.from_address || '',
    snippet: item.snippet || '',
    body_text: item.snippet || '',
    date: item.timestamp ?? '',
    category: item.category || 'work',
    priority: item.priority || 'medium',
    summary: '',
    llm_action: 'auto_replied',
    llm_reasoning: '',
    needs_reply: false,
    auto_reply_sent: true,
    reply_preview: item.reply_preview,
    draft_id: null,
    draft_body: null,
    gmail_link: '',
    user_overrode: false,
    user_action: null,
    is_read: true,
    is_trashed: false,
    alert_sent_to_user: false,
    processed_at: item.timestamp ?? '',
    synced_at: item.timestamp ?? '',
    provider: 'gmail',
  }
}

function InboxLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 px-6">
      <RefreshCw size={18} className="animate-spin" style={{ color: 'rgba(210,140,160,0.75)' }} />
      <p className="text-[11px] font-mono text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {message}
      </p>
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid flex-shrink-0"
      style={{ gridTemplateColumns: 'repeat(6, 1fr)', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '1px' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center py-3 gap-1.5" style={{ background: '#010003' }}>
          <div className="h-4 w-8 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          <div className="h-2 w-10 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.05)' }} />
        </div>
      ))}
    </div>
  )
}

// ── Resizer handle ─────────────────────────────────────────────────

function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const dragging = useRef(false)
  const lastX = useRef(0)
  const [hovered, setHovered] = useState(false)
  const [active, setActive] = useState(false)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    lastX.current = e.clientX
    setActive(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastX.current
      lastX.current = e.clientX
      onDrag(dx)
    }
    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      setActive(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onDrag])

  const isLit = hovered || active

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '12px',
        flexShrink: 0,
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Visible line */}
      <div style={{
        width: '1px',
        height: '100%',
        background: isLit
          ? 'rgba(210,140,160,0.45)'
          : 'rgba(255,255,255,0.07)',
        transition: 'background 0.15s ease',
        position: 'relative',
      }}>
        {/* Drag grip dots — center of the handle */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
          opacity: isLit ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '3px',
              height: '3px',
              borderRadius: '50%',
              background: 'rgba(210,140,160,0.7)',
            }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────

export default function EmailDashboard({
  userEmail,
  onStatsUpdated,
}: {
  userEmail: string
  onStatsUpdated?: (stats: EmailStats) => void
}) {
  const [allEmails, setAllEmails] = useState<EmailItem[]>(() => dedupeEmails(loadQueue(userEmail)))
  const [stats, setStats] = useState<EmailStats | null>(() => loadMetrics(userEmail))
  const [loading, setLoading] = useState(() => dedupeEmails(loadQueue(userEmail)).length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [liveConnected, setLiveConnected] = useState(false)
  const [inboxError, setInboxError] = useState<string | null>(null)
  const [category, setCategory] = useState('all')
  const [priority, setPriority] = useState('all')
  const [selected, setSelected] = useState<EmailItem | null>(null)
  const [autoRepliedList, setAutoRepliedList] = useState<AutoRepliedItem[]>([])
  const [autoRepliedLoading, setAutoRepliedLoading] = useState(false)
  const [listWidth, setListWidth] = useState(LIST_DEFAULT_WIDTH)

  const handleResizeDrag = useCallback((dx: number) => {
    setListWidth(prev => Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, prev + dx)))
  }, [])

  const isAutoRepliedTab = category === 'auto-replied'
  const { showToast, ToastContainer } = useAttentionToast()
  const onStatsUpdatedRef = useRef(onStatsUpdated)
  onStatsUpdatedRef.current = onStatsUpdated

  const [initialFetchDone, setInitialFetchDone] = useState(false)

  const notifyParentStats = useCallback((synced: EmailStats) => {
    queueMicrotask(() => onStatsUpdatedRef.current?.(synced))
  }, [])

  /** Empty queue before first server fetch — avoid flashing 0 pending / empty inbox */
  const isBootstrapping = !initialFetchDone && !isAutoRepliedTab && allEmails.length === 0

  const displayStats = useMemo(
    () => (isBootstrapping ? null : stats ? syncStatsWithQueue(stats, allEmails) : null),
    [stats, allEmails, isBootstrapping]
  )

  const visibleEmails = useMemo(() => {
    if (isAutoRepliedTab) {
      return autoRepliedList
        .filter(isValidAutoRepliedItem)
        .map(autoRepliedToEmailItem)
        .filter(e => priority === 'all' || e.priority === priority)
    }
    return allEmails.filter(e => {
      if (!isAutoRepliedTab && isEmailFromUser(e, userEmail)) return false
      return matchesFilters(e, category, priority)
    })
  }, [allEmails, category, priority, autoRepliedList, isAutoRepliedTab])

  const applyStats = useCallback((s: EmailStats, queue: EmailItem[]) => {
    const synced = syncStatsWithQueue(s, queue)
    setStats(synced)
    saveMetrics(userEmail, synced)
    notifyParentStats(synced)
  }, [userEmail, notifyParentStats])

  const addEmail = useCallback((card: EmailItem) => {
    if (isSystemDropEmail(card)) return
    setAllEmails(prev => {
      if (prev.some(e => e._id === card._id)) return prev
      const next = dedupeEmails([card, ...prev])
      saveQueue(userEmail, next)
      storageAddCard(userEmail, card)
      setStats(s => {
        if (!s) return s
        const synced = syncStatsWithQueue(s, next)
        saveMetrics(userEmail, synced)
        notifyParentStats(synced)
        return synced
      })
      return next
    })
  }, [userEmail, notifyParentStats])

  const removeEmail = useCallback((emailId: string) => {
    setAllEmails(prev => {
      const next = prev.filter(e => e._id !== emailId && e.gmail_message_id !== emailId)
      saveQueue(userEmail, next)
      storageRemoveCard(userEmail, emailId)
      setStats(s => {
        if (!s) return s
        const synced = syncStatsWithQueue(s, next)
        saveMetrics(userEmail, synced)
        notifyParentStats(synced)
        return synced
      })
      return next
    })
    setSelected(prev => (prev?._id === emailId ? null : prev))
  }, [userEmail, notifyParentStats])

  const applyReadState = useCallback((emailId: string, isRead: boolean) => {
    setAllEmails(prev => {
      const next = prev.map(email =>
        (email._id === emailId || email.gmail_message_id === emailId)
          ? { ...email, is_read: isRead }
          : email
      )
      saveQueue(userEmail, next)
      setStats(s => {
        if (!s) return s
        const synced = syncStatsWithQueue(s, next)
        saveMetrics(userEmail, synced)
        notifyParentStats(synced)
        return synced
      })
      return next
    })
    setSelected(prev => {
      if (!prev || (prev._id !== emailId && prev.gmail_message_id !== emailId)) return prev
      return { ...prev, is_read: isRead }
    })
  }, [userEmail, notifyParentStats])



  useEffect(() => {
    if (!userEmail) return
    let cancelled = false
    setInitialFetchDone(false)
    const cached = loadQueue(userEmail)
      ; (async () => {
        try {
          const [emailData, statsData] = await Promise.all([
            fetchEmails(userEmail, { page_size: INBOX_PAGE_SIZE, refresh: true }),
            fetchEmailStats(userEmail),
          ])
          if (cancelled) return
          let nextQueue = dedupeEmails(cached)
          if (emailData) {
            if (emailData.error === 'database_disconnected') {
              setInboxError('MongoDB not connected on the email-agent-server.')
            } else if (emailData.error) {
              setInboxError('Could not load inbox. Check that the email-agent-server is running.')
            } else {
              setInboxError(null)
              nextQueue = mergeReadState(dedupeEmails(emailData.emails ?? []), cached)
              setAllEmails(nextQueue)
              saveQueue(userEmail, nextQueue)
            }
          }
          if (statsData) applyStats(statsData, nextQueue)
        } finally {
          if (!cancelled) {
            setLoading(false)
            setInitialFetchDone(true)
          }
        }
      })()
    return () => { cancelled = true }
  }, [userEmail, applyStats])

  useEffect(() => {
    if (!userEmail || !isAutoRepliedTab) return
    let cancelled = false
    setAutoRepliedLoading(true)
    fetchAutoRepliedToday(userEmail).then(data => {
      if (cancelled) return
      setAutoRepliedList(data.items.filter(isValidAutoRepliedItem))
      setStats(s => {
        if (!s) return s
        const next = { ...s, autoSendCountToday: data.count_today }
        saveMetrics(userEmail, next)
        notifyParentStats(next)
        return next
      })
      setAutoRepliedLoading(false)
    })
    return () => { cancelled = true }
  }, [userEmail, isAutoRepliedTab])



  useEffect(() => {
    if (!userEmail) return
    const unsubscribe = subscribeEmailStream(userEmail, {
      onConnect: () => setLiveConnected(true),
      onDisconnect: () => setLiveConnected(false),
      onNewEmail: (card) => {
        addEmail(card)
        showToast(card, () => setSelected(card))
      },
      onEmailRemoved: (emailId) => removeEmail(emailId),
      onEmailRead: (emailId) => applyReadState(emailId, true),
      onAutoReplied: (item) => {
        if (!isValidAutoRepliedItem(item)) return
        setAutoRepliedList(prev => {
          if (prev.some(i => i.message_id === item.message_id)) return prev
          return [item, ...prev]
        })
        setStats(s => {
          if (!s) return s
          const next = {
            ...s,
            autoRepliesTotal: (s.autoRepliesTotal ?? 0) + 1,
            autoSendCountToday: (s.autoSendCountToday ?? 0) + 1,
          }
          saveMetrics(userEmail, next)
          notifyParentStats(next)
          return next
        })
      },
      onMetricsUpdated: (payload) => {
        setAllEmails(queue => {
          setStats(prev => {
            const next = syncStatsWithQueue(
              { ...(prev ?? EMPTY_STATS), ...metricsFromWS(payload) },
              queue
            )
            saveMetrics(userEmail, next)
            notifyParentStats(next)
            return next
          })
          return queue
        })
      },
    })
    return () => { unsubscribe(); setLiveConnected(false) }
  }, [userEmail, addEmail, removeEmail, applyReadState, showToast, notifyParentStats])





  // Mark as read when opening an unread attention-queue email
  useEffect(() => {
    if (!selected || !userEmail) return
    if (isAutoRepliedTab || selected.llm_action === 'auto_replied') return
    if (selected.is_read) return

    const emailId = selected._id || selected.gmail_message_id
    if (!emailId) return

    applyReadState(emailId, true)

    markEmailAsRead(userEmail, emailId).catch(err => {
      console.error('[Dashboard] Failed to mark email as reviewed on server:', err)
      applyReadState(emailId, false)
    })
  }, [selected?._id, selected?.is_read, userEmail, isAutoRepliedTab, applyReadState])




  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [emailData, statsData] = await Promise.all([
        fetchEmails(userEmail, { page_size: INBOX_PAGE_SIZE, refresh: true }),
        fetchEmailStats(userEmail),
      ])
      if (!emailData.error) {
        const list = mergeReadState(dedupeEmails(emailData.emails ?? []), loadQueue(userEmail))
        setAllEmails(list)
        saveQueue(userEmail, list)
        if (statsData) applyStats(statsData, list)
      } else if (statsData) {
        applyStats(statsData, allEmails)
      }
      if (isAutoRepliedTab) {
        const autoData = await fetchAutoRepliedToday(userEmail)
        setAutoRepliedList(autoData.items.filter(isValidAutoRepliedItem))
        setStats(s => {
          if (!s) return s
          const next = { ...s, autoSendCountToday: autoData.count_today }
          saveMetrics(userEmail, next)
          notifyParentStats(next)
          return next
        })
      }
    } finally {
      setRefreshing(false)
    }
  }, [userEmail, applyStats, allEmails, isAutoRepliedTab, notifyParentStats])

  const handleRevoke = async () => {
    if (!confirm('Disconnect Gmail? OAuth tokens will be removed.')) return
    await revokeGmailAuth(userEmail)
    window.location.reload()
  }

  const handleSelect = (email: EmailItem) => {
    setSelected(prev => (prev?._id === email._id ? null : email))
  }

  const handleCategoryChange = (c: string) => {
    setCategory(c)
    setSelected(null)
  }

  const handleDismiss = useCallback(async (emailId: string) => {
    removeEmail(emailId)
    await dismissEmail(userEmail, emailId).catch(() => { })
  }, [userEmail, removeEmail])


  // --------------delete email logic---------------------
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  // Step 1: trash click — open modal, remember which email
  const handleDelete = (emailId: string) => {
    setPendingDeleteId(emailId)
    setModalOpen(true)
  }
  // Step 2: confirm — remove from UI immediately, API in background
  const confirmDelete = async () => {
    if (!pendingDeleteId) return
    const emailId = pendingDeleteId
    removeEmail(emailId)           // immediate UI removal + closes detail via removeEmail
    setModalOpen(false)
    setPendingDeleteId(null)
    await deleteEmail(userEmail, emailId).catch(() => { })
  }




  return (
    <>
      <ToastContainer />

      <div
        className={`flex flex-col rounded-2xl overflow-hidden border ${selected ? 'h-[1100px]' : 'h-[700px]'}`}
        style={{ background: '#010003', borderColor: 'rgba(255, 255, 255, 0.21)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Mail size={14} style={{ color: 'rgba(210,140,160,0.65)' }} />
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.78)' }}>
              {isAutoRepliedTab ? 'Auto-Replied Today' : 'Attention Queue'}
            </span>
            {displayStats && !isAutoRepliedTab && !isBootstrapping && (
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(210,140,160,0.08)', color: 'rgba(210,140,160,0.65)' }}>
                {displayStats.activeCards} pending
              </span>
            )}
            {isBootstrapping && (
              <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: 'rgba(210,140,160,0.06)', color: 'rgba(210,140,160,0.55)' }}>
                <RefreshCw size={9} className="animate-spin" />syncing
              </span>
            )}
            {displayStats && isAutoRepliedTab && (
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(80,200,120,0.08)', color: 'rgba(100,220,130,0.75)' }}>
                {displayStats.autoSendCountToday ?? 0} today
              </span>
            )}
            {liveConnected && (
              <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: 'rgba(80,200,120,0.08)', color: 'rgba(100,220,130,0.75)' }}>
                <Wifi size={9} />live
              </span>
            )}
            {refreshing && (
              <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: 'rgba(210,140,160,0.06)', color: 'rgba(210,140,160,0.55)' }}>
                <RefreshCw size={9} className="animate-spin" />refreshing
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleRefresh} disabled={refreshing}
              className="p-1.5 rounded-lg cursor-pointer transition-colors disabled:opacity-40"
              style={{ color: 'rgba(255,255,255,0.25)' }} title="Refresh list">
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button onClick={handleRevoke}
              className="p-1.5 rounded-lg cursor-pointer transition-colors"
              style={{ color: 'rgba(255,80,80,0.4)' }} title="Disconnect">
              <LogOut size={13} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="w-[100%]">
          {isBootstrapping || (loading && !displayStats)
            ? <StatsSkeleton />
            : displayStats
              ? <EmailStatsBar stats={displayStats} />
              : null}
        </div>

        {/* Filters */}
        <div className="px-4 py-2.5 space-y-2 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.21)' }}>
          <div className="flex gap-1 flex-wrap my-2">
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => handleCategoryChange(c)} disabled={loading}
                className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer capitalize disabled:opacity-40"
                style={{
                  background: category === c ? 'rgba(210,140,160,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${category === c ? 'rgba(210,140,160,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  color: category === c ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)',
                }}>{c}</button>
            ))}
          </div>
          <div className="flex gap-1 mt-4 mb-2">
            {PRIORITIES.map(p => (
              <button key={p} onClick={() => setPriority(p)} disabled={loading}
                className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer capitalize disabled:opacity-40"
                style={{
                  background: priority === p ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: priority === p ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.25)',
                }}>{p}</button>
            ))}
          </div>
        </div>

        {/* List + resizer + detail */}
        <div className={`flex min-h-0 ${selected ? 'flex-1' : ''}`}>

          {/* Email list */}
          <div
            className={`flex flex-col flex-shrink-0 overflow-y-auto ${selected ? 'h-full' : 'max-h-[560px]'}`}
            style={{
              width: selected ? `${listWidth}px` : '100%',
              minWidth: selected ? `${LIST_MIN_WIDTH}px` : undefined,
              maxWidth: selected ? `${LIST_MAX_WIDTH}px` : undefined,
            }}
          >
            {isAutoRepliedTab && autoRepliedLoading ? (
              <InboxLoader message="Loading auto-replied emails…" />
            ) : isBootstrapping ? (
              <InboxLoader message="Loading attention queue…" />
            ) : inboxError ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
                <Mail size={22} style={{ color: 'rgba(255,170,0,0.35)' }} />
                <p className="text-xs leading-relaxed max-w-md" style={{ color: 'rgba(255,190,80,0.85)' }}>
                  {inboxError}
                </p>
              </div>
            ) : visibleEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2.5 px-4">
                <Mail size={22} style={{ color: 'rgba(255,255,255,0.08)' }} />
                <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.22)' }}>
                  {isAutoRepliedTab
                    ? 'No auto-replies sent today yet.'
                    : allEmails.length === 0
                      ? initialFetchDone
                        ? liveConnected ? 'Inbox clear — new emails will appear here live.' : 'Connecting live stream…'
                        : null
                      : 'No cards match these filters.'}
                </p>
              </div>
            ) : (
              visibleEmails.map(email => (
                <EmailCard
                  key={email._id || email.gmail_message_id}
                  email={email}
                  selected={selected?._id === email._id}
                  onClick={() => handleSelect(email)}
                  userEmail={userEmail}
                  readOnly={isAutoRepliedTab || email.llm_action === 'auto_replied'}
                />
              ))
            )}
          </div>

          {/* Drag handle — only when detail is open */}
          {selected && <ResizeHandle onDrag={handleResizeDrag} />}

          {/* Detail panel */}
          {selected && (
            <div className="flex flex-1 flex-col min-w-0 min-h-0 h-full overflow-hidden">
              <EmailDetail
                email={selected}
                userEmail={userEmail}
                onClose={() => setSelected(null)}
                onDismiss={() => handleDismiss(selected._id)}
                onRemove={removeEmail}
                onDelete={handleDelete}
                readOnly={isAutoRepliedTab || selected.llm_action === 'auto_replied'}
              />
            </div>
          )}
        </div>

        
        <DeleteConfirmationModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setPendingDeleteId(null) }}
          onConfirm={confirmDelete}
        />


      </div>
    </>
  )
}