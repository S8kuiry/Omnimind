/** Decode HTML entities in Gmail snippets/subjects for display. */
export function decodeEmailText(text: string): string {
  if (!text) return ''
  if (typeof document === 'undefined') {
    return text
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
  }
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

function normalizeEmailAddress(addr: string): string {
  const s = (addr || '').trim()
  const match = s.match(/<([^>]+)>/)
  return (match ? match[1] : s).trim().toLowerCase()
}

export function isEmailFromUser(email: { from_address?: string }, userEmail?: string): boolean {
  const from = normalizeEmailAddress(email.from_address || '')
  const user = normalizeEmailAddress(userEmail || '')
  return Boolean(from && user && from === user)
}
