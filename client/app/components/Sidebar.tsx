'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { v4 as uuidv4 } from 'uuid'

interface ChatMeta {
  chatId: string
  title: string
  createdAt: string
}

const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    )
  },
  {
    label: 'Profile',
    href: '/dashboard/profile',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
      </svg>
    )
  },
]

const bottomItems = [
  {
    label: 'Settings',
    href: '/dashboard/settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
      </svg>
    )
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  // To track which chat's menu is open
const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
// To track which chat is about to be deleted (for the confirmation modal)
const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState(false)
  const [chats, setChats] = useState<ChatMeta[]>([])
  const [hoveredChat, setHoveredChat] = useState<string | null>(null)

  const loadChats = () => {
    if (!userId) return
    fetch(`/api/chat/chats?userId=${userId}`)
      .then(r => r.json())
      .then(data => setChats(data.chats || []))
  }

  useEffect(() => {
    loadChats()
  }, [userId])

  // reload sidebar when a new message is saved
  useEffect(() => {
    window.addEventListener('omnimind_chats_updated', loadChats)
    return () => window.removeEventListener('omnimind_chats_updated', loadChats)
  }, [userId])

  const handleNewChat = () => {
    const chatId = uuidv4()
    router.push(`/dashboard/chat/${chatId}`)
    // DB record created automatically on first message via save-message
  }

  const handleDeleteChat = async ( chatId: string) => {
  
    await fetch(`/api/chat/${chatId}?userId=${userId}`, { method: 'DELETE' })
    loadChats()
    if (pathname.includes(chatId)) router.push('/dashboard')
  }

  return (
    <aside
      className="relative inset-y-0 flex flex-col h-screen border-r transition-all duration-300"
      style={{
        width: collapsed ? '64px' : '220px',
        minWidth: collapsed ? '64px' : '220px',
        background: '#0e0f10',
        borderColor: 'rgba(255,255,255,0.06)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(210,140,160,0.2)', border: '1px solid rgba(210,140,160,0.3)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="rgba(210,140,160,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {!collapsed && <span className="text-white font-semibold text-sm tracking-wide">OmniMind</span>}
      </div>

      {/* New Chat */}
      <div className="cursor-pointer px-2 pt-3 pb-1">
        <button onClick={handleNewChat}
          className="cursor-pointer w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 text-xs font-medium"
          style={{ background: 'rgba(210,140,160,0.08)', border: '1px solid rgba(210,140,160,0.2)', color: 'rgba(210,140,160,0.9)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(210,140,160,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(210,140,160,0.08)')}
          title={collapsed ? 'New Chat' : undefined}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          {!collapsed && <span className="tracking-wide">New Chat</span>}
        </button>
      </div>

      {/* Nav + recent chats */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto space-y-0.5">
        {navItems.map(item => {
          const active = pathname === item.href
          return (
            <Link key={item.href} href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150"
              style={{ background: active ? 'rgba(210,140,160,0.12)' : 'transparent', color: active ? 'rgba(210,140,160,0.95)' : 'rgba(255,255,255,0.45)' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
            >
              <span className="flex-shrink-0" style={{ color: active ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.35)' }}>
                {item.icon}
              </span>
              {!collapsed && <span className="text-xs tracking-wide font-medium">{item.label}</span>}
            </Link>
          )
        })}

        {/* Recent chats from DB */}
        {!collapsed && chats.length > 0 && (
          <div className="pt-3">
            <p className="text-[10px] uppercase tracking-widest px-3 pb-1.5" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Recent
            </p>
            {chats.map(chat => {
  const active = pathname === `/dashboard/chat/${chat.chatId}`;
  const isMenuOpen = menuOpenId === chat.chatId;

  return (
    <div key={chat.chatId} className="relative group"
      onMouseEnter={() => setHoveredChat(chat.chatId)}
      onMouseLeave={() => {
        setHoveredChat(null);
        if (!isMenuOpen) setMenuOpenId(null); // Close menu if mouse leaves
      }}
    >
      <Link href={`/dashboard/chat/${chat.chatId}`}
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150 pr-8"
        style={{ 
          background: active ? 'rgba(210,140,160,0.08)' : 'transparent', 
          color: active ? 'rgba(210,140,160,0.9)' : 'rgba(255,255,255,0.4)' 
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, opacity: 0.4 }}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs truncate">{chat.title}</span>
      </Link>

      {/* Triple Dot Button - Shown on Hover OR if Menu is Open */}
      {(hoveredChat === chat.chatId || isMenuOpen) && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <button
            onClick={(e) => {
              e.preventDefault();
              setMenuOpenId(isMenuOpen ? null : chat.chatId);
            }}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            {/* Vertical Triple Dot Icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>

          {/* Mini Dropdown Menu */}
          {isMenuOpen && (
            <div className="absolute right-0 mt-1 w-24 bg-[#1a1a1a] border border-white/10 rounded-md shadow-xl z-50 overflow-hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setChatToDelete(chat.chatId); // Open confirmation modal
                  setMenuOpenId(null);
                }}
                className="w-full text-left px-3 py-2 text-[10px] text-red-400 hover:bg-white/5 transition-colors"
              >
                Delete Chat
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
})}

{/* Confirmation Modal */}
{chatToDelete && (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
    <div className="bg-[#121212] border border-white/10 p-5 rounded-xl max-w-xs w-full shadow-2xl">
      <h3 className="text-sm font-medium text-white mb-2">Delete Chat?</h3>
      <p className="text-xs text-white/50 mb-6">This action cannot be undone. Are you sure you want to delete this conversation?</p>
      
      <div className="flex gap-3 justify-end">
        <button 
          onClick={() => setChatToDelete(null)}
          className="px-3 py-1.5 text-xs text-white/40 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button 
          onClick={() => {
            handleDeleteChat( chatToDelete); // Call your existing delete logic
            setChatToDelete(null);
          }}
          className="px-3 py-1.5 text-xs bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-all"
        >
          Confirm Delete
        </button>
      </div>
    </div>
  </div>
)}
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-3 space-y-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {bottomItems.map(item => (
          <Link key={item.href} href={item.href}
            className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150"
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span className="text-xs tracking-wide">{item.label}</span>}
          </Link>
        ))}

        {/* User */}
        <div className="flex items-center gap-3 px-3 py-2 mt-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
            style={{ background: 'rgba(210,140,160,0.25)', color: 'rgba(210,140,160,0.9)' }}>
            {session?.user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/70 truncate font-medium">{session?.user?.name ?? 'User'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <button onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150"
        style={{ background: '#1a1b1d', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          {collapsed
            ? <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          }
        </svg>
      </button>
    </aside>
  )
}