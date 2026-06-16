import { normalizeDocName } from './docName'

/** Backend base URL — must be set on Vercel at build time (`NEXT_PUBLIC_*`). */
export function getApiBase(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8001'
}

const API = getApiBase()

type UploadResult = {
  doc_name: string
  pages_processed?: number
  chunks_stored?: number
  message?: string
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued…',
  parsing: 'Reading PDF…',
  embedding: 'Indexing text…',
  storing: 'Saving to search…',
}

async function waitForUploadJob(
  jobId: string,
  onStatus?: (label: string) => void,
): Promise<UploadResult> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/upload/status/${jobId}`)
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    if (data.status !== 'ready' && data.status !== 'error') {
      onStatus?.(STATUS_LABELS[data.status] ?? 'Indexing…')
    }
    if (data.status === 'ready') return data
    if (data.status === 'error') throw new Error(data.error || 'Upload failed')
    await new Promise(r => setTimeout(r, 350))
  }
  throw new Error('Upload timed out — try again or use a smaller PDF')
}

export async function uploadPDF(
  file: File,
  userId: string,
  chatId: string,
  onStatus?: (label: string) => void,
) {
  const form = new FormData()
  form.append('file', file)
  form.append('user_id', userId)
  form.append('chat_id', chatId)

  const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()

  if (data.status === 'processing' && data.job_id) {
    return waitForUploadJob(data.job_id, onStatus)
  }
  return data as UploadResult
}

export async function getDocuments(userId: string) {
  const res = await fetch(`${API}/documents?user_id=${userId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<{ documents: any[] }>
}

export async function deleteDocument(docName: string, userId: string, chatId: string) {
  const res = await fetch(`${API}/document/${docName}?user_id=${userId}&chat_id=${chatId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getGuidance(docName: string, userId: string, chatId: string) {
  const res = await fetch(`${API}/guidance/${docName}?user_id=${userId}&chat_id=${chatId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAnalytics(docName: string, userId: string, chatId: string) {
  const res = await fetch(`${API}/analytics/${docName}?user_id=${userId}&chat_id=${chatId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function compareDocuments(
  question: string,
  userId: string,
  chatId: string,
  docA: string,
  docB: string,
) {
  const res = await fetch(`${API}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      user_id: userId,
      chat_id: chatId,
      doc_a: docA,
      doc_b: docB,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function streamQuery(
  question: string,
  userId: string,
  chatId: string,
  history: { role: string; content: string }[] = [],
  model?: string,
  documentNames: string[] = [],
): Promise<Response> {
  return fetch(`${API}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      user_id: userId,
      chat_id: chatId,
      history,
      model,
      has_documents: documentNames.length > 0,
      document_names: documentNames,
    }),
  })
}

export async function fetchDocumentPage(
  docName: string,
  page: number,
  userId: string,
  chatId: string,
  snippet?: string,
) {
  const resolved = normalizeDocName(docName)
  const params = new URLSearchParams({ user_id: userId, chat_id: chatId })
  if (snippet) {
    // Keep URL short — long snippets can break proxies; backend only echoes this for UI
    params.set('highlight', snippet.slice(0, 500))
  }
  const res = await fetch(
    `${API}/document/${encodeURIComponent(resolved)}/page/${page}?${params}`,
  )
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`${res.status}: ${detail || res.statusText}`)
  }
  return res.json() as Promise<{ doc_name: string; page: number; text: string; highlight: string }>
}

export async function fetchDocumentFull(
  docName: string,
  userId: string,
  chatId: string,
) {
  const resolved = normalizeDocName(docName)
  const params = new URLSearchParams({ user_id: userId, chat_id: chatId })
  const res = await fetch(
    `${API}/document/${encodeURIComponent(resolved)}/full?${params}`,
  )
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`${res.status}: ${detail || res.statusText}`)
  }
  return res.json() as Promise<{
    doc_name: string
    pages: { page: number; text: string }[]
    text: string
    page_count: number
  }>
}
