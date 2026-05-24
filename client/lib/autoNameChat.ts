import { streamQuery } from './api'
import { getUserId, updateChatTitle } from './session'

// call Groq to generate a 4-word title from the first message
// runs silently in background — user never sees it happen
const userId =  getUserId()
export default async function autoNameChat(chatId: string, firstMessage: string) {
  try {
    const question = `Summarise this in 4 words or less, no punctuation: "${firstMessage}"`
    const res = await streamQuery(question, userId, chatId)
    const data = await res.json()
    const title = data.answer?.trim().slice(0, 40) || firstMessage.slice(0, 40)
    return title; // 👈 ADD THIS: Hand the string back to the caller
    updateChatTitle(chatId, title)
  } catch {
    // silently fail — title stays as "New Chat"
    updateChatTitle(chatId, firstMessage.slice(0, 40))
    return firstMessage.slice(0, 40)
  }
}
