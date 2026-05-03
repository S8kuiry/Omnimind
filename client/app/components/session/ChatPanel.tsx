'use client'
import { useRef, useEffect, useState } from 'react'
import type { Message } from '@/lib/useStream'
import FormattedMessage from '../FormattedMessage'

export default function ChatPanel({ messages, isStreaming, onSend, onUpload, uploading, hasDocs, docName, onRemove }: {
  messages: Message[]
  isStreaming: boolean
  onSend: (q: string) => void
  onUpload: (f: File) => void
  uploading: boolean
  docName: string | null
  hasDocs: string[]
  onRemove: (name: string) => void
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!input.trim() || isStreaming) return
    onSend(input.trim())
    setInput('')
  }

  return (
    <div className="flex flex-col h-full pt-10 pb-2 relative">
      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-10 pb-20 space-y-6">
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

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[75%]">
              <div
                className="text-sm leading-relaxed rounded-2xl px-4 py-3"
                style={{
                  background: msg.role === 'user' ? 'rgba(210,140,160,0.15)' : 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.87)',
                  border: msg.role === 'user'
                    ? '1px solid rgba(210,140,160,0.2)'
                    : '1px solid rgba(255,255,255,0.07)'
                }}
              >
                {msg.role === 'user' ? (
                  // ── User bubble: plain text, no markdown ──
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : (
                  // ── Assistant bubble: formatted markdown ──
                  <FormattedMessage
                    content={msg.content}
                    isLoading={isStreaming && msg.content === ''}
                  />
                )}
              </div>

              {/* Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {msg.sources.map((s, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}
                    >
                      {s.source} · p{s.page}
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
        ))}

        <div ref={bottomRef} />
      </div>

      {/* input bar */}
      <div className="px-4 pb-4 max-w-7xl mx-auto w-full pt-3">
        {/* {hasDocs && (
          <div className="group flex items-center gap-1.5 mb-1.5 px-1 w-fit">
            <p className="text-[10px]" style={{ color: 'rgba(210,140,160,0.5)' }}>
              Searching in: {docName}
            </p>
            <button
              onClick={() => onRemove()}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'rgba(210,140,160,0.5)' }}
              title="Remove document"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )} */}
        


        <div className="flex flex-col items-start justify-start relative bottom-6 inset-x-0 gap-2 rounded-2xl px-4 py-3"
          style={{ background: 'rgba(31, 29, 29, 0.95)', border: '1px solid rgba(61, 58, 58, 0.09)' }}>

{hasDocs.length > 0 && (
          <div className="flex flex-col gap-1">
            <div

              className="group  flex flex-row items-center gap-1.5 mb-1.5 px-1 w-fit"
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



          <div className="flex w-full items-center  gap-2">

            {/* attach PDF */}
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex-shrink-0 p-1.5 rounded-lg transition-all"
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
                maxHeight: '120px', lineHeight: '1.5'
              }}
            />

            <button onClick={submit} disabled={!input.trim() || isStreaming}
              className="flex-shrink-0 p-1.5 rounded-lg transition-all"
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