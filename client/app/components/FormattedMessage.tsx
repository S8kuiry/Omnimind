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
  let s = raw

  // Strip stray source tags that the prompt sometimes leaks
  s = s.replace(/\[Source:[^\]]*\]/gi, '')

  // Literal "\n" string → real newline (some models emit escaped newlines)
  s = s.replace(/\\n/g, '\n')

  // ── Heading sanitation ─────────────────────────────────────────────
  // "##Heading" → "## Heading"
  s = s.replace(/^(#{1,6})([^\s#])/gm, '$1 $2')

  // "**Heading**===" setext → "## Heading"
  s = s.replace(/\*\*(.+?)\*\*\s*={3,}/g, '\n## $1\n')

  // ── Bold marker repair ─────────────────────────────────────────────
  // Models very often emit "**Label:**Value" with no space after the
  // closing bold marker. Add the space so the value is readable.
  s = s.replace(/(\*\*[^*\n]+?:\*\*)(?=\S)/g, '$1 ')

  // ── List sanitation ────────────────────────────────────────────────
  // "1. foo2. bar" → split each enumerated item onto its own line
  s = s.replace(/(\d+\.\s+[^\n]*?)(?=\s\d+\.\s)/g, '$1\n')

  // "* foo* bar" → split bullet items
  s = s.replace(/([^\s\n*])\s\*\s(?=\S)/g, '$1\n* ')

  // Bullet at line start missing space: "*foo" → "* foo"
  s = s.replace(/^(\s*)\*(?=\S)/gm, '$1* ')

  // Hyphen bullet at line start missing space: "-foo" → "- foo"
  s = s.replace(/^(\s*)-(?=[A-Za-z])/gm, '$1- ')

  // ── Code fence safety ──────────────────────────────────────────────
  // Ensure ``` starts on its own line and ends on its own line
  s = s.replace(/([^\n])(```)/g, '$1\n$2')
  s = s.replace(/(```\w*)([^\n])/g, '$1\n$2')

  // ── Section / paragraph breathing room ─────────────────────────────
  // Bold inline label following a sentence → push it to its own block
  s = s.replace(/([.!?])\s*(\*\*[A-Z][^*\n]{0,80}:\*\*)/g, '$1\n\n$2')

  // Sentence flowing directly into a numbered item: "...overview.1. Foo"
  s = s.replace(/([.!?])(\d+\.\s)/g, '$1\n\n$2')

  // Sentence flowing directly into a bullet
  s = s.replace(/([.!?])\s*([-*])\s/g, '$1\n\n$2 ')

  // Heading immediately followed by body on the same line:
  // "## Heading Body text..." is fine; but "## HeadingBody text" → split
  // (only applies when no space between heading text and capital letter)
  // Conservative: leave alone unless we detect "**Title**Body"
  s = s.replace(/(\*\*[^*\n]+\*\*)([A-Z])/g, '$1\n\n$2')

  // ── Whitespace normalisation ───────────────────────────────────────
  // Section dividers like "---" / "===" on their own line
  s = s.replace(/^\s*[-=]{3,}\s*$/gm, '\n---\n')

  // Ensure first list item has a blank line before it
  s = s.replace(/([^\n])\n([-*]\s)/g, '$1\n\n$2')
  s = s.replace(/([^\n])\n(\d+\.\s)/g, '$1\n\n$2')

  // Collapse 3+ newlines → 2
  s = s.replace(/\n{3,}/g, '\n\n')

  // Trim trailing whitespace on each line (avoids stray <br>)
  s = s.replace(/[ \t]+$/gm, '')

  return s.trim()
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
  // Rendered at the bottom of the assistant message, Claude/ChatGPT style.
  return (
    <div
      className="flex items-center gap-4 mb-4 pb-3"
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
    <div
      className="text-[15px] leading-[1.7] [&_li>p]:mb-0 [&_li>p]:inline [&_li_ul]:mt-1.5 [&_li_ol]:mt-1.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      style={{
        color: 'rgba(255,255,255,0.86)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif',
      }}
    >
       {/* Copy + download bar at the bottom, like Claude / ChatGPT */}
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

            // inline code — calmer, monospace, subtle pink tint
            return (
              <code
                className="rounded-md px-[6px] py-[2px] font-mono"
                style={{
                  background: 'rgba(210,140,160,0.10)',
                  color: 'rgba(235,200,210,0.95)',
                  fontSize: '0.86em',
                  border: '1px solid rgba(210,140,160,0.14)',
                  whiteSpace: 'nowrap',
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
              className="text-[20px] font-semibold tracking-tight mt-7 mb-3 pb-2"
              style={{
                color: 'rgba(255,255,255,0.96)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                letterSpacing: '-0.01em',
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              className="text-[17px] font-semibold tracking-tight mt-6 mb-2.5"
              style={{
                color: 'rgba(255,255,255,0.94)',
                letterSpacing: '-0.01em',
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              className="text-[15px] font-semibold mt-5 mb-2"
              style={{ color: 'rgba(232,182,196,0.95)' }}
            >
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4
              className="text-[13px] font-semibold mt-4 mb-1.5"
              style={{ color: 'rgba(255,255,255,0.78)' }}
            >
              {children}
            </h4>
          ),

          // ── Paragraphs ────────────────────────────────────────────────
          p: ({ children }) => (
            <p
              className="mb-4"
              style={{ color: 'rgba(255,255,255,0.84)', lineHeight: '1.7' }}
            >
              {children}
            </p>
          ),

          // ── Lists ─────────────────────────────────────────────────────
          // Use semantic list markers + custom marker styling so ordered
          // and unordered lists are visually distinct (Claude-style).
          ul: ({ children }) => (
            <ul
              className="mb-3 mt-1 space-y-1.5 pl-5 list-disc marker:text-[rgba(210,140,160,0.7)]"
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className="mb-3 mt-1 space-y-1.5 pl-5 list-decimal marker:text-[rgba(210,140,160,0.85)] marker:font-medium"
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li
              className="leading-relaxed pl-1"
              style={{ color: 'rgba(255,255,255,0.82)' }}
            >
              {children}
            </li>
          ),

          // ── Blockquote ────────────────────────────────────────────────
          blockquote: ({ children }) => (
            <blockquote
              className="my-4 pl-4 py-1"
              style={{
                borderLeft: '2px solid rgba(210,140,160,0.5)',
                color: 'rgba(255,255,255,0.65)',
                fontStyle: 'italic',
              }}
            >
              {children}
            </blockquote>
          ),

          // ── HR ────────────────────────────────────────────────────────
          hr: () => (
            <hr
              className="my-6"
              style={{
                border: 'none',
                borderTop: '1px solid rgba(255,255,255,0.07)',
              }}
            />
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
            <strong
              className="font-semibold"
              style={{ color: 'rgba(255,255,255,0.97)' }}
            >
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>
              {children}
            </em>
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