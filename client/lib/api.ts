const API = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8000'

export async function uploadPDF(file: File, userId: string, chatId: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('user_id', userId)
  form.append('chat_id', chatId)
  console.log('sending:', userId, chatId)  // 👈 add this

  const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// export async function queryDoc(question: string, userId: string, chatId: string) {
//   const res = await fetch(`${API}/query`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ question, user_id: userId, chat_id: chatId })
//   })
//   if (!res.ok) throw new Error(await res.text())
//   return res.json() as Promise<{ answer: string; sources: {source:string;page:number}[]; mode: string }>
// }

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


export async function getGuidance(docName: string, userId: string) {
  const res = await fetch(`${API}/guidance/${docName}?user_id=${userId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getAnalytics(docName: string, userId: string) {
  const res = await fetch(`${API}/analytics/${docName}?user_id=${userId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function compareDocuments(question: string, userId: string, docA: string, docB: string) {
  const res = await fetch(`${API}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, user_id: userId, doc_a: docA, doc_b: docB })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// stream returns a ReadableStream — consumed by useStream hook
export function streamQuery(question: string, userId: string, chatId: string): Promise<Response> {
  return fetch(`${API}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, user_id: userId, chat_id: chatId })
  })
}