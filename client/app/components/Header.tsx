'use client'
import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'



export default function Header() {
    const { data: session } = useSession()
    const [menuOpen, setMenuOpen] = useState(false)

    return (
        <header className="flex items-center justify-between px-6 py-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0e0f10' }}>

            {/* Left — breadcrumb / page title */}
            <div className="flex items-center gap-2">
                <span className="text-xs text-white/25 tracking-widest uppercase">OmniMind</span>
                <span style={{ color: 'rgba(255,255,255,0.15)' }}>/</span>
                <span className="text-xs text-white/60 tracking-wide">Dashboard</span>
            </div>

            {/* Center — search */}
            {/* <div className="flex-1 max-w-sm mx-8">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                        style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search anything..."
                        className="flex-1 bg-transparent outline-none text-xs text-white/60 placeholder:text-white/20"
                    />
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        ⌘K
                    </kbd>
                </div>
            </div> */}

            {/* Right — actions + user */}
            <div className="flex items-center gap-2">

                {/* Notification bell */}
                {/* <button className="relative w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" />
                    </svg>
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                        style={{ background: 'rgba(210,140,160,0.9)' }} />
                </button> */}

                {/* Divider */}
                <div className="w-px h-4 mx-1" style={{ background: 'rgba(255,255,255,0.08)' }} />

                {/* User menu */}
                <div className="relative">
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 rounded-lg transition-all"
                        style={{ background: menuOpen ? 'rgba(255,255,255,0.05)' : 'transparent' }}
                    >
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                            style={{ background: 'rgba(210,140,160,0.2)', color: 'rgba(210,140,160,0.9)', border: '1px solid rgba(210,140,160,0.2)' }}>
                            {session?.user?.name?.[0]?.toUpperCase() ?? 'U'}
                        </div>
                        <span className="text-xs text-white/60 hidden sm:block">
                            {session?.user?.name ?? 'User'}
                        </span>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            style={{ color: 'rgba(255,255,255,0.25)' }}>
                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>

                    {/* Dropdown */}
                    {menuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl overflow-hidden z-50"
                            style={{ background: '#1a1b1d', border: '1px solid rgba(255,255,255,0.08)' }}>
                            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                <p className="text-xs text-white/70 font-medium truncate">{session?.user?.name ?? 'User'}</p>
                                <p className="text-[10px] text-white/30 truncate mt-0.5">{session?.user?.email ?? ''}</p>
                            </div>
                            <div className="py-1 px-2">
                                {[
                                    { label: 'Profile', icon: '○', href: '/dashboard/profile', },
                                    // { label: 'Billing', icon: '◇' },
                                    { label: 'Settings', icon: '◈' , href: '/dashboard/settings',},
                                ].map((item) => (
                                    <Link key={item.label}
                                    href={item.href}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-xs text-left transition-all duration-150 rounded-lg"
                                    style={{ color: 'rgba(255,255,255,0.45)' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '11px' }}>{item.icon}</span>
                                    {item.label}
                                </Link>
                                ))}
                            </div>
                            <div className="py-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                <button
                                    onClick={() => signOut({ callbackUrl: '/' })}
                                    className="cursor-pointer w-full flex items-center gap-3 px-4 py-2 text-xs text-left transition-all"
                                    style={{ color: 'rgba(210,140,160,0.7)' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    Sign out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}