'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, Terminal, Download } from 'lucide-react'
import { useState } from 'react'

// ─── Normalize streamed markdown ──────────────────────────────────────────────
// Handles models that return literal \n instead of newlines,
// jammed lists, missing spacing — makes output Claude-quality regardless

function normalizeMarkdown(raw: string): string {
  return (
    raw
      // literal \n string → real newline
     .replace(/\[Source:[^\]]*\]/gi, '')   // ✅ first line — nuclear option
      .replace(/\\n/g, '\n')


      // "**Heading**===" setext → ## heading
      .replace(/\*\*(.+?)\*\*\s*={3,}/g, '\n## $1\n')

      // Numbered list items jammed: "1. foo2. bar" → split
      .replace(/(\d+\.\s.+?)(?=\d+\.)/g, '$1\n')

      // Bullet items jammed: "* foo* bar" → split
      .replace(/([^\n])\*\s/g, '$1\n* ')

      // Ensure ``` starts on its own line
      .replace(/([^\n])(```)/g, '$1\n$2')

      // Bold section headers mid-line → give breathing room
      .replace(/([^\n])\n?(\*\*[A-Z][^*]+:\*\*)/g, '$1\n\n$2')

      // Section dividers like "---" or "===" that aren't markdown
      .replace(/^[-=]{3,}$/gm, '\n---\n')

      // Collapse 3+ newlines → 2
      .replace(/\n{3,}/g, '\n\n')

      // Ensure list items have a blank line before the first one
      .replace(/([^\n])\n([-*]\s)/g, '$1\n\n$2')
      .replace(/([^\n])\n(\d+\.\s)/g, '$1\n\n$2')

      .trim()
  )
}

// ─── Thinking dots (Claude-style) ────────────────────────────────────────────

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

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, size = 'sm' }: { text: string; size?: 'xs' | 'sm' }) {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Logic to determine the active color
  // Priority: 1. Copied state (Active) -> 2. Hovered state -> 3. Default state
  const getButtonColor = () => {
    if (copied) return 'rgba(210,140,160,0.9)';
    if (isHovered) return 'rgba(210,140,160,0.9)'; // Your hover color
    return 'rgba(255,255,255,0.3)'; // Default muted color
  };

  return (
    <button
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer flex items-center gap-1 transition-colors duration-200"
      style={{
        color: getButtonColor(),
        fontSize: size === 'xs' ? '10px' : '11px',
      }}
      title="Copy"
    >
      {/* Dynamic Icon */}
      {copied ? <Check size={11} /> : <Copy size={11} />}
      
      {/* Dynamic Text */}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

// ─── Download button ──────────────────────────────────────────────────────────

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const [isHovered, setIsHovered] = useState(false);

  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleDownload}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="cursor-pointer flex items-center gap-1 transition-colors duration-200"
      style={{ 
        // Changes from muted white to your pinkish-red on hover
        color: isHovered ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)', 
        fontSize: '11px' 
      }}
      title="Download"
    >
      <Download size={11} />
      <span>Save</span>
    </button>
  );
}

// ─── Full message copy + download bar ────────────────────────────────────────

function MessageActions({ content }: { content: string }) {
  return (
    <div
      className="flex items-center gap-3 mt-3 pb-2 mb-2"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <CopyButton text={content} size="xs" />
      <DownloadButton text={content} filename="omnimind-response.md" />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FormattedMessage({
  content,
  isLoading = false,
}: {
  content: string
  isLoading?: boolean
}) {
  if (isLoading) return <ThinkingDots />

  const normalized = normalizeMarkdown(content)

  return (
    <div className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>
      {/* Copy + download the full message */}
      {content.length > 0 && <MessageActions content={content} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{

          // ── Code blocks ──────────────────────────────────────────────
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const codeText = String(children).replace(/\n$/, '')

            if (!inline && match) {
              return (
                <div
                  className="my-4 rounded-xl overflow-hidden"
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.4)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  }}
                >
                  {/* toolbar */}
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

            // inline code
            return (
              <code
                className="rounded px-1.5 py-0.5 font-mono"
                style={{
                  background: 'rgba(210,140,160,0.12)',
                  color: 'rgba(251,146,60,0.95)',
                  fontSize: '0.82em',
                  border: '1px solid rgba(210,140,160,0.15)',
                }}
                {...props}
              >
                {children}
              </code>
            )
          },

          // ── Headings ─────────────────────────────────────────────────
          h1: ({ children }) => (
            <h1
              className="text-xl font-bold mt-6 mb-3 pb-2"
              style={{
                color: 'rgba(255,255,255,0.95)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-base font-semibold mt-5 mb-2"
              style={{ color: 'rgba(255,255,255,0.9)' }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-sm font-semibold mt-4 mb-1.5"
              style={{ color: 'rgba(210,140,160,0.95)' }}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className="text-xs font-semibold mt-3 mb-1 uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              {children}
            </h4>
          ),

          // ── Paragraphs ────────────────────────────────────────────────
          p: ({ children }) => (
            <p className="mb-3" style={{ color: 'rgba(255,255,255,0.82)', lineHeight: '1.75' }}>
              {children}
            </p>
          ),

          // ── Lists ─────────────────────────────────────────────────────
          ul: ({ children }) => (
            <ul className="mb-3 space-y-1.5 pl-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 space-y-1.5 pl-0 list-decimal list-inside">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="flex gap-2.5 items-start" style={{ color: 'rgba(255,255,255,0.8)' }}>
              <span
                className="mt-[7px] shrink-0 rounded-full"
                style={{
                  width: '5px',
                  height: '5px',
                  background: 'rgba(210,140,160,0.7)',
                }}
              />
              <span className="flex-1">{children}</span>
            </li>
          ),

          // ── Blockquote ────────────────────────────────────────────────
          blockquote: ({ children }) => (
            <blockquote
              className="my-3 pl-4 italic"
              style={{
                borderLeft: '2px solid rgba(210,140,160,0.4)',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              {children}
            </blockquote>
          ),

          // ── HR ────────────────────────────────────────────────────────
          hr: () => (
            <hr className="my-5" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />
          ),

          // ── Links ─────────────────────────────────────────────────────
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 transition-colors"
              style={{ color: 'rgba(210,140,160,0.9)' }}
            >
              {children}
            </a>
          ),

          // ── Strong / Em ───────────────────────────────────────────────
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: 'rgba(255,255,255,0.95)' }}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em style={{ color: 'rgba(255,255,255,0.65)' }}>{children}</em>
          ),

          // ── Tables ────────────────────────────────────────────────────
          table: ({ children }) => (
            <div
              className="overflow-x-auto my-4 rounded-xl"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <table className="w-full text-left text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="px-4 py-2.5 text-xs uppercase tracking-wider font-semibold"
              style={{
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.45)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-4 py-2.5"
              style={{
                color: 'rgba(255,255,255,0.75)',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr style={{ transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {children}
            </tr>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>

      
    </div>
  )
}