const LOCAL_EMAIL_AGENT = 'http://localhost:8000'
const PRODUCTION_EMAIL_AGENT = 'https://omnimind-6ub9.onrender.com'

export function getEmailAgentBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EMAIL_AGENT_SERVER_URL?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return PRODUCTION_EMAIL_AGENT
    }
  }

  return LOCAL_EMAIL_AGENT
}

const fetchOpts: RequestInit = { credentials: 'include' }

// ── Types ──────────────────────────────────────────────────────────

export interface BufferNotification {
  _id: string
  user_email?: string
  provider?: string
  provider_message_id?: string
  from_name: string
  from_address: string
  subject: string
  summary: string
  draft_body?: string | null
  category: string
  priority: string
  date?: string
  snippet?: string
  body_text?: string
}

export interface EmailItem {
  _id: string
  gmail_message_id: string
  thread_id: string
  subject: string
  from_name: string
  from_address: string
  snippet: string
  body_text: string
  date: string
  category: 'work' | 'newsletter' | 'bill' | 'personal' | 'spam' | 'critical' | string
  priority: 'high' | 'medium' | 'low' | string
  summary: string
  llm_action: 'auto_replied' | 'draft_saved' | 'alert_sent' | 'archived' | string
  llm_reasoning: string
  needs_reply?: boolean
  action_required?: boolean
  reply_draft?: string | null
  auto_reply_sent: boolean
  reply_preview?: string
  draft_id: string | null
  draft_body: string | null
  gmail_link: string
  user_overrode: boolean
  user_action: string | null
  is_read: boolean
  is_trashed: boolean
  alert_sent_to_user: boolean
  processed_at: string
  synced_at: string
  provider?: string
}

export interface EmailStats {
  activeCards: number
  autoRepliesTotal: number
  systemDroppedTotal: number
  manualAttentionTotal: number
  automationRate?: number
  lastUpdated?: string
  // Today breakdown
  autoResolvedToday?: number
  spamBlockedToday?: number
  attentionQueuedToday?: number
  autoSendCountToday?: number
  autoAckCountToday?: number
  inboxCleanedTotal?: number
  inboxCleanedToday?: number
  /** @deprecated use activeCards */
  total: number
  unread: number
  critical_unread: number
  today_processed: number
  by_category: Record<string, number | undefined>
  by_priority: Record<string, number | undefined>
}

export interface EmailListResponse {
  emails: EmailItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
  error?: 'database_disconnected' | 'request_failed'
}

export interface AuthStatus {
  connected: boolean
  email?: string
  last_sync?: string | null
}

export interface DraftResponse {
  draft_id: string
  draft_body: string
  to: string
  subject: string
  tone_applied?: string
}

// ── WebSocket ──────────────────────────────────────────────────────

// metrics_updated added — backend broadcasts this after every pipeline outcome
export type EmailStreamEvent = 'new_email' | 'email_removed' | 'email_read' | 'metrics_updated' | 'auto_replied'

export interface AutoRepliedItem {
  _id: string
  message_id: string
  subject: string
  from_name: string
  from_address: string
  snippet: string
  reply_preview: string
  category: string
  priority: string
  timestamp?: string
}

export interface MetricsUpdatedPayload {
  auto_replies_total: number
  system_dropped_total: number
  manual_attention_historical_total: number
  current_active_buffer_cards: number
  automation_rate: number
  inbox_cleaned_total?: number
  auto_send_count_today?: number
}

export interface EmailStreamPayload {
  event: EmailStreamEvent
  data?: BufferNotification | MetricsUpdatedPayload
  id?: string
}

export function getEmailStreamUrl(userEmail: string): string {
  const base = getEmailAgentBaseUrl()
  const wsBase = base.replace(/^https/, 'wss').replace(/^http/, 'ws')
  return `${wsBase}/emails/stream?user_email=${encodeURIComponent(userEmail)}`
}

