'use client'

import { useMemo } from 'react'
import { Copy, Check, Download } from 'lucide-react'
import { useState } from 'react'
import { normalizeMarkdown } from '@/lib/markdownNormalize'
import { ensureSectionSources, type SourceRef } from '@/lib/sectionSources'
import MarkdownBody from './MarkdownBody'

// ─── Thinking dots ────────────────────────────────────────────────────────────

export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1 h-1 rounded-full"
          style={{
            background: 'rgba(210,140,160,0.6)',
            animation: 'omni-pulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.22}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes omni-pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  )
}

function CopyButton({ text, size = 'sm' }: { text: string; size?: 'xs' | 'sm' }) {
  const [copied, setCopied] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const color =
    copied || isHovered ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)'

  return (
    <button
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer flex items-center gap-1 transition-colors duration-200"
      style={{ color, fontSize: size === 'xs' ? '10px' : '11px' }}
      title="Copy"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const [isHovered, setIsHovered] = useState(false)

  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer flex items-center gap-1 transition-colors duration-200"
      style={{
        color: isHovered ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)',
        fontSize: '11px',
      }}
      title="Download"
    >
      <Download size={11} />
      <span>Save</span>
    </button>
  )
}

function MessageActions({ content }: { content: string }) {
  return (
    <div
      className="flex items-center gap-4 mt-5 pt-3"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <CopyButton text={content} size="xs" />
      <DownloadButton text={content} filename="omnimind-response.md" />
    </div>
  )
}

export default function FormattedMessage({
  content,
  isLoading = false,
  isStreaming = false,
  sources,
  onOpenSource,
  defaultDoc,
}: {
  content: string
  isLoading?: boolean
  isStreaming?: boolean
  sources?: SourceRef[]
  onOpenSource?: (docName: string, page: number, snippet?: string, sectionContext?: string) => void
  /** Attached PDF name — used to synthesize per-section citations when metadata has none */
  defaultDoc?: string
}) {
  const normalized = useMemo(
    () => normalizeMarkdown(content, { forStream: isStreaming }),
    [content, isStreaming]
  )

  const displaySources = useMemo(
    () => ensureSectionSources(normalized, sources, defaultDoc),
    [normalized, sources, defaultDoc],
  )

  if (isLoading) return <ThinkingDots />

  return (
    <>
      <MarkdownBody
        markdown={normalized}
        streamMode={isStreaming}
        showCaret={isStreaming && content.length > 0}
        CopyButton={CopyButton}
        DownloadButton={DownloadButton}
        sources={displaySources}
        onOpenSource={onOpenSource}
      />
      {!isStreaming && content.length > 0 && (
        <MessageActions content={normalized} />
      )}
    </>
  )
}
