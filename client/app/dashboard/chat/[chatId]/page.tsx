'use client'
import { useParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Message, useStream } from '@/lib/useStream'
import { uploadPDF, getGuidance, getAnalytics, compareDocuments, deleteDocument, getApiBase } from '@/lib/api'
import TabBar from '@/app/components/session/TabBar'
import ChatPanel from '@/app/components/session/ChatPanel'
import DocumentSourcePanel from '@/app/components/session/DocumentSourcePanel'
import { DEFAULT_CHAT_MODEL, loadChatModel, saveChatModel } from '@/lib/models'

type Tab = 'chat' | 'guidance' | 'analytics' | 'compare'

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
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [removingDoc, setRemovingDoc] = useState(false)
  const [guidanceData, setGuidanceData] = useState<any>(null)
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [model, setModelState] = useState<string>(DEFAULT_CHAT_MODEL)
  const [sourcePanel, setSourcePanel] = useState<{
    docName: string
    page: number
    snippet?: string
    sectionContext?: string
  } | null>(null)
  const docsFetchVersion = useRef(0)

  useEffect(() => {
    if (!chatId) return
    setModelState(loadChatModel(chatId))
  }, [chatId])

  const setModel = (m: string) => {
    setModelState(m)
    if (chatId) saveChatModel(chatId, m)
  }

  const {
    messages,
    isStreaming,
    streamingMessageId,
    send,
    loadHistory,
    setChatTitle,
    injectLoading,
    updateMessage,
    injectUserMessage,
    saveWarning,
    dismissSaveWarning,
  } = useStream(userId, chatId, [], model, docNames)

  const handleRemove = async (name: string) => {
    if (removingDoc || uploading) return
    setRemovingDoc(true)
    docsFetchVersion.current++
    let nextNames: string[] = []
    setDocNames(prev => {
      nextNames = prev.filter(d => d !== name)
      return nextNames
    })

    try {
      await deleteDocument(name, userId, chatId)
      await fetch(`/api/chat/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: { pdfNames: nextNames } })
      })
    } catch {
      docsFetchVersion.current++
      setDocNames(prev => [...prev, name])
    } finally {
      setRemovingDoc(false)
    }
  }

  // load chat history on mount
  useEffect(() => {
    if (!userId || !chatId || historyLoaded) return

    fetch(`/api/chat/${chatId}?userId=${userId}`)
      .then(r => r.json())
      .then(data => {
        // Ensure the chat exists in DB even if it was created locally first.
        // This prevents header title fetch (/api/chat/name/..) from 404ing.
        if (!data.chat) {
          fetch('/api/chat/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, userId, title: 'New Chat' }),
          }).catch(() => {})
        }
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
        if (data.chat?.title) {
          setChatTitle(String(data.chat.title))
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
    if (uploading || removingDoc || !userId || !chatId) return
    setUploading(true)
    setUploadStatus('Uploading…')
    docsFetchVersion.current++
    try {
      const res = await uploadPDF(file, userId, chatId, setUploadStatus)
      setDocNames(prev => {
        if (prev.includes(res.doc_name)) return prev
        const next = [...prev, res.doc_name]
        void fetch(`/api/chat/${chatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: { pdfNames: next } }),
        })
        return next
      })
      setDocName(res.doc_name)
    } catch (err) {
      console.error('Upload failed:', err)
      setUploadStatus('Upload failed')
    } finally {
      setUploading(false)
      setTimeout(() => setUploadStatus(null), 4000)
    }
  }


  useEffect(() => {
    if (!chatId) return

    const versionAtFetch = docsFetchVersion.current
    fetch(`${getApiBase()}/documents/chat/${chatId}`)
      .then(r => r.json())
      .then(data => {
        if (docsFetchVersion.current !== versionAtFetch) return
        setDocNames(data.documents ?? [])
      })
      .catch(() => {})
  }, [chatId])


  {/** feature handle  */ }
 const handleFeature = async (type: 'guidance' | 'analytics' | 'compare' | 'edit') => {


  if (type === 'edit') {
    setSourcePanel({
      docName: docNames[0],
      page: 1,
      snippet: undefined,
      sectionContext: undefined,
    })
    return
  }


  if (featureLoading) return
  setFeatureLoading(true)

  const labelMap = {
    guidance: '🧭 Generate document guidance',
    analytics: '📊 Analyse this document',
    compare: '⚖️ Compare documents',
    edit: '✏️ Edit this document',
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
    if (type === 'compare' && docNames.length >= 2) {
      const data = await compareDocuments(
        'Compare these two documents and highlight key similarities and differences.',
        userId,
        chatId,
        docNames[0],
        docNames[1],
      )
      assistantContent = `**⚖️ Compare**\n\n${data.comparison}`
      updateMessage(loadingId, assistantContent)
    }

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
    <div className="flex-1 flex items-center justify-center h-screen" style={{ background: '#010003' }}>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: 'rgba(210,140,160,0.5)', animationDelay: `${i * 150}ms` }} />
        ))}
      </div>
    </div>
  )

  return (
    <div
      className={`flex-1 overflow-hidden flex h-screen  ${sourcePanel ? 'flex-row' : 'flex-col '} items-center justify-center` }
      style={{ background: '#010003' }}
    >
      <div
        className={`flex flex-col min-w-0 h-full  ${sourcePanel ? 'w-[58%] shrink-0' : 'w-[75%]'}`}
        style={{ transition: 'width 0.2s' }}
      >
        {activeTab === 'chat' && (
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            streamingMessageId={streamingMessageId}
            onSend={send}
            onUpload={handleUpload}
            uploading={uploading || removingDoc}
            uploadStatus={uploadStatus}
            hasDocs={docNames}
            onRemove={handleRemove}
            onFeature={handleFeature}
            model={model}
            setModel={setModel}
            onOpenSource={(docName, page, snippet, sectionContext) =>
              setSourcePanel({ docName, page, snippet, sectionContext })
            }
            saveWarning={saveWarning}
            onDismissSaveWarning={dismissSaveWarning}
          />
        )}
      </div>

      {sourcePanel && (
        <div className="w-[42%] h-full shrink-0 min-w-0">
          <DocumentSourcePanel
            docName={sourcePanel.docName}
            page={sourcePanel.page}
            snippet={sourcePanel.snippet}
            sectionContext={sourcePanel.sectionContext}
            userId={userId}
            chatId={chatId}
            knownDocs={docNames}
            onClose={() => setSourcePanel(null)}
          />
        </div>
      )}
    </div>
  )
}