export function subscribeEmailStream(
  userEmail: string,
  handlers: {
    onNewEmail: (card: EmailItem) => void
    onEmailRemoved?: (emailId: string) => void
    onEmailRead?: (emailId: string) => void
    onAutoReplied?: (item: AutoRepliedItem) => void
    onMetricsUpdated?: (metrics: MetricsUpdatedPayload) => void
    onConnect?: () => void
    onDisconnect?: () => void
  }
): () => void {
  let ws: WebSocket | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let attempt = 0

  const clearHeartbeat = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
  }

  const connect = () => {
    if (closed) return
    ws = new WebSocket(getEmailStreamUrl(userEmail))

    ws.onopen = () => {
      attempt = 0
      handlers.onConnect?.()
      clearHeartbeat()
      heartbeat = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
      }, 25000)
    }

    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data as string) as EmailStreamPayload

        if (payload.event === 'new_email' && payload.data) {
          handlers.onNewEmail(
            normalizeBufferCard(payload.data as BufferNotification & Record<string, unknown>)
          )
        } else if (payload.event === 'email_removed') {
          const id = payload.id ?? (payload.data as BufferNotification)?._id
          if (id) handlers.onEmailRemoved?.(String(id))
        } else if (payload.event === 'email_read') {
          const id = payload.id ?? (payload.data as BufferNotification)?._id
          if (id) handlers.onEmailRead?.(String(id))
        } else if (payload.event === 'auto_replied' && payload.data) {
          handlers.onAutoReplied?.(payload.data as unknown as AutoRepliedItem)
        } else if (payload.event === 'metrics_updated' && payload.data) {
          // Backend sends this after every pipeline outcome — drives stat bar live
          handlers.onMetricsUpdated?.(payload.data as MetricsUpdatedPayload)
        }
      } catch {
        // ignore non-json frames (pong, etc.)
      }
    }

    ws.onclose = () => {
      clearHeartbeat()
      handlers.onDisconnect?.()
      if (!closed) {
        const delay = Math.min(1000 * 2 ** attempt, 30000)
        attempt++
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => ws?.close()
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    clearHeartbeat()
    ws?.close()
  }
}

export interface CleanupSettings {
  enabled: boolean
  olderThanDays: number
}


export function isSystemDropEmail(
  email: Pick<EmailItem, 'from_address' | 'from_name' | 'subject' | 'snippet' | 'body_text' | 'summary'>
): boolean {
  const from = `${email.from_name || ''} ${email.from_address || ''}`.toLowerCase()
  const text = `${email.subject || ''} ${email.snippet || ''} ${email.body_text || ''} ${email.summary || ''}`.toLowerCase()

  if (/mailer-daemon|postmaster|mail-daemon|mail delivery subsystem|mail delivery/.test(from)) {
    return true
  }
  if (/delivery\s+status\s+notification|undelivered|mail delivery failed|returned mail/.test(text)) {
    return true
  }
  if (text.includes('delivery status') && text.includes('failure')) {
    return true
  }
  return false
}

export function normalizeBufferCard(raw: BufferNotification & Record<string, unknown>): EmailItem {
  const messageId = String(
    raw.provider_message_id ?? raw.gmail_message_id ?? raw.id ?? raw._id ?? ''
  )
  const draftBody = raw.draft_body ? String(raw.draft_body) : null
  const summary = String(raw.summary ?? '')
  const date = raw.date ? String(raw.date) : new Date().toISOString()

  return {
    _id: String(raw._id ?? raw.id ?? messageId),
    gmail_message_id: messageId,
    thread_id: String(raw.thread_id ?? ''),
    subject: String(raw.subject ?? ''),
    from_name: String(raw.from_name ?? ''),
    from_address: String(raw.from_address ?? ''),
    snippet: String(raw.snippet ?? summary),
    body_text: String(raw.body_text ?? raw.snippet ?? summary),
    date,
    category: String(raw.category ?? 'work'),
    priority: String(raw.priority ?? 'medium'),
    summary,
    llm_action: draftBody ? 'draft_saved' : 'alert_sent',
    llm_reasoning: '',
    needs_reply: true,
    action_required: raw.priority === 'high' || raw.category === 'critical',
    reply_draft: draftBody,
    auto_reply_sent: false,
    draft_id: null,
    draft_body: draftBody,
    gmail_link: messageId ? `https://mail.google.com/mail/u/0/#inbox/${messageId}` : '',
    user_overrode: false,
    user_action: null,
    is_read: false,
    is_trashed: false,
    alert_sent_to_user: true,
    processed_at: date,
    synced_at: date,
    provider: raw.provider ? String(raw.provider) : 'gmail',
  }
}

function normalizeEmailStats(raw: Record<string, unknown>): EmailStats {
  const active = Number(raw.current_active_buffer_cards ?? 0)
  const autoReplies = Number(raw.auto_replies_total ?? 0)
  const systemDropped = Number(raw.system_dropped_total ?? 0)
  const manualAttention = Number(raw.manual_attention_historical_total ?? 0)
  const byCategory = (raw.by_category ?? {}) as Record<string, number | undefined>
  const byPriority = (raw.by_priority ?? {}) as Record<string, number | undefined>

  return {
    activeCards: active,
    autoRepliesTotal: autoReplies,
    systemDroppedTotal: systemDropped,
    manualAttentionTotal: manualAttention,
    automationRate: Number(raw.automation_rate ?? 0),
    lastUpdated: raw.last_updated ? String(raw.last_updated) : undefined,
    autoResolvedToday: Number(raw.auto_resolved_today ?? 0),
    spamBlockedToday: Number(raw.spam_blocked_today ?? 0),
    attentionQueuedToday: Number(raw.attention_queued_today ?? 0),
    autoSendCountToday: Number(raw.auto_send_count_today ?? 0),
    autoAckCountToday: Number(raw.auto_ack_count_today ?? 0),
    inboxCleanedTotal: Number(raw.inbox_cleaned_total ?? 0),
    inboxCleanedToday: Number(raw.inbox_cleaned_today ?? 0),
    total: active,
    unread: active,
    critical_unread: Number(raw.critical_unread ?? 0),
    today_processed: autoReplies + systemDropped,
    by_category: byCategory,
    by_priority: byPriority,
  }
}

