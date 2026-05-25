'use client'

import type { ReactElement, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Terminal } from 'lucide-react'
import type { Components } from 'react-markdown'
import SourceChip from '@/app/components/session/SourceChip'
import { citationMapFromSources, normalizeHeading, type SourceRef } from '@/lib/sectionSources'

const BODY_STYLE = {
  color: 'rgba(255,255,255,0.86)',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif',
}

const TEXT = 'rgba(255,255,255,0.84)'
const MUTED = 'rgba(255,255,255,0.78)'
const ACCENT = 'rgba(210,140,160,0.9)'

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode }>
    return nodeText(el.props.children)
  }
  return ''
}

function isEmptyTipBlockquote(children: ReactNode): boolean {
  const text = nodeText(children).replace(/\s+/g, ' ').trim()
  if (!text) return true
  if (/^Tip:?\s*$/i.test(text)) return true
  if (/^Tip:?\*+$/i.test(text)) return true
  return false
}

export function buildMarkdownComponents(
  streamMode: boolean,
  CopyButton: React.ComponentType<{ text: string; size?: 'xs' | 'sm' }>,
  DownloadButton: React.ComponentType<{ text: string; filename: string }>,
  citationByHeading?: Map<string, SourceRef>,
  onOpenSource?: (docName: string, page: number, snippet?: string, sectionContext?: string) => void,
): Components {
  const headingClass = streamMode
    ? 'text-[15px] font-medium tracking-normal mt-5 mb-2'
    : undefined

  const citeForHeading = (children: ReactNode) => {
    if (!citationByHeading?.size) return null
    const title = nodeText(children).trim()
    return citationByHeading.get(normalizeHeading(title)) ?? null
  }

  const headingWithCitation = (
    level: 'h2' | 'h3',
    children: ReactNode,
    className: string | undefined,
    style: React.CSSProperties,
  ) => {
    const cite = citeForHeading(children)
    const Tag = level
    const defaultClass =
      level === 'h2'
        ? 'text-[17px] font-semibold tracking-tight mt-8 mb-3 pb-2 border-b border-[rgba(210,140,160,0.15)]'
        : 'text-[15px] font-semibold mt-5 mb-2'
    const heading = (
      <Tag className={className ?? defaultClass} style={style}>
        {children}
      </Tag>
    )
    if (!cite) return heading
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${
          level === 'h2' ? 'mt-8 mb-3 pb-2 border-b border-[rgba(210,140,160,0.15)]' : 'mt-5 mb-2'
        }`}
      >
        <div className="flex-1 min-w-0">{heading}</div>
        <SourceChip source={cite} onOpen={onOpenSource} compact />
      </div>
    )
  }

  return {
    code({ inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const codeText = String(children).replace(/\n$/, '')

      if (!inline && match) {
        if (streamMode) {
          return (
            <pre
              className="my-3 max-w-full overflow-x-auto rounded-lg px-4 py-3 font-mono text-[13px] leading-relaxed"
              style={{
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.88)',
              }}
            >
              <code>{codeText}</code>
            </pre>
          )
        }
        return (
          <div
            className="my-4 max-w-full rounded-xl overflow-x-auto"
            style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.4)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <div className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>
                <Terminal size={11} />
                <span className="uppercase tracking-widest font-mono">{match[1]}</span>
              </div>
              <div className="flex items-center gap-3">
                <CopyButton text={codeText} size="xs" />
                <DownloadButton text={codeText} filename={`code.${match[1]}`} />
              </div>
            </div>
            <SyntaxHighlighter
              style={atomDark}
              language={match[1]}
              PreTag="div"
              customStyle={{
                margin: 0,
                background: 'transparent',
                padding: '1rem',
                fontSize: '0.79rem',
                lineHeight: '1.65',
              }}
              {...props}
            >
              {codeText}
            </SyntaxHighlighter>
          </div>
        )
      }

      return (
        <code
          className="rounded-md px-[6px] py-[2px] font-mono break-words [overflow-wrap:anywhere]"
          style={{
            background: 'rgba(210,140,160,0.10)',
            color: 'rgba(235,200,210,0.95)',
            fontSize: '0.86em',
            border: '1px solid rgba(210,140,160,0.14)',
          }}
          {...props}
        >
          {children}
        </code>
      )
    },

    h1: ({ children }) => (
      <h1
        className={
          headingClass ??
          'text-[20px] font-semibold tracking-tight mt-7 mb-3 pb-2 border-b border-white/10'
        }
        style={{ color: 'rgba(255,255,255,0.96)' }}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) =>
      headingWithCitation(
        'h2',
        children,
        headingClass ?? 'text-[17px] font-semibold tracking-tight',
        { color: 'rgba(255,255,255,0.94)' },
      ),
    h3: ({ children }) =>
      headingWithCitation(
        'h3',
        children,
        headingClass ?? 'text-[15px] font-semibold',
        { color: streamMode ? TEXT : 'rgba(232,182,196,0.95)' },
      ),
    h4: ({ children }) => (
      <h4
        className={headingClass ?? 'text-[13px] font-semibold mt-4 mb-1.5'}
        style={{ color: MUTED }}
      >
        {children}
      </h4>
    ),

    p: ({ children }) => (
      <p className="mb-4" style={{ color: TEXT, lineHeight: '1.7', fontWeight: 400 }}>
        {children}
      </p>
    ),

    ul: ({ children }) => (
      <ul className="mb-4 mt-1 space-y-2 pl-5 list-disc marker:text-[rgba(210,140,160,0.75)]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-4 mt-1 space-y-2 pl-5 list-decimal marker:text-[rgba(210,140,160,0.85)] marker:font-medium">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed pl-1" style={{ color: MUTED, fontWeight: 400 }}>
        {children}
      </li>
    ),

    blockquote: ({ children }) => {
      if (isEmptyTipBlockquote(children)) return null
      return (
        <blockquote
          className="my-3 pl-4 py-2.5 pr-4 rounded-lg text-[13px]"
          style={{
            borderLeft: '2px solid rgba(210,140,160,0.55)',
            background: 'rgba(210,140,160,0.08)',
            color: 'rgba(255,255,255,0.8)',
          }}
        >
          {children}
        </blockquote>
      )
    },

    hr: () => <hr className="my-6 border-0 border-t border-white/[0.07]" />,

    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
        style={{ color: ACCENT }}
      >
        {children}
      </a>
    ),

    strong: ({ children }) => (
      <strong
        className={streamMode ? 'font-medium' : 'font-semibold'}
        style={{ color: 'rgba(255,255,255,0.95)', fontWeight: streamMode ? 500 : 600 }}
      >
        {children}
      </strong>
    ),
    em: ({ children }) => (
      <em style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>{children}</em>
    ),

    table: ({ children }) => (
      <div
        className="omni-table my-6 overflow-hidden rounded-2xl"
        style={{
          border: '1px solid rgba(255,255,255,0.09)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.25) 100%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] border-collapse min-w-[320px]">
            {children}
          </table>
        </div>
      </div>
    ),
    thead: ({ children }) => (
      <thead
        style={{
          background: 'rgba(210,140,160,0.12)',
          borderBottom: '1px solid rgba(210,140,160,0.2)',
        }}
      >
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th
        className="px-4 py-3.5 text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap"
        style={{ color: 'rgba(232,200,210,0.95)' }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td
        className="px-4 py-3.5 align-top text-[13px] leading-relaxed"
        style={{
          color: MUTED,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          fontWeight: 400,
        }}
      >
        {children}
      </td>
    ),
    tr: ({ children }) => (
      <tr className="transition-colors hover:bg-white/[0.03] even:bg-white/[0.02]">
        {children}
      </tr>
    ),
  }
}

export default function MarkdownBody({
  markdown,
  streamMode = false,
  showCaret = false,
  CopyButton,
  DownloadButton,
  sources,
  onOpenSource,
}: {
  markdown: string
  streamMode?: boolean
  showCaret?: boolean
  CopyButton: React.ComponentType<{ text: string; size?: 'xs' | 'sm' }>
  DownloadButton: React.ComponentType<{ text: string; filename: string }>
  sources?: SourceRef[]
  onOpenSource?: (docName: string, page: number, snippet?: string, sectionContext?: string) => void
}) {
  const citationByHeading = streamMode ? undefined : citationMapFromSources(sources)

  const components = buildMarkdownComponents(
    streamMode,
    CopyButton,
    DownloadButton,
    citationByHeading,
    onOpenSource,
  )

  return (
    <div
      className="min-w-0 max-w-full text-[15px] leading-[1.7] break-words [overflow-wrap:anywhere] [&_li>p]:mb-1 [&_li>p:last-child]:mb-0 [&_li_ul]:mt-1.5 [&_li_ol]:mt-1.5 [&>*:first-child]:mt-0 [&_pre]:max-w-full [&_table_td:first-child]:font-medium [&_table_td:first-child]:text-white/90 [&_h2+ul]:mt-2 [&_h3+ul]:mt-1.5 [&_blockquote]:my-4"
      style={BODY_STYLE}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
      {showCaret && (
        <span
          className="inline-block w-[2px] h-[1em] align-text-bottom ml-0.5 rounded-sm"
          style={{
            background: 'rgba(210,140,160,0.55)',
            animation: 'omni-caret 1s ease-in-out infinite',
          }}
        />
      )}
      {showCaret && (
        <style>{`
          @keyframes omni-caret {
            0%, 45% { opacity: 1; }
            50%, 100% { opacity: 0.25; }
          }
        `}</style>
      )}
    </div>
  )
}
