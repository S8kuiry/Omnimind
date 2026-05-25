import { useState, useCallback, useRef } from 'react'
import { createStreamSanitizer, stripReasoningBlocks } from './sanitizeModelOutput'
import { repairUniversalModelMarkdown } from './markdownNormalize'
import { streamQuery } from './api'
import autoNameChat from './autoNameChat'
import { buildHistoryPayload } from './conversation'
import {
  buildSectionSources,
  sectionSourcesFromHeadings,
  mergeSourceLists,
  stripCitationTags,
  type ChunkRef,
  type SourceRef,
} from './sectionSources'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: SourceRef[]
  mode?: 'document' | 'general'
}

type SaveResult = { ok: true } | { ok: false; error: string }

async function saveMessage(payload: object): Promise<SaveResult> {
  try {
    const res = await fetch('/api/chat/save-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let error = 'Could not save message to history'
      try {
        const data = await res.json()
        if (typeof data.error === 'string') error = data.error
      } catch {
        const text = await res.text()
        if (text) error = text
      }
      return { ok: false, error }
    }
    window.dispatchEvent(new Event('omnimind_chats_updated'))
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server to save this message' }
  }
}

export function useStream(
  userId: string,
  chatId: string,
  initialMessages: Message[] = [],
  model: string = 'llama-3.1-8b-instant',
  documentNames: string[] = [],
) {
  console.log('chat-id : ', chatId)
  const [messages, setMessages] = useState<Message[]>(initialMessages) // 👈 accepts history
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [saveWarning, setSaveWarning] = useState<string | null>(null)

  const injectUserMessage = useCallback((content: string) => {
  setMessages(prev => [...prev, {
    id: crypto.randomUUID(),
    role: 'user' as const,
    content,
  }])
}, [])

  const injectLoading = useCallback((id: string) => {
    setMessages(prev => [...prev, {
      id,
      role: 'assistant' as const,
      content: '',
    }])
  }, [])

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages(prev => prev.map(m =>
      m.id === id ? { ...m, content } : m
    ))
  }, [])



  // called from ChatPage when history loads — replaces empty state
  const loadHistory = useCallback((history: Message[]) => {
    setMessages(history)
  }, [])

  const streamingMsgIdRef = useRef<string | null>(null)
  const pendingContentRef = useRef('')
  const flushRafRef = useRef<number | null>(null)
  const lastFlushMsRef = useRef(0)
  const STREAM_FLUSH_MS = 80

  const send = useCallback(async (question: string) => {
    const start = Date.now()
    const history = buildHistoryPayload(
      messages.map(m => ({ role: m.role, content: m.content })),
      question
    )



    // immediate UI update
    setIsStreaming(true)
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: question }
    setMessages(prev => [...prev, userMsg])
    const assistantId = crypto.randomUUID()
    streamingMsgIdRef.current = assistantId
    setStreamingMessageId(assistantId)
    pendingContentRef.current = ''
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    let chatTitle = title || 'New Chat'
    if (messages.length === 0 && !title) {
      chatTitle = await autoNameChat(chatId, question)
      setTitle(chatTitle)
    }

    saveMessage({
      chatId,
      userId,
      role: 'user',
      content: question,
      title: chatTitle,
      metadata: {},
    }).then(r => {
      if (!r.ok) setSaveWarning(r.error)
    })

    let fullResponse = ''
    const snippetMapRef: Record<string, string> = {}
    const chunksRef: ChunkRef[] = []
    let hadRagChunks = false
    let finalSources: SourceRef[] = []

    try {


      const response = await streamQuery(question, userId, chatId, history, model, documentNames)
      if (!response.ok) {
        const errBody = await response.text()
        throw new Error(errBody || `Chat request failed (${response.status})`)
      }
      if (!response.body) {
        throw new Error('No response stream from server')
      }
      await fetch(`/api/llm/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      })
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''




      const sanitizer = createStreamSanitizer()

      const flushPending = (id: string) => {
        const chunk = pendingContentRef.current
        if (!chunk) return
        pendingContentRef.current = ''
        setMessages(prev =>
          prev.map(m => (m.id === id ? { ...m, content: m.content + chunk } : m))
        )
      }

      const scheduleFlush = (id: string) => {
        const now = Date.now()
        const elapsed = now - lastFlushMsRef.current
        const run = () => {
          flushRafRef.current = null
          lastFlushMsRef.current = Date.now()
          flushPending(id)
        }
        if (elapsed >= STREAM_FLUSH_MS) {
          if (flushRafRef.current != null) {
            cancelAnimationFrame(flushRafRef.current)
            flushRafRef.current = null
          }
          run()
          return
        }
        if (flushRafRef.current != null) return
        flushRafRef.current = requestAnimationFrame(() => {
          if (Date.now() - lastFlushMsRef.current >= STREAM_FLUSH_MS) run()
          else scheduleFlush(id)
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const token = line.slice(6)
          if (token === '[DONE]') break

          if (token.startsWith('[CHUNKS]')) {
            try {
              const chunks = JSON.parse(token.slice(8)) as {
                source: string; page: number; snippet: string; text?: string
              }[]
              hadRagChunks = true
              for (const c of chunks) {
                const src = c.source.replace(/\.pdf$/i, '')
                const key = `${src}-${c.page}`
                snippetMapRef[key] = c.text || c.snippet
                chunksRef.push({
                  source: src,
                  page: c.page,
                  snippet: c.snippet,
                  text: c.text,
                })
              }
            } catch { /* ignore malformed payload */ }
            continue
          }

          if (token.startsWith('[SECTION_SOURCES]')) {
            try {
              const parsed = JSON.parse(token.slice(17)) as SourceRef[]
              if (parsed.length > 0) {
                finalSources = parsed.map(s => ({
                  source: s.source.replace(/\.pdf$/i, ''),
                  page: s.page,
                  snippet: s.snippet,
                  label: s.label,
                  sectionContext: s.sectionContext,
                }))
              }
            } catch { /* ignore */ }
            continue
          }

          if (token.startsWith('[SOURCES]')) {
            try {
              const raw_sources = JSON.parse(token.slice(9)) as { source: string; page: number }[]
              const seen = new Set<string>()
              finalSources = raw_sources
                .filter(s => {
                  const key = `${s.source}-${s.page}`
                  if (seen.has(key)) return false
                  seen.add(key)
                  return true
                })
                .map(s => ({
                  source: s.source.replace(/\.pdf$/i, ''),
                  page: s.page,
                  snippet: snippetMapRef[`${s.source.replace(/\.pdf$/i, '')}-${s.page}`],
                }))
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, sources: finalSources } : m
              ))
            } catch { /* ignore */ }
            continue
          }

          // ✅ buffer incomplete [Source:] tags
          const raw = buffer + token
          buffer = ''

          if (raw.includes('[Source:') && !raw.includes(']')) {
            buffer = raw
            continue
          }

          const sanitized = sanitizer.push(
            raw
              .replace(/\[Source:[^\]]*\]/gi, '')
              .replace(/\[SOURCES\].*$/g, '')
          )

          if (!sanitized.trim()) continue
          fullResponse += sanitized
          pendingContentRef.current += sanitized
          scheduleFlush(assistantId)
        }
      }

      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current)
        flushRafRef.current = null
      }
      flushPending(assistantId)

      const tail = sanitizer.flush()
      if (tail.trim()) {
        fullResponse += tail
        pendingContentRef.current = tail
        flushPending(assistantId)
      }

      fullResponse = stripCitationTags(
        repairUniversalModelMarkdown(stripReasoningBlocks(fullResponse)),
      )

      if (hadRagChunks && chunksRef.length > 0) {
        if (!finalSources.some(s => s.label)) {
          let sectionSources = buildSectionSources(fullResponse, chunksRef)
          if (!sectionSources.some(s => s.label)) {
            sectionSources = sectionSourcesFromHeadings(fullResponse, chunksRef)
          }
          if (sectionSources.some(s => s.label)) {
            finalSources = sectionSources
          } else {
            finalSources = mergeSourceLists(finalSources, sectionSources)
            if (finalSources.length === 0) {
              const seen = new Set<string>()
              finalSources = chunksRef.filter(c => {
                const k = `${c.source}-${c.page}`
                if (seen.has(k)) return false
                seen.add(k)
                return true
              })
            }
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: fullResponse, sources: finalSources.length ? finalSources : m.sources, mode: hadRagChunks ? 'document' : 'general' }
          : m
      ))

      saveMessage({
        chatId, userId, role: 'assistant', content: fullResponse,
        metadata: {
          sources: finalSources,
          mode: hadRagChunks ? 'document' : 'general',
          model,
          latencyMs: Date.now() - start,
        },
      }).then(r => {
        if (!r.ok) setSaveWarning(r.error)
      })

    } catch (err) {
      console.error('[stream]', err)
      let msg = 'Something went wrong. Please try again.'
      if (err instanceof Error && err.message) {
        if (err.message.includes('dimension')) {
          msg = 'Search index mismatch — re-upload your PDF after restarting the backend.'
        } else if (err.message.length < 200) {
          msg = err.message
        }
      }
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: msg } : m
      ))
    } finally {
      streamingMsgIdRef.current = null
      setStreamingMessageId(null)
      setIsStreaming(false)
    }
  }, [userId, chatId, messages, title, model, documentNames])
  return {
    messages,
    isStreaming,
    streamingMessageId,
    send,
    loadHistory,
    title,
    injectLoading,
    updateMessage,
    injectUserMessage,
    saveWarning,
    dismissSaveWarning: () => setSaveWarning(null),
  }
}