// ── Auth ───────────────────────────────────────────────────────────

export function getGmailAuthUrl(): string {
  return `${getEmailAgentBaseUrl()}/auth/google`
}

export async function getAuthMe(): Promise<AuthStatus> {
  try {
    const res = await fetch(`${getEmailAgentBaseUrl()}/auth/me`, fetchOpts)
    if (!res.ok) return { connected: false }
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function getAuthStatus(userEmail?: string): Promise<AuthStatus> {
  const fromCookie = await getAuthMe()
  if (fromCookie.connected) return fromCookie

  if (!userEmail) return { connected: false }

  try {
    const res = await fetch(
      `${getEmailAgentBaseUrl()}/auth/status?email=${encodeURIComponent(userEmail)}`,
      fetchOpts
    )
    if (!res.ok) return { connected: false }
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function revokeGmailAuth(userEmail: string): Promise<void> {
  await fetch(
    `${getEmailAgentBaseUrl()}/auth/revoke?email=${encodeURIComponent(userEmail)}`,
    { method: 'POST', ...fetchOpts }
  )
}

// ── Emails ─────────────────────────────────────────────────────────

export async function fetchAutoRepliedToday(
  userEmail: string
): Promise<{ items: AutoRepliedItem[]; count_today: number }> {
  try {
    const params = new URLSearchParams({ user_email: userEmail })
    const res = await fetch(`${getEmailAgentBaseUrl()}/emails/auto-replied?${params}`, fetchOpts)
    if (!res.ok) return { items: [], count_today: 0 }
    const data = await res.json()
    return {
      items: (data.items ?? []) as AutoRepliedItem[],
      count_today: Number(data.count_today ?? 0),
    }
  } catch {
    return { items: [], count_today: 0 }
  }
}

export async function fetchEmails(
  userEmail: string,
  opts?: {
    page?: number
    page_size?: number
    category?: string
    priority?: string
    refresh?: boolean
  }
): Promise<EmailListResponse> {
  const params = new URLSearchParams({ user_email: userEmail })
  if (opts?.page)      params.set('page', String(opts.page))
  if (opts?.page_size) params.set('page_size', String(opts.page_size))
  if (opts?.category)  params.set('category', opts.category)
  if (opts?.priority)  params.set('priority', opts.priority)
  if (opts?.refresh)   params.set('refresh', 'true')

  const empty: EmailListResponse = {
    emails: [],
    total: 0,
    page: 1,
    page_size: opts?.page_size ?? 25,
    total_pages: 0,
  }

  try {
    const res = await fetch(`${getEmailAgentBaseUrl()}/emails?${params}`, fetchOpts)
    if (res.status === 503) return { ...empty, error: 'database_disconnected' }
    if (!res.ok) return { ...empty, error: 'request_failed' }

    const data = await res.json()
    const rawList: BufferNotification[] = data.notifications ?? data.emails ?? []

    return {
      emails: rawList.map(n => normalizeBufferCard(n as BufferNotification & Record<string, unknown>)),
      total: data.total_active_cards ?? data.total ?? rawList.length,
      page: data.page ?? 1,
      page_size: opts?.page_size ?? 25,
      total_pages: data.total_pages ?? 1,
    }
  } catch {
    return { ...empty, error: 'request_failed' }
  }
}

export async function fetchEmailStats(userEmail: string): Promise<EmailStats | null> {
  try {
    const params = new URLSearchParams({ user_email: userEmail })
    const res = await fetch(`${getEmailAgentBaseUrl()}/emails/stats?${params}`, fetchOpts)
    if (!res.ok) return null
    const raw = await res.json()
    return normalizeEmailStats(raw)
  } catch {
    return null
  }
}

/** Fetch agent overview (7-day rollup) — replaces old syncEmailAgent POST */
export async function fetchAgentOverview(userEmail: string): Promise<EmailStats | null> {
  try {
    const params = new URLSearchParams({ user_email: userEmail })
    const res = await fetch(`${getEmailAgentBaseUrl()}/agents/email?${params}`, fetchOpts)
    if (!res.ok) return null
    const raw = await res.json()
    return normalizeEmailStats(raw)
  } catch {
    return null
  }
}

export async function fetchCleanupSettings(
  userEmail: string
): Promise<CleanupSettings | null> {
  try {
    const params = new URLSearchParams({ user_email: userEmail })
    const res = await fetch(
      `${getEmailAgentBaseUrl()}/agents/email/cleanup-settings?${params}`,
      fetchOpts
    )
    if (!res.ok) return null
    const raw = await res.json()
    return {
      enabled: Boolean(raw.enabled),
      olderThanDays: Number(raw.older_than_days ?? 60),
    }
  } catch {
    return null
  }
}

export async function updateCleanupSettings(
  userEmail: string,
  patch: { enabled?: boolean; olderThanDays?: number }
): Promise<CleanupSettings | null> {
  try {
    const params = new URLSearchParams({ user_email: userEmail })
    const body: Record<string, unknown> = {}
    if (patch.enabled !== undefined) body.enabled = patch.enabled
    if (patch.olderThanDays !== undefined) body.older_than_days = patch.olderThanDays

    const res = await fetch(
      `${getEmailAgentBaseUrl()}/agents/email/cleanup-settings?${params}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...fetchOpts,
      }
    )
    if (!res.ok) return null
    const raw = await res.json()
    return {
      enabled: Boolean(raw.enabled),
      olderThanDays: Number(raw.older_than_days ?? 60),
    }
  } catch {
    return null
  }
}

export async function dismissEmail(userEmail: string, emailId: string): Promise<void> {
  await fetch(
    `${getEmailAgentBaseUrl()}/emails/${emailId}/dismiss?user_email=${encodeURIComponent(userEmail)}`,
    { method: 'POST', ...fetchOpts }
  )
}

export async function markEmailAsRead(userEmail: string, emailId: string): Promise<void> {
  const res = await fetch(
    `${getEmailAgentBaseUrl()}/emails/${emailId}/read?user_email=${encodeURIComponent(userEmail)}`,
    { method: 'POST', ...fetchOpts }
  )
  if (!res.ok) throw new Error('Failed to mark email as read')
}

export async function fetchEmailDetail(
  userEmail: string,
  emailId: string
): Promise<{ body_text: string; body_html: string; has_html: boolean; snippet: string } | null> {
  try {
    const res = await fetch(
      `${getEmailAgentBaseUrl()}/emails/${emailId}?user_email=${encodeURIComponent(userEmail)}`,
      fetchOpts
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      body_text: String(data.body_text ?? data.snippet ?? ''),
      body_html: String(data.body_html ?? ''),
      has_html: Boolean(data.has_html && data.body_html),
      snippet: String(data.snippet ?? ''),
    }
  } catch {
    return null
  }
}

export async function analyzeEmail(
  userEmail: string,
  emailId: string
): Promise<{ summary: string; draft_body: string } | null> {
  try {
    const res = await fetch(
      `${getEmailAgentBaseUrl()}/emails/${emailId}/analyze?user_email=${encodeURIComponent(userEmail)}`,
      { method: 'POST', ...fetchOpts }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      summary: String(data.summary ?? ''),
      draft_body: String(data.draft_body ?? data.suggested_draft ?? ''),
    }
  } catch {
    return null
  }
}

export async function generateDraft(
  userEmail: string,
  emailId: string,
  opts?: { tone?: string; context?: string }
): Promise<DraftResponse> {
  const res = await fetch(`${getEmailAgentBaseUrl()}/emails/${emailId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_email: userEmail,
      tone: opts?.tone ?? 'professional',
      context: opts?.context ?? '',
    }),
    ...fetchOpts,
  })
  if (!res.ok) throw new Error('Draft generation failed')
  const data = await res.json()
  return {
    draft_id: '',
    draft_body: data.new_draft_body ?? '',
    to: '',
    subject: '',
    tone_applied: data.tone_applied,
  }
}

export async function sendReply(
  userEmail: string,
  emailId: string,
  payload: { to: string; subject: string; body: string },
  provider = 'gmail'
): Promise<void> {
  const res = await fetch(`${getEmailAgentBaseUrl()}/emails/${emailId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: userEmail, provider, ...payload }),
    ...fetchOpts,
  })
  if (!res.ok) throw new Error('Send failed')
}

export async function deleteEmail(userEmail: string, emailId: string): Promise<void> {
  const res = await fetch(
    `${getEmailAgentBaseUrl()}/emails/${emailId}?user_email=${encodeURIComponent(userEmail)}`,
    { method: 'DELETE', ...fetchOpts }
  )
  if (!res.ok) throw new Error('Failed to delete email')
}

export async function checkEmailAgentHealth(): Promise<{ database: string } | null> {
  try {
    const res = await fetch(`${getEmailAgentBaseUrl()}/`, fetchOpts)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
