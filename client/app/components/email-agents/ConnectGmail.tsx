'use client'
import { Mail, ShieldCheck, Zap, Eye, Bell } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { getGmailAuthUrl } from '@/lib/automationApi'

const FEATURES = [
  { icon: <Zap size={13} />,         text: 'Auto-categorize and prioritize inbox' },
  { icon: <Eye size={13} />,          text: 'Plain-English summary per email' },
  { icon: <Mail size={13} />,         text: 'AI-drafted replies ready to send' },
  { icon: <Bell size={13} />,         text: 'Morning digest sent to your inbox' },
  { icon: <ShieldCheck size={13} />,  text: 'Revoke access anytime — your data stays yours' },
]

export default function ConnectGmail() {
  const { data: session } = useSession()

  const handleConnect = () => {
    // Pass the logged-in user's email so the backend callback
    // knows which frontend user to associate the Gmail tokens with
    const url = getGmailAuthUrl()
    window.location.href = url
  }

  return (
    <div
      className="flex-1 flex items-center justify-center h-screen px-6"
      style={{ background: '#010003' }}
    >
      <div className="w-full max-w-sm">

        {/* Icon */}
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6 mx-auto"
          style={{
            background: 'rgba(210,140,160,0.08)',
            border: '1px solid rgba(210,140,160,0.18)',
          }}
        >
          <Mail size={22} style={{ color: 'rgba(210,140,160,0.8)' }} />
        </div>

        {/* Title */}
        <h2 className="text-base font-medium text-white/85 text-center mb-1">
          Email Agent
        </h2>
        <p className="text-xs text-center mb-7" style={{ color: 'rgba(255,255,255,0.32)' }}>
          Connect Gmail and let OmniMind manage your inbox in the background — automatically.
        </p>

        {/* Features */}
        <div className="space-y-3 mb-7">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="flex-shrink-0" style={{ color: 'rgba(210,140,160,0.65)' }}>
                {f.icon}
              </span>
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {f.text}
              </span>
            </div>
          ))}
        </div>

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={!session?.user?.email}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(210,140,160,0.1)',
            border: '1px solid rgba(210,140,160,0.28)',
            color: 'rgba(210,140,160,0.92)',
          }}
          onMouseEnter={e => {
            if (!session?.user?.email) return
            e.currentTarget.style.background = 'rgba(210,140,160,0.18)'
            e.currentTarget.style.borderColor = 'rgba(210,140,160,0.48)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(210,140,160,0.1)'
            e.currentTarget.style.borderColor = 'rgba(210,140,160,0.28)'
          }}
        >
          {/* Google G */}
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Connect Gmail
        </button>

        {/* Session email hint */}
        {session?.user?.email && (
          <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Connecting as {session.user.email}
          </p>
        )}

        <p className="text-center text-[10px] mt-3" style={{ color: 'rgba(255,255,255,0.18)' }}>
          Phase 1 · More agents coming soon
        </p>
      </div>
    </div>
  )
}