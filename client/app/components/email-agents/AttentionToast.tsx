'use client'

/**
 * AttentionToast.tsx — popup notification on WS new_email event
 *
 * Shows a 5s toast in the top-right corner when a new email lands
 * in the attention queue. Auto-dismisses. Has a "View" button that
 * calls onView(card) so the parent can open EmailDetail.
 *
 * Usage:
 *   const { showToast, ToastContainer } = useAttentionToast()
 *   // in WS handler:
 *   showToast(card, () => setSelected(card))
 *   // in JSX:
 *   <ToastContainer />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, X } from 'lucide-react'
import type { EmailItem } from '@/lib/automationApi'

interface ToastEntry {
  id: string
  card: EmailItem
  onView: () => void
}

const TOAST_DURATION_MS = 5000

export function useAttentionToast() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    (card: EmailItem, onView: () => void) => {
      const id = `toast-${card._id}-${Date.now()}`
      setToasts(prev => {
        // Cap at 3 toasts — drop oldest if full
        const next = [{ id, card, onView }, ...prev].slice(0, 3)
        return next
      })
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach(t => clearTimeout(t))
    }
  }, [])

  const ToastContainer = useCallback(
    () => (
      <div
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(toast => (
          <AttentionToast
            key={toast.id}
            card={toast.card}
            onView={() => {
              dismiss(toast.id)
              toast.onView()
            }}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    ),
    [toasts, dismiss]
  )

  return { showToast, ToastContainer }
}

// ── Single toast card ──────────────────────────────────────────────

function AttentionToast({
  card,
  onView,
  onDismiss,
}: {
  card: EmailItem
  onView: () => void
  onDismiss: () => void
}) {
  const priorityColor =
    card.priority === 'high'
      ? 'rgba(255,100,100,0.85)'
      : card.priority === 'medium'
      ? 'rgba(255,190,80,0.85)'
      : 'rgba(210,140,160,0.85)'

  return (
    <div
      style={{
        pointerEvents: 'all',
        background: 'rgba(10,6,14,0.96)',
        border: '1px solid rgba(210,140,160,0.25)',
        borderRadius: '12px',
        padding: '12px 14px',
        width: '320px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        animation: 'slideInRight 0.2s ease-out',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0 }}>
          <Mail size={12} style={{ color: 'rgba(210,140,160,0.75)', flexShrink: 0 }} />
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.85)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.subject || '(no subject)'}
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'rgba(255,255,255,0.25)',
            flexShrink: 0,
          }}
        >
          <X size={11} />
        </button>
      </div>

      {/* Sender + priority */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.38)' }}>
          {card.from_name || card.from_address}
        </span>
        <span
          style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            color: priorityColor,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {card.priority}
        </span>
      </div>

      {/* Snippet */}
      {card.snippet && (
        <p
          style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.3)',
            margin: 0,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            lineHeight: 1.5,
          }}
        >
          {card.snippet}
        </p>
      )}

      {/* View button */}
      <button
        onClick={onView}
        style={{
          background: 'rgba(210,140,160,0.08)',
          border: '1px solid rgba(210,140,160,0.2)',
          borderRadius: '7px',
          color: 'rgba(210,140,160,0.85)',
          fontSize: '10px',
          fontFamily: 'monospace',
          padding: '5px 10px',
          cursor: 'pointer',
          alignSelf: 'flex-start',
          letterSpacing: '0.05em',
        }}
      >
        View →
      </button>
    </div>
  )
}

// Inject keyframe once
if (typeof document !== 'undefined') {
  const styleId = 'attention-toast-styles'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(20px); }
        to   { opacity: 1; transform: translateX(0);    }
      }
    `
    document.head.appendChild(style)
  }
}