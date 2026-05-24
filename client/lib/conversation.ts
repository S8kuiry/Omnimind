/** Mirror backend conversational detection for history sizing. */
export function isConversational(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (
    /^\s*(hi|hello|hey|hiya|yo|sup|thanks?|thank\s*you|thx|ty|ok(?:ay)?|k|cool|nice|great|got\s*it|understood|bye|goodbye|see\s*ya|yes|no|yep|nope|sure|how\s+are\s+you|what'?s\s+up|good\s+(morning|afternoon|evening))\s*[!.?]*\s*$/i.test(
      t
    )
  ) {
    return true
  }
  return t.length <= 12 && !t.includes('?')
}

export function buildHistoryPayload(
  messages: { role: string; content: string }[],
  question: string
): { role: string; content: string }[] {
  const conversational = isConversational(question)
  const maxMessages = conversational ? 4 : 8
  const maxChars = conversational ? 300 : 600

  return messages
    .filter(m => m.content.trim() !== '')
    .slice(-maxMessages)
    .map(m => {
      let content = m.content.trim()
      if (content.length > maxChars) {
        content = content.slice(0, maxChars - 3).trimEnd() + '...'
      }
      return { role: m.role, content }
    })
}
