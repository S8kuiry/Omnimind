'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getOrCreateDefaultChat } from '@/lib/session'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    // same behaviour as Gemini/Claude — always land in a chat
    const chat = getOrCreateDefaultChat()
    router.replace(`/dashboard/chat/${chat.id}`)
  }, [router])

  // brief blank while redirecting — keep it dark, matches your theme
  return (
    <div className="flex-1 flex items-center justify-center h-screen"
      style={{ background: '#010003' }}>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{
              background: 'rgba(210,140,160,0.5)',
              animationDelay: `${i * 150}ms`
            }} />
        ))}
      </div>
    </div>
  )
}