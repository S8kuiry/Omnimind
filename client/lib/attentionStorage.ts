/**
 * attentionStorage.ts — localStorage persistence for the attention queue
 */

import type { EmailItem } from './automationApi'

const MAX_CARDS = 25

function storageKey(userEmail: string): string {
  return `attention_queue:${userEmail}`
}

export function loadQueue(userEmail: string): EmailItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(storageKey(userEmail))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveQueue(userEmail: string, cards: EmailItem[]): void {
  if (typeof window === 'undefined') return
  try {
    const capped = cards.slice(0, MAX_CARDS)
    localStorage.setItem(storageKey(userEmail), JSON.stringify(capped))
  } catch {
    // localStorage full or unavailable
  }
}

export function addCard(userEmail: string, card: EmailItem): void {
  const current = loadQueue(userEmail)
  if (current.some(c => c._id === card._id)) return
  saveQueue(userEmail, [card, ...current])
}

export function removeCard(userEmail: string, emailId: string): void {
  const current = loadQueue(userEmail)
  saveQueue(
    userEmail,
    current.filter(c => c._id !== emailId && c.gmail_message_id !== emailId)
  )
}

export function clearQueue(userEmail: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(userEmail))
  } catch {
    // ignore
  }
}
