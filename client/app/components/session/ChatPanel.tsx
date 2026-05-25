'use client'
import { useRef, useEffect, useState } from 'react'
import type { Message } from '@/lib/useStream'
import FormattedMessage from '../FormattedMessage'
import SourceChip from './SourceChip'
import { ensureSectionSources, hasInlineSectionCitations } from '@/lib/sectionSources'
import { ArrowDownIcon, Check, Copy } from 'lucide-react'

export default function ChatPanel({ messages, isStreaming, streamingMessageId, onSend, onUpload, uploading, uploadStatus, onFeature, hasDocs, onRemove, model, setModel, onOpenSource, saveWarning, onDismissSaveWarning }: {
  messages: Message[]
  isStreaming: boolean
  streamingMessageId?: string | null
  model: string
  setModel: (m: string) => void
  onSend: (q: string) => void
  onUpload: (f: File) => void
  uploading: boolean
  uploadStatus?: string | null
  hasDocs: string[]
  onFeature: (type: 'guidance' | 'analytics' | 'compare') => void
  onRemove: (name: string) => void
  onOpenSource?: (docName: string, page: number, snippet?: string, sectionContext?: string) => void
  saveWarning?: string | null
  onDismissSaveWarning?: () => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Ref for responsive text sizing
  const [dropDownOpen, setDropDownOpen] = useState(false)

  const AVAILABLE_MODELS = [
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fast - 14.4k Req/day)" },
    { id: "qwen/qwen3-32b", name: "Qwen 3 32B (Smart & High Volume - 14.4k Req/day)" },
    { id: "allam-2-7b", name: "ALLAM 2 7B (Arabic Specialized - 7k Req/day)" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Max Reasoning - 1k Req/day)" },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "State-of-the-Art Mixture of Experts (Massive context extraction & logic)" }

  ];

  // Auto-scroll mechanics when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Claude-style dynamic text area mechanics
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to compute accurate scrollHeight instantly
    textarea.style.height = 'auto';

    // Set height clamped gracefully via native maxHeight bounds (160px ~ 7 lines max)
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  const submit = () => {
    if (!input.trim() || isStreaming) return
    onSend(input.trim())
    setInput('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && !uploading) onUpload(file)
  }

  const openFilePicker = () => {
    if (uploading) return
    if (fileRef.current) fileRef.current.value = ''
    fileRef.current?.click()
  }

  function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <button
        onClick={handleCopy}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="absolute -top-2 -left-13 cursor-pointer flex items-center justify-center p-1.5 rounded-md transition-all duration-200 hover:bg-white/5"
        style={{ color: copied || isHovered ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.3)' }}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full pt-10 pb-2 relative">

      {saveWarning && (
        <div
          className="mx-4 mt-2 px-3 py-2.5 rounded-xl text-xs leading-relaxed flex items-start justify-between gap-3"
          style={{
            background: 'rgba(210,100,100,0.12)',
            border: '1px solid rgba(210,100,100,0.25)',
            color: 'rgba(255,220,220,0.95)',
          }}
        >
          <span>
            <strong className="font-medium">History not saved.</strong>{' '}
            {saveWarning}
            {' '}Chat still works — fix MongoDB Atlas → Network Access → add your current IP (or{' '}
            <code className="text-[10px] opacity-90"></code>
          </span>
          {onDismissSaveWarning && (
            <button
              type="button"
              onClick={onDismissSaveWarning}
              className="shrink-0 text-[10px] opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Message Output Feed Area */}
      <div className="flex-1 overflow-y-auto px-4 py-10 pb-24 space-y-7">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(210,140,160,0.15)', border: '1px solid rgba(210,140,160,0.25)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="rgba(210,140,160,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              How can I help you?
            </p>
            <p className="text-xs text-center max-w-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Ask anything — or attach a PDF to chat with your document
            </p>
          </div>
        )}

        {messages.map(msg => {
          const isUser = msg.role === 'user'
          const isLoading = !isUser && msg.content === ''
          return (
            <div key={msg.id} className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={isUser ? 'max-w-[75%] min-w-0' : isLoading ? 'max-w-fit min-w-0' : 'max-w-[88%] min-w-0 w-full'}>
                <div
                  className={isUser ? 'text-sm leading-relaxed rounded-2xl px-4 py-3' : isLoading ? 'leading-relaxed rounded-2xl px-4 py-3 w-fit' : 'leading-relaxed rounded-2xl px-5 py-4'}
                  style={isUser ? {
                    background: 'rgba(210,140,160,0.15)',
                    color: 'rgba(255,255,255,0.87)',
                    border: '1px solid rgba(210,140,160,0.2)',
                  } : {
                    background: 'rgba(255,255,255,0.025)',
                    color: 'rgba(255,255,255,0.87)',
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {isUser ? (
                    <div className="flex relative items-start gap-2">
                      <CopyButton text={msg.content} />
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  ) : (
                    <FormattedMessage
                      content={msg.content}
                      isLoading={msg.content === ''}
                      isStreaming={isStreaming && msg.id === streamingMessageId && msg.content.length > 0}
                      sources={msg.sources}
                      onOpenSource={onOpenSource}
                      defaultDoc={hasDocs[0]}
                    />
                  )}
                </div>

                {msg.sources &&
                  msg.sources.length > 0 &&
                  !isStreaming &&
                  !hasInlineSectionCitations(
                    ensureSectionSources(msg.content, msg.sources, hasDocs[0]),
                  ) && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="text-[10px] w-full mb-0.5" style={{ color: 'rgba(255,255,255,0.28)' }}>
                        Sources
                      </span>
                      {msg.sources.map((s, i) => (
                        <SourceChip key={`${s.label ?? s.source}-${s.page}-${i}`} source={s} onOpen={onOpenSource} />
                      ))}
                    </div>
                  )}

                {msg.mode === 'general' && (
                  <p className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    Answered from general knowledge — attach a PDF to search your documents
                  </p>
                )}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* PREMIUM CHAT INPUT BAR CONTAINER */}
      <div className="px-4 pb-6 max-w-5xl mx-auto w-full pt-2 sticky bottom-5 z-10 backdrop-blur-sm bg-transparent">
        <div
          className="flex flex-col items-start justify-start relative gap-3 rounded-2xl px-4 py-3 shadow-2xl backdrop-blur-xl transition-all duration-300"
          style={{
            background: 'linear-gradient(135deg, rgba(24, 22, 22, 0.75) 0%, rgba(18, 16, 16, 0.85) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.05)'
          }}
        >

          {/* Active Context Documents Header */}
          {hasDocs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 w-full border-b border-white/[0.04] pb-2.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[rgba(210,140,160,0.9)] px-1">
                Uploaded Docs:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {hasDocs.map((name) => (
                  <div
                    key={name}
                    className="group flex flex-row items-center gap-2 px-2.5 py-1 bg-white/[0.03] border border-white/[0.05] rounded-lg hover:border-rose-400/30 hover:bg-white/[0.05] transition-all duration-200"
                  >
                    <span className="text-[11px] font-medium text-gray-300 max-w-[180px] truncate">
                      {name}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(name)}
                      className="cursor-pointer text-gray-500 hover:text-rose-400 transition-colors duration-150 p-0.5 rounded-md hover:bg-white/5"
                      title="Remove document"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actionable Feature Fast-Triggers */}
          {hasDocs.length > 0 && (
            <div className="flex flex-wrap gap-2 w-full">
              {hasDocs.length === 1 && (
                <>
                  <button
                    onClick={() => onFeature('guidance')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all border border-[rgba(210,140,160,0.4)] bg-[rgba(210,140,160,0.03)] text-[rgba(210,140,160,0.9)] hover:text-rose-400 hover:bg-[rgba(210,140,160,0.08)] hover:border-[rgba(210,140,160,0.6)] cursor-pointer active:scale-98"
                  >
                    <span>🧭</span> Guidance
                  </button>

                  <button
                    onClick={() => onFeature('analytics')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all border border-[rgba(210,140,160,0.4)] bg-[rgba(210,140,160,0.03)] text-[rgba(210,140,160,0.9)] hover:text-rose-400 hover:bg-[rgba(210,140,160,0.08)] hover:border-[rgba(210,140,160,0.6)] cursor-pointer active:scale-98"
                  >
                    <span>📊</span> Analytics
                  </button>
                </>
              )}
              {hasDocs.length >= 2 && (
                <button
                  onClick={() => onFeature('compare')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all border border-[rgba(210,140,160,0.4)] bg-[rgba(210,140,160,0.03)] text-[rgba(210,140,160,0.9)] hover:text-rose-400 hover:bg-[rgba(210,140,160,0.08)] hover:border-[rgba(210,140,160,0.6)] cursor-pointer active:scale-98"
                  >
                  <span>⚖️</span> Compare Corpus
                </button>
              )}
            </div>
          )}

          {/* Bottom Interactive Content Area */}
          <div className="flex w-full items-end relative gap-3">

            {uploadStatus && (
              <p className="text-[8px] text-rose-400/80 px-1">{uploadStatus}</p>
            )}

            {/* File Attachment Action */}
            <div className="flex items-center h-10">
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              <button
                onClick={openFilePicker}
                disabled={uploading}
                className={`cursor-pointer flex-shrink-0 p-2 rounded-xl transition-all duration-200 border bg-white/[0.02] hover:bg-white/[0.06] ${uploading
                    ? 'border-transparent text-[rgba(210,140,160,0.9)]'
                    : 'border-white/[0.05] text-[rgba(210,140,160,0.9)] hover:text-rose-400 hover:border-rose-400/30'
                  }`}
                title="Attach PDF"
              >
                {uploading ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="40" strokeDashoffset="10" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>

            {/* Core Responsive Claude-Style Auto-sizing Textarea */}
            <div className="flex-1 min-w-0 py-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder="Ask anything..."
                rows={1}
                className="w-full resize-none bg-transparent text-[14px] outline-none text-white/90 placeholder-white/30 scrollbar-thin scrollbar-thumb-white/10"
                style={{
                  lineHeight: '1.6',
                  maxHeight: '160px',
                  caretColor: '#f43f5e'
                }}
              />
            </div>

            {/* Model Selector & Submit Buttons Row */}
            <div className="flex items-center gap-2 h-10 flex-shrink-0">

              {/* Dropdown Container */}
              <div className="relative">
                {/* Popover Selection Box */}
                <div
                  className={`absolute right-0 bottom-full mb-2 z-50 w-56 bg-[#181616]/95 border border-white/[0.08] rounded-xl p-1.5 shadow-2xl backdrop-blur-2xl transition-all duration-200 transform origin-bottom-right ${dropDownOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none hidden'
                    }`}
                >
                  <div className="max-h-52 overflow-y-auto scrollbar-none space-y-0.5">
                    {AVAILABLE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setDropDownOpen(false) }}
                        className={`flex flex-col w-full px-3 py-2 rounded-lg text-left transition-all duration-150 cursor-pointer ${model === m.id
                            ? 'bg-rose-500/10 text-rose-300 border-l-2 border-rose-500'
                            : 'text-gray-400 hover:bg-white/[0.04] hover:text-white'
                          }`}
                      >
                        <span className="text-[11px] font-semibold truncate">{m.id}</span>
                        <span className="text-[9px] text-gray-500 opacity-80 truncate">{m.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dropdown Control Button */}
                <button
                  onClick={() => setDropDownOpen(!dropDownOpen)}
                  className="active:scale-95 flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 h-9 text-gray-300 transition-all duration-200 hover:bg-white/[0.06] hover:border-white/[0.12] cursor-pointer"
                >
                  <span className="text-[11px] font-semibold tracking-wide opacity-80 max-w-[90px] truncate">{model}</span>
                  <ArrowDownIcon className={`h-3 w-3 opacity-60 transition-transform duration-200 ${dropDownOpen ? 'rotate-180' : 'rotate-0'}`} />
                </button>
              </div>

              {/* Submit Query Button */}
              <button
                onClick={submit}
                disabled={!input.trim() || isStreaming}
                className={`flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 ${input.trim() && !isStreaming
                    ? 'bg-rose-500/50 text-white shadow-lg shadow-rose-500/20 hover:bg-rose-600'
                    : 'bg-white/[0.02] border border-white/[0.04] text-white/10 cursor-not-allowed'
                  }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

            </div>

          </div>
        </div>
      </div>

    </div>
  )
}