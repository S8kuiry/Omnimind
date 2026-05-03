import { v4 as uuidv4 } from 'uuid'




// generates a stable user_id per browser — persists across sessions
// when you add real auth later, swap this for the auth user ID
export function getUserId(): string {
    if (typeof window === 'undefined') return 'server'
    let id = localStorage.getItem('omnimind_user_id')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('omnimind_user_id', id)
    }
    return id
  }
  
  // store chat titles locally — like Claude's sidebar
  export function saveChatTitle(chatId: string, title: string) {
    const titles = getChatTitles()
    titles[chatId] = title
    localStorage.setItem('omnimind_chat_titles', JSON.stringify(titles))
  }
  
  export function getChatTitles(): Record<string, string> {
    if (typeof window === 'undefined') return {}
    try {
      return JSON.parse(localStorage.getItem('omnimind_chat_titles') || '{}')
    } catch { return {} }
  }

// ── User identity ──────────────────────────────────────────────

// export function getUserId(): string | undefined {
//     if (typeof window !== "undefined") {
//         return "server"
//     }
//     let id = localStorage.getItem("omnimind_user_id")
//     if (!id) {
//         id = uuidv4()
//         localStorage.setItem('omnimind_user_id', id)
//     }
//     return id

// }

// ── Chat session management ────────────────────────────────────
export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  hasMessages: boolean  // 👈 add this
}

export function createChat(): ChatMeta {
  const chat: ChatMeta = {
      id: uuidv4(),
      title: 'New Chat',
      createdAt: Date.now(),
      hasMessages: false  // 👈 starts hidden
  }
  const all = getAllChats()
  saveAllChats([chat, ...all])
  return chat
}

export function getRecentChats(): ChatMeta[] {
  return getAllChats()
      .filter(c => c.hasMessages)  // 👈 only show chats with messages
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
}

export function updateChatTitle(chatId: string, title: string) {
  const all = getAllChats()
  const updated = all.map(c =>
      c.id === chatId ? { ...c, title, hasMessages: true } // 👈 mark as visible
      : c
  )
  saveAllChats(updated)
  window.dispatchEvent(new Event('omnimind_chats_updated'))
}



function getAllChats(): ChatMeta[] {
    if (typeof window === 'undefined') return []
    try {
        return JSON.parse(localStorage.getItem('omnimind_chats') || '[]')
    } catch {
        return []
    }
}


function saveAllChats(chats: ChatMeta[]) {
    localStorage.setItem('omnimind_chats', JSON.stringify(chats))
}






export function getOrCreateDefaultChat(): ChatMeta {
    // returns the most recent chat if one exists
    // otherwise creates a brand new one
    // this is what the dashboard calls on load
    // const all = getAllChats()
    // if (all.length > 0) {
    //   // return most recent
    //   return all.sort((a, b) => b.createdAt - a.createdAt)[0]
    // }
    return createChat()
  }




export function deleteChat(chatId: string) {
    const all = getAllChats()
    saveAllChats(all.filter(c => c.id !== chatId))
    window.dispatchEvent(new Event('omnimind_chats_updated'))
}