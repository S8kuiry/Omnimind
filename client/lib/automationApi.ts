const BASE = process.env.NEXT_PUBLIC_EMAIL_AGENT_SERVER_URL ?? 'http://localhost:8000'

const fetchOpts: RequestInit = { credentials: 'include' }

// ── Types ──────────────────────────────────────────────────────────

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
}

export interface EmailStats {
  total: number
  unread: number
  critical_unread: number
  today_processed: number
  queued?: number
  by_category: Record<string, number | undefined>
  by_priority: Record<string, number | undefined>
}

export interface EmailListResponse {
  emails: EmailItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface DraftResponse {
  draft_id: string
  draft_body: string
  to: string
  subject: string
}

export interface AuthStatus {
  connected: boolean
  email?: string
  last_sync?: string | null
}

export interface EmailAgentSyncStats {
  monitored_threads: number
  unread_pending: number
  auto_resolved: number
  drafts_created?: number
  spam_blocked?: number
  avg_latency?: number
  automation_rate?: number
}

export interface SyncResult {
  user_email: string
  processed: number
  message: string
}

// ── Auth ───────────────────────────────────────────────────────────

export function getGmailAuthUrl(): string {
  return `${BASE}/auth/google`
}

export async function getAuthStatus(userEmail: string): Promise<AuthStatus> {
  try {
    const res = await fetch(
      `${BASE}/auth/status?email=${encodeURIComponent(userEmail)}`,
      fetchOpts
    )
    if (!res.ok) return { connected: false }
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function revokeGmailAuth(userEmail: string): Promise<void> {
  await fetch(`${BASE}/auth/revoke?email=${encodeURIComponent(userEmail)}`, {
    method: 'POST',
    ...fetchOpts,
  })
}

/** Full inbox sync: Gmail fetch + LLM triage → MongoDB */
export async function triggerInboxSync(userEmail: string): Promise<SyncResult | null> {
  try {
    const res = await fetch(
      `${BASE}/emails/sync?user_email=${encodeURIComponent(userEmail)}`,
      { method: 'POST', ...fetchOpts }
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

/** Combined sync + live Gmail metrics for dashboard cards */
export async function syncEmailAgent(userEmail: string): Promise<EmailAgentSyncStats | null> {
  try {
    const res = await fetch(`${BASE}/agents/email/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: userEmail }),
      ...fetchOpts,
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// ── Emails ─────────────────────────────────────────────────────────

export async function fetchEmails(
  userEmail: string,
  opts?: {
    page?: number
    page_size?: number
    category?: string
    priority?: string
    is_read?: boolean
  }
): Promise<EmailListResponse> {
  const params = new URLSearchParams({ user_email: userEmail })
  if (opts?.page)      params.set('page', String(opts.page))
  if (opts?.page_size) params.set('page_size', String(opts.page_size))
  if (opts?.category)  params.set('category', opts.category)
  if (opts?.priority)  params.set('priority', opts.priority)
  if (opts?.is_read !== undefined) params.set('is_read', String(opts.is_read))

  const res = await fetch(`${BASE}/emails?${params}`, fetchOpts)
  if (!res.ok) return { emails: [], total: 0, page: 1, page_size: 20, total_pages: 0 }
  return res.json()
}

export async function fetchEmailStats(userEmail: string): Promise<EmailStats | null> {
  try {
    const res = await fetch(
      `${BASE}/emails/stats?user_email=${encodeURIComponent(userEmail)}`,
      fetchOpts
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function fetchEmailById(userEmail: string, emailId: string): Promise<EmailItem | null> {
  try {
    const res = await fetch(
      `${BASE}/emails/${emailId}?user_email=${encodeURIComponent(userEmail)}`,
      fetchOpts
    )
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function generateDraft(
  userEmail: string,
  emailId: string,
  opts?: { tone?: string; context?: string }
): Promise<DraftResponse> {
  const res = await fetch(`${BASE}/emails/${emailId}/draft`, {
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
  return res.json()
}

export async function sendReply(
  userEmail: string,
  emailId: string,
  payload: { to: string; subject: string; body: string }
): Promise<void> {
  const res = await fetch(`${BASE}/emails/${emailId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: userEmail, ...payload }),
    ...fetchOpts,
  })
  if (!res.ok) throw new Error('Send failed')
}

export async function overrideDecision(
  userEmail: string,
  emailId: string,
  newAction: string,
  reason?: string
): Promise<void> {
  await fetch(`${BASE}/emails/${emailId}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_email: userEmail,
      new_action: newAction,
      reason: reason ?? '',
    }),
    ...fetchOpts,
  })
}

export const deleteEmail = async (userEmail: string, emailId: string) => {
  const response = await fetch(`/emails/${emailId}?user_email=${encodeURIComponent(userEmail)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete email');
  return response.json();
};
