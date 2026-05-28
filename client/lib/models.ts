/** Single source of truth for chat LLM selection (must match backend ALLOWED_MODELS). */
export const DEFAULT_CHAT_MODEL = 'qwen/qwen3-32b'

export const CHAT_MODELS = [
  { id: 'qwen/qwen3-32b', name: 'Qwen3 32B — Smart (default)' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B — Powerful' },
  { id: 'qwen-qwq-32b', name: 'QwQ 32B — Deep Reasoning' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B — Fast' },
] as const

export const CHAT_MODEL_IDS = new Set(CHAT_MODELS.map((m) => m.id))

const storageKey = (chatId: string) => `omnimind-model-${chatId}`

export function resolveChatModel(saved: string | null | undefined): string {
  if (saved && CHAT_MODEL_IDS.has(saved as (typeof CHAT_MODELS)[number]['id'])) {
    return saved
  }
  return DEFAULT_CHAT_MODEL
}

/** Per-chat preference only — not saved to DB. Survives refresh via localStorage. */
export function loadChatModel(chatId: string): string {
  if (typeof window === 'undefined') return DEFAULT_CHAT_MODEL
  try {
    let saved = localStorage.getItem(storageKey(chatId))
    if (!saved) {
      const legacy = sessionStorage.getItem(storageKey(chatId))
      if (legacy) {
        saved = legacy
        localStorage.setItem(storageKey(chatId), legacy)
        sessionStorage.removeItem(storageKey(chatId))
      }
    }
    return resolveChatModel(saved)
  } catch {
    return DEFAULT_CHAT_MODEL
  }
}

export function saveChatModel(chatId: string, model: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey(chatId), model)
  } catch {
    // quota / private mode — in-memory state still works for this session
  }
}
