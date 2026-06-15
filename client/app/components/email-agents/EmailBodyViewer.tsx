'use client'

import { useEffect, useRef, useMemo } from 'react'

const EMAIL_DOC_STYLES = `
  html, body {
    margin: 0;
    padding: 16px;
    background: #ffffff;
    color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  img {
    max-width: 100% !important;
    height: auto !important;
    display: block;
    margin: 8px 0;
    border-radius: 4px;
  }
  a {
    color: rgba(210, 140, 160, 0.95);
    text-decoration: underline;
    word-break: break-word;
  }
  table {
    max-width: 100% !important;
    width: auto !important;
    border-collapse: collapse;
  }
  td, th {
    padding: 4px 6px;
    vertical-align: top;
  }
  div, p, span, li {
    max-width: 100%;
  }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 2px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.55);
  }
  pre, code {
    white-space: pre-wrap;
    font-size: 12px;
  }
  hr {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin: 12px 0;
  }
`

function wrapHtmlDocument(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank" rel="noopener noreferrer"><style>${EMAIL_DOC_STYLES}</style></head><body>${html}</body></html>`
}

function wrapPlainDocument(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  return wrapHtmlDocument(`<div>${escaped}</div>`)
}

interface Props {
  bodyHtml?: string | null
  bodyText: string
  className?: string
}

export default function EmailBodyViewer({ bodyHtml, bodyText, className = '' }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const srcDoc = useMemo(() => {
    const html = bodyHtml?.trim()
    if (html) return wrapHtmlDocument(html)
    if (bodyText.trim()) return wrapPlainDocument(bodyText)
    return wrapHtmlDocument('<p style="color:rgba(255,255,255,0.35)">No body preview available.</p>')
  }, [bodyHtml, bodyText])

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const resize = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc?.body) return
        const height = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0)
        iframe.style.height = `${Math.min(height + 8, 4000)}px`
      } catch {
        iframe.style.height = '240px'
      }
    }

    iframe.addEventListener('load', resize)
    const timer = setTimeout(resize, 150)
    const timer2 = setTimeout(resize, 600)
    return () => {
      iframe.removeEventListener('load', resize)
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [srcDoc])

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: bodyHtml?.trim() ? '#ffffff' : 'rgba(255,255,255,0.04)',
        border: bodyHtml?.trim()
          ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: bodyHtml?.trim() ? '0 4px 24px rgba(0,0,0,0.35)' : undefined,
      }}
    >
      <iframe
        ref={iframeRef}
        title="Email body"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        className={`w-full border-0 min-h-[120px] ${className}`}
        style={{ background: bodyHtml?.trim() ? '#ffffff' : 'transparent' }}
      />
    </div>
  )
}
