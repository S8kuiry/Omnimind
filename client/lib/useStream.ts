import { useState, useCallback, useRef } from 'react'
import { createStreamSanitizer, stripReasoningBlocks } from './sanitizeModelOutput'
import { streamQuery } from './api'
import { updateChatTitle } from './session'
import autoNameChat from './autoNameChat'
import { buildHistoryPayload } from './conversation'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: { source: string; page: number }[]
  mode?: 'document' | 'general'
}

async function saveMessage(payload: object) {
  await fetch('/api/chat/save-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function useStream(userId: string, chatId: string, initialMessages: Message[] = [], model: string = 'llama-3.1-8b-instant') {
  console.log('chat-id : ', chatId)
  const [messages, setMessages] = useState<Message[]>(initialMessages) // 👈 accepts history
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [title, setTitle] = useState("")

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

    // only name on first message
    let chatTitle = title
    if (messages.length === 0 && !title) {
      const chunks = question.slice(0, 30) + (question.length > 30 ? '...' : '')
      chatTitle = await autoNameChat(chatId, chunks)
      setTitle(chatTitle)
      window.dispatchEvent(new Event('omnimind_chats_updated'))
    }

    // save once
    await saveMessage({ chatId, userId, role: 'user', content: question, title: chatTitle, metadata: {} })

    let fullResponse = ''

    try {


      const response = await streamQuery(question, userId, chatId, history, model)
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

          // ✅ handle sources event
          if (token.startsWith('[SOURCES]')) {
            try {
              const raw_sources = JSON.parse(token.slice(9))
              const seen = new Set<string>()
              const sources = raw_sources.filter((s: any) => {
                const key = `${s.source}-${s.page}`
                if (seen.has(key)) return false
                seen.add(key)
                return true
              })
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, sources } : m
              ))
            } catch { }
            continue  // ✅ don't process as text
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

      fullResponse = stripReasoningBlocks(fullResponse)

      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: fullResponse } : m
      ))

      await saveMessage({
        chatId, userId, role: 'assistant', content: fullResponse,
        metadata: { mode: 'general', model, latencyMs: Date.now() - start }
      })

    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: 'Something went wrong. Please try again.' } : m
      ))
    } finally {
      streamingMsgIdRef.current = null
      setStreamingMessageId(null)
      setIsStreaming(false)
    }
  }, [userId, chatId, messages, title, model])
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
  }
}