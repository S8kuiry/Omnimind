'use client'
import { useRef, useEffect, useState } from 'react'
import type { Message } from '@/lib/useStream'
import FormattedMessage from '../FormattedMessage'
import { ArrowDown01Icon, ArrowDownIcon, Check, Copy } from 'lucide-react'

export default function ChatPanel({ messages, isStreaming, onSend, onUpload, uploading, onFeature, hasDocs, onRemove, model, setModel }: {
  messages: Message[]
  isStreaming: boolean
  model: string
  setModel: (m: string) => void
  onSend: (q: string) => void
  onUpload: (f: File) => void
  uploading: boolean
  hasDocs: string[]
  onFeature: (type: 'guidance' | 'analytics' | 'compare') => void

  onRemove: (name: string) => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dropDownOpen,setDropDownOpen] = useState(false)
  const AVAILABLE_MODELS = [
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fast - 14.4k Req/day)" },
    { id: "qwen/qwen3-32b", name: "Qwen 3 32B (Smart & High Volume - 14.4k Req/day)" },
    { id: "allam-2-7b", name: "ALLAM 2 7B (Arabic Specialized - 7k Req/day)" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Max Reasoning - 1k Req/day)" }
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!input.trim() || isStreaming) return
    onSend(input.trim())
    setInput('')
  }


  function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const getButtonColor = () => {
      if (copied || isHovered) return 'rgba(210,140,160,0.9)';
      return 'rgba(255,255,255,0.3)';
    };



    return (
      <button
        onClick={handleCopy}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        // Added p-1.5 to keep the click area comfortable
        className="absolute -top-2 -left-13 cursor-pointer flex items-center justify-center p-1.5 rounded-md transition-all duration-200 hover:bg-white/5"
        style={{
          color: getButtonColor(),
        }}
        title={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    );
  }



  return (
    <div className="flex flex-col h-full pt-10 pb-2 relative h-auto">
      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-10 pb-20 space-y-7 h-auto">
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
          // while loading (no content yet) keep the bubble tight around the
          // thinking dots — only expand to full width once content arrives
          const isLoading = !isUser && msg.content === ''
          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={
                  isUser
                    ? 'max-w-[75%]'
                    : isLoading
                      ? 'max-w-fit'
                      : 'max-w-[88%] w-full'
                }
              >
                <div
                  className={
                    isUser
                      ? 'text-sm leading-relaxed rounded-2xl px-4 py-3'
                      : isLoading
                        // compact pill around the dots
                        ? 'leading-relaxed rounded-2xl px-4 py-3 w-fit'
                        // assistant: open canvas, no boxy border, more breathing room
                        : 'leading-relaxed rounded-2xl px-5 py-4'
                  }
                  style={
                    isUser
                      ? {
                        background: 'rgba(210,140,160,0.15)',
                        color: 'rgba(255,255,255,0.87)',
                        border: '1px solid rgba(210,140,160,0.2)',
                      }
                      : {
                        background: 'rgba(255,255,255,0.025)',
                        color: 'rgba(255,255,255,0.87)',
                        border: '1px solid rgba(255,255,255,0.04)',
                      }
                  }
                >
                  {isUser ? (
                    // ── User bubble: plain text, no markdown ──

                    <div className="flex relative items-start gap-2">
                      <CopyButton text={msg.content} />
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>


                  ) : (
                    // ── Assistant bubble: formatted markdown ──
                    <FormattedMessage
                      content={msg.content}
                      isLoading={msg.content === ''}
                    />
                  )}
                </div>

                {/* Sources */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {msg.sources.map((s, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2.5 py-1 rounded-full cursor-pointer transition-all duration-200"
                        style={{
                          background: 'rgba(210,140,160,0.08)',
                          color: 'rgba(255,255,255,0.35)',
                          border: '1px solid rgba(210,140,160,0.15)',
                        }}
                        onMouseEnter={e => {
                          const el = e.currentTarget
                          el.style.background = 'rgba(210,140,160,0.18)'
                          el.style.color = 'rgba(210,140,160,0.95)'
                          el.style.borderColor = 'rgba(210,140,160,0.5)'
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget
                          el.style.background = 'rgba(210,140,160,0.08)'
                          el.style.color = 'rgba(255,255,255,0.35)'
                          el.style.borderColor = 'rgba(210,140,160,0.15)'
                        }}
                      >
                        📄 {s.source} · p{s.page}
                      </span>
                    ))}
                  </div>
                )}

                {/* General knowledge hint */}
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

      {/* input bar */}
      <div className="px-4 pb-4 max-w-7xl mx-auto w-full pt-3">




        <div className="flex flex-col items-start justify-start relative bottom-2 inset-x-0 gap-2 rounded-2xl px-4 py-3"
          style={{ background: 'rgba(31, 29, 29, 0.95)', border: '1px solid rgba(61, 58, 58, 0.09)' }}>

          {hasDocs.length > 0 && (
            <div className="flex flex-col gap-1 ">
              <div

                className="group  flex flex-wrap items-center gap-1.5 mb-1.5 px-1 w-fit"
              >

                <p className="gap-1.5 mb-1.5 px-1 w-fit text-[10px]" style={{ color: 'rgba(210,140,160,0.5)' }}>
                  {hasDocs.length > 0 ? "Searching in:" : ""}
                </p>
                {hasDocs.map((name) => (


                  <div
                    key={name}

                    className="group  flex flex-row items-center gap-1.5 mb-1.5 px-2 py-1 w-fit bg-[#000000] rounded-full"
                  >
                    <p className="text-[10px]" style={{ color: 'rgba(245, 241, 242, 0.5)' }}>
                      {name}
                    </p>
                    <button
                      onClick={() => onRemove(name)}
                      className="cursor-pointer  group-hover:opacity-100 transition-opacity hover:text-red-400"
                      style={{ color: 'rgba(210,140,160,0.5)' }}
                      title="Remove document"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="white" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>



                ))}
              </div>


            </div>
          )}

          {/*comparision */}
          {hasDocs.length > 0 && (
            <div className="flex flex-wrap gap-2 w-full">
              {[
                { label: 'Guidance', icon: '🧭', disabled: hasDocs.length > 1 },
                { label: 'Analytics', icon: '📊', disabled: hasDocs.length > 1 },
                // { label: 'Compare', icon: '⚖️', disabled: hasDocs.length < 2 },
              ].map(({ label, icon, disabled }) => (
                <button
                  key={label}
                  disabled={disabled}
                  onClick={() => onFeature(label.toLowerCase() as 'guidance' | 'analytics' | 'compare')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] transition-all"
                  style={{
                    background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(210,140,160,0.08)',
                    border: `1px solid ${disabled ? 'rgba(255,255,255,0.06)' : 'rgba(210,140,160,0.2)'}`,
                    color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(210,140,160,0.8)',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                  onMouseEnter={e => {
                    if (!disabled) {
                      e.currentTarget.style.background = 'rgba(210,140,160,0.15)'
                      e.currentTarget.style.borderColor = 'rgba(210,140,160,0.4)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!disabled) {
                      e.currentTarget.style.background = 'rgba(210,140,160,0.08)'
                      e.currentTarget.style.borderColor = 'rgba(210,140,160,0.2)'
                    }
                  }}
                >
                  <span>{icon}</span>
                  {label}
                  {label === 'Compare' && hasDocs.length < 2 && (
                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '9px' }}>(need 2 docs)</span>
                  )}
                </button>
              ))}
            </div>
          )}


          <div className="flex w-full items-center relative  gap-2">

            {/* attach PDF */}
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="cursor-pointer flex-shrink-0 p-1.5 rounded-lg transition-all"
              style={{ color: uploading ? 'rgba(210,140,160,0.4)' : 'rgba(210,140,160,0.7)' }}
              title="Attach PDF">
              {uploading
                ? <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="60" strokeDashoffset="20" />
                </svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            </button>

            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="Ask anything..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm outline-none"
              style={{
                color: 'rgba(255,255,255,0.8)', caretColor: 'rgba(210,140,160,0.9)',
                maxHeight: '190px', lineHeight: '1.5', height: 'auto',
              }}
            />

            

 {/* model selection */}
            <div
              className="relative flex-shrink-0"
              style={{
                ['--model-dropdown-gap' as string]: 'clamp(0.25rem, 0.6vw, 0.5rem)',
              }}
            >
              {/* model selection modal — anchored to top of model button */}
              <div
                className={`absolute right-0 z-50 w-40 min-w-full bg-gray-500/20 rounded-lg p-2 transition-all duration-300 ${dropDownOpen ? 'h-40 block' : 'h-0 hidden'}`}
                style={{
                  bottom: 'calc(100% + var(--model-dropdown-gap))',
                }}
              >
                {AVAILABLE_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(m.id); setDropDownOpen(false) }}
                    className={`${dropDownOpen ? 'active:scale-95 flex items-center gap-1.5 px-3 py-1 mb-1 transition-all w-full text-left cursor-pointer hover:scale-102 transition-all duration-200' : 'hidden'}`}
                  >
                    <p className="text-xs border-b border-white/60 pb-1.5 w-full">{m.id}</p>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setDropDownOpen(!dropDownOpen)}
                className="active:scale-95 flex h-full items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-white transition-all hover:bg-white/10 cursor-pointer"
              >
                <span className="text-xs font-medium tracking-wide opacity-90">{model}</span>
                <ArrowDownIcon className="h-3.5 w-3.5 opacity-70 transition-transform duration-200" />
              </button>
            </div>

            <button onClick={submit} disabled={!input.trim() || isStreaming}
              className="flex-shrink-0 p-1.5 rounded-lg transition-all ml-2"
              style={{ color: input.trim() && !isStreaming ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.2)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>


        </div>
      </div>
    </div>
  )
}