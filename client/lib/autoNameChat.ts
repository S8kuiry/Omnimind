/** Derive a short sidebar title from the first user message. */
export default async function autoNameChat(
  _chatId: string,
  firstMessage: string,
): Promise<string> {
  const cleaned = firstMessage.trim().replace(/\s+/g, ' ')
  if (!cleaned) return 'New Chat'
  if (cleaned.length <= 40) return cleaned
  return `${cleaned.slice(0, 37)}...`
}
