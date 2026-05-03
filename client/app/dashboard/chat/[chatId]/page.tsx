'use client'
import { useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useStream } from '@/lib/useStream'
import { uploadPDF, getGuidance, getAnalytics, deleteDocument } from '@/lib/api'
import TabBar from '@/app/components/session/TabBar'
import ChatPanel from '@/app/components/session/ChatPanel'

type Tab = 'chat' | 'guidance' | 'analytics' | 'compare'

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''  // 👈 use real auth userId not localStorage
  // add to state


  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [docName, setDocName] = useState<string | null>(null)
  const [docNames, setDocNames] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false)
  const [guidanceData, setGuidanceData] = useState<any>(null)
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const { messages, isStreaming, send, loadHistory } = useStream(userId, chatId)

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
        if (data.chat?.metadata?.pdfName) {
          setDocName(data.chat.metadata.pdfName)

        }
        if (data.chat?.metadata?.pdfNames) {
          setDocNames(data.chat.metadata.pdfNames)
        }
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
      <div className="flex-1 overflow-hidden px-30">
        {activeTab === 'chat' && (
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            onSend={send}
            onUpload={handleUpload}
            uploading={uploading}
            hasDocs={docNames}
            docName={docName}
            onRemove={handleRemove}
          />
        )}
      </div>
    </div>
  )
}