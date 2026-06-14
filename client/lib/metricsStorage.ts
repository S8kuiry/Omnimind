/**
 * metricsStorage.ts — localStorage cache for the stat bar
 */

import type { EmailStats } from './automationApi'

function storageKey(userEmail: string): string {
  return `email_metrics:${userEmail}`
}

export function loadMetrics(userEmail: string): EmailStats | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(userEmail))
    if (!raw) return null
    return JSON.parse(raw) as EmailStats
  } catch {
    return null
  }
}

export function saveMetrics(userEmail: string, stats: EmailStats): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      storageKey(userEmail),
      JSON.stringify({ ...stats, lastUpdated: new Date().toISOString() })
    )
  } catch {
    // localStorage full
  }
}

export function clearMetrics(userEmail: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(userEmail))
  } catch {
    // ignore
  }
}
