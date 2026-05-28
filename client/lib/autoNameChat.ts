/** Derive a short sidebar title from the first user message. */
export default async function autoNameChat(
  _chatId: string,
  firstMessage: string,
): Promise<string> {
  const raw = firstMessage.trim()
  if (!raw) return 'New Chat'

  // Heuristics: avoid naming chats from pasted UI/code snippets (e.g. "<Layers ... />")
  const looksLikeCode =
    raw.startsWith('```') ||
    raw.startsWith('<') ||
    /^[\s`"'()[\]{}<>.,;:+\-_/\\|=&!*#]+/.test(raw)

  const withoutFences = raw
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/<[^>]+>/g, ' ') // JSX/HTML tags
    .replace(/\s+/g, ' ')
    .trim()

  const wordCount = withoutFences ? withoutFences.split(' ').length : 0

  // If user started with code/JSX (or too little natural language), keep a neutral title.
  if (looksLikeCode || wordCount < 3) return 'New Chat'

  const cleaned = withoutFences
  if (cleaned.length <= 40) return cleaned
  return `${cleaned.slice(0, 37)}...`
}
