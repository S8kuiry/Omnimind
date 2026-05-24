'use client'
import { useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Message, useStream } from '@/lib/useStream'
import { uploadPDF, getGuidance, getAnalytics, deleteDocument } from '@/lib/api'
import TabBar from '@/app/components/session/TabBar'
import ChatPanel from '@/app/components/session/ChatPanel'

type Tab = 'chat' | 'guidance' | 'analytics' | 'compare'

const DEFAULT_MODEL = 'llama-3.1-8b-instant'
const modelStorageKey = (chatId: string) => `omnimind-model-${chatId}`

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''  // 👈 use real auth userId not localStorage
  // add to state

  const [featureLoading, setFeatureLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [docName, setDocName] = useState<string | null>(null)
  const [docNames, setDocNames] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false)
  const [guidanceData, setGuidanceData] = useState<any>(null)
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [model, setModelState] = useState<string>(DEFAULT_MODEL)

  useEffect(() => {
    if (!chatId) return
    const saved = sessionStorage.getItem(modelStorageKey(chatId))
    if (saved) setModelState(saved)
  }, [chatId])

  const setModel = (m: string) => {
    setModelState(m)
    if (chatId) sessionStorage.setItem(modelStorageKey(chatId), m)
  }

  const { messages, isStreaming, streamingMessageId, send, loadHistory, injectLoading, updateMessage, injectUserMessage } = useStream(userId, chatId, [], model)
  console.log("userId", userId)

  // remving the uploaded pdf 
  const handleRemove = async (name: string) => {
    // ✅ remove from UI instantly
    setDocNames(prev => prev.filter(d => d !== name))

    try {
      await deleteDocument(name, userId, chatId)
      await fetch(`/api/chat/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { pdfNames: docNames.filter(d => d !== name) } })
      })
    } catch {
      // rollback if it fails
      setDocNames(prev => [...prev, name])
    }
  }

  // load chat history on mount
  useEffect(() => {
    if (!userId || !chatId || historyLoaded) return

    fetch(`/api/chat/${chatId}?userId=${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          // map DB messages to UI Message format
          loadHistory(data.messages.map((m: any) => ({
            id: m._id,
            role: m.role,
            content: m.content,
            sources: m.metadata?.sources || [],
            mode: m.metadata?.mode || 'general',
          })))
        }
        // restore PDF state if chat had a PDF
        // if (data.chat?.metadata?.pdfName) {
        //   setDocName(data.chat.metadata.pdfName)

        // }
        // if (data.chat?.metadata?.pdfNames) {
        //   setDocNames(data.chat.metadata.pdfNames)
        // }
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
  }, [userId, chatId, historyLoaded, loadHistory])


  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const res = await uploadPDF(file, userId, chatId)
      const updatedNames = [...docNames, res.doc_name]
      setDocNames(updatedNames)
      setDocName(res.doc_name)

      await fetch(`/api/chat/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { pdfNames: updatedNames } })
      })
    } finally {
      setUploading(false)
    }
  }


  {/*fecthing doc names  */ }
  useEffect(() => {
    if (!chatId) return  // ✅ remove historyLoaded dependency

    fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/documents/chat/${chatId}`)
      .then(r => r.json())
      .then(data => {
        if (data.documents?.length > 0) {
          setDocNames(data.documents)
        }
      })
  }, [chatId])  // ✅ only depends on chatId


  {/** feature handle  */ }
 const handleFeature = async (type: 'guidance' | 'analytics' | 'compare') => {
  if (featureLoading) return
  setFeatureLoading(true)

  const labelMap = {
    guidance: '🧭 Generate document guidance',
    analytics: '📊 Analyse this document',
    compare: '⚖️ Compare documents',
  }

  // ✅ inject visible user message
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: labelMap[type],
  }
injectUserMessage(labelMap[type])

  // save user message to DB
  await fetch('/api/chat/save-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId, userId,
      role: 'user',
      content: labelMap[type],
      title: labelMap[type],
      metadata: {}
    })
  })
  window.dispatchEvent(new Event('omnimind_chats_updated'))

  const loadingId = crypto.randomUUID()
  injectLoading(loadingId)

  // ... rest of feature handling same as before

  let assistantContent = ''
  try {
    if (type === 'guidance') {
      const data = await getGuidance(docNames[0], userId, chatId)
      assistantContent = `**🧭 Document Guidance**\n\n${data.guidance}`
      updateMessage(loadingId, assistantContent)
    }
    if (type === 'analytics') {
      const data = await getAnalytics(docNames[0], userId, chatId)
      assistantContent = `**📊 Analytics**\n\n${JSON.stringify(data.analytics, null, 2)}`
      updateMessage(loadingId, assistantContent)
    }
    // if (type === 'compare') {
    //   const data = await compareDocuments(docNames, userId, chatId)
    //   assistantContent = `**⚖️ Compare**\n\n${JSON.stringify(data.compare, null, 2)}`
    //   updateMessage(loadingId, assistantContent)
    // }

    // ✅ persist assistant reply so it survives reload
    if (assistantContent) {
      await fetch('/api/chat/save-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId, userId,
          role: 'assistant',
          content: assistantContent,
          metadata: { mode: type, source: docNames[0] || null }
        })
      })
    }
  } catch {
    const errMsg = 'Something went wrong. Please try again.'
    updateMessage(loadingId, errMsg)
    await fetch('/api/chat/save-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId, userId,
        role: 'assistant',
        content: errMsg,
        metadata: { mode: type, error: true }
      })
    })
  } finally {
    setFeatureLoading(false)
  }
}


  // don't render until session is ready
  if (!userId) return (
    <div className="flex-1 flex items-center justify-center h-screen" style={{ background: '#0e0f10' }}>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: 'rgba(210,140,160,0.5)', animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-hidden flex flex-col h-screen" style={{ background: '#0e0f10' }}>
      <div className="flex-1 overflow-hidden px-40">
        {activeTab === 'chat' && (
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            streamingMessageId={streamingMessageId}
            onSend={send}
            onUpload={handleUpload}
            uploading={uploading}
            hasDocs={docNames}
            onRemove={handleRemove}
            onFeature={handleFeature}
            model={model}
            setModel={setModel}
          />
        )}
      </div>
    </div>
  )
}