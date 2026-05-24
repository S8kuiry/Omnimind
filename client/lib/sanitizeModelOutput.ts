const THINK_TAGS = 'redacted_thinking|thinking|think'

const THINKING_OPEN = new RegExp(`<(${THINK_TAGS})>`, 'i')
const THINKING_CLOSE = new RegExp(`</(${THINK_TAGS})>`, 'i')
const PARTIAL_OPEN = new RegExp(`<(?:${THINK_TAGS})?$`, 'i')
const THINKING_BLOCK = new RegExp(`<(${THINK_TAGS})>[\\s\\S]*?</\\1>`, 'gi')

/** Remove completed reasoning / chain-of-thought blocks from model output. */
export function stripReasoningBlocks(text: string): string {
  return text
    .replace(THINKING_BLOCK, '')
    .replace(/<\|im_start\|>thinking[\s\S]*?<\|im_end\|>/gi, '')
    .trim()
}

/**
 * Incrementally strips reasoning tokens while streaming so thinking blocks
 * never reach the UI or saved message history.
 */
export function createStreamSanitizer() {
  let buffer = ''
  let insideThinking = false

  function push(chunk: string): string {
    buffer += chunk
    let output = ''

    while (buffer.length > 0) {
      if (insideThinking) {
        const close = THINKING_CLOSE.exec(buffer)
        if (close?.index !== undefined) {
          buffer = buffer.slice(close.index + close[0].length)
          insideThinking = false
          continue
        }
        const partialClose = buffer.lastIndexOf('</')
        if (partialClose >= 0 && partialClose > buffer.length - 24) {
          buffer = buffer.slice(partialClose)
        } else {
          buffer = ''
        }
        break
      }

      const open = THINKING_OPEN.exec(buffer)
      if (open?.index !== undefined) {
        output += buffer.slice(0, open.index)
        buffer = buffer.slice(open.index + open[0].length)
        insideThinking = true
        continue
      }

      const partial = PARTIAL_OPEN.exec(buffer)
      if (partial?.index !== undefined) {
        output += buffer.slice(0, partial.index)
        buffer = buffer.slice(partial.index)
        break
      }

      output += buffer
      buffer = ''
    }

    return output
  }

  function flush(): string {
    if (insideThinking) {
      buffer = ''
      insideThinking = false
      return ''
    }
    const rest = stripReasoningBlocks(buffer)
    buffer = ''
    return rest
  }

  return { push, flush }
}
