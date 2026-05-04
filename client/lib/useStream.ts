import { useState, useCallback } from 'react'
import { streamQuery } from './api'
import { updateChatTitle } from './session'
import autoNameChat from './autoNameChat'

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

export function useStream(userId: string, chatId: string, initialMessages: Message[] = []) {
  console.log('chat-id : ', chatId)
  const [messages, setMessages] = useState<Message[]>(initialMessages) // 👈 accepts history
  const [isStreaming, setIsStreaming] = useState(false)
  const [title, setTitle] = useState("")

  // called from ChatPage when history loads — replaces empty state
  const loadHistory = useCallback((history: Message[]) => {
    setMessages(history)
  }, [])

  const send = useCallback(async (question: string) => {
    const start = Date.now()
    // ✅ capture history BEFORE adding empty assistant message
    const history = messages
      .slice(-15)
      .map(m => ({ role: m.role, content: m.content }))
      .filter(m => m.content.trim() !== '')  // ✅ filter empty messages
    console.log('history being sent:', history)  // ✅ add this



    // immediate UI update
    setIsStreaming(true)
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: question }
    setMessages(prev => [...prev, userMsg])
    const assistantId = crypto.randomUUID()
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


      const response = await streamQuery(question, userId, chatId, history)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''




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

          const clean = raw
            .replace(/\[Source:[^\]]*\]/gi, '')
            .replace(/\[SOURCES\].*$/g, '')
            .replace(/\s{2,}/g, ' ')

          if (!clean.trim()) continue
          fullResponse += clean
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + clean } : m
          ))
        }
      }

      await saveMessage({
        chatId, userId, role: 'assistant', content: fullResponse,
        metadata: { mode: 'general', model: 'llama-3.1-8b-instant', latencyMs: Date.now() - start }
      })

    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: 'Something went wrong. Please try again.' } : m
      ))
    } finally {
      setIsStreaming(false)
    }
  }, [userId, chatId, messages.length, title])
  return { messages, isStreaming, send, loadHistory, title }
}