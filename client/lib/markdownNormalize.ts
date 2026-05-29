import { stripReasoningBlocks } from './sanitizeModelOutput'

const KNOWN_FENCE_LANGS = [
  'powershell', 'javascript', 'typescript', 'markdown', 'python',
  'dockerfile', 'bash', 'shell', 'json', 'yaml', 'html', 'css', 'sql',
  'cmd', 'sh', 'zsh', 'txt', 'text',
]

function splitJammedFenceLang(tag: string): { lang: string; rest: string } | null {
  const lower = tag.toLowerCase()
  for (const lang of KNOWN_FENCE_LANGS) {
    if (lower.startsWith(lang) && tag.length > lang.length) {
      return { lang: tag.slice(0, lang.length), rest: tag.slice(lang.length) }
    }
  }
  return null
}

/** Collapse newlines that split table rows/cells across lines. */
export function joinBrokenTableCells(s: string): string {
  let t = s
  t = t.replace(/\|\s*\n+\s*\|/g, ' | | ')
  t = t.replace(/\|\s*\n+\s*\*\*/g, '| **')
  t = t.replace(/\*\*\s*\n+\s*([^*\n|]+?)\s*\*\*/g, '**$1**')
  return t
}

/** ## Title*italic subtitle* → ## Title + *subtitle*; clean lone * before --- */
export function fixStrayAsterisksAndSubtitles(s: string): string {
  let t = s
  // ## Road‑Map … Career*Designed for a 3rd‑year…*
  t = t.replace(
    /^(#{1,6}\s+[^\n*]+?)\*([^*\n]+?)\*/gm,
    (_, heading, subtitle) => {
      const sub = subtitle.replace(/\ba(\d)(rd|st|nd|th)\b/gi, 'a $1$2').trim()
      return `${heading.trim()}\n\n*${sub}*`
    },
  )
  // Prose after table glued with leading *: |*Pick one…*
  t = t.replace(/\|\s*\*([^*]+)\*\s*(?=\n)/g, '\n\n*$1*\n')
  // Lone * before horizontal rule
  t = t.replace(/\n\s*\*\s*\n+\s*---/g, '\n\n---')
  t = t.replace(/\n\s*\*\s*---/g, '\n\n---')
  t = t.replace(/^\s*\*\s*$/gm, '')
  t = t.replace(/\ba(\d)(rd|st|nd|th)\b/gi, 'a $1$2')
  t = stripOrphanBoldMarkers(t)
  return t
}

/**
 * Remove broken ** / * the model leaves visible (e.g. **Stack:***React, * *bullet, Node.js**).
 */
export function stripOrphanBoldMarkers(s: string): string {
  let t = s

  // **Label:***Value or **Label:****Value
  t = t.replace(/\*\*([^*\n]+?):\*\*\*+([A-Za-z0-9])/g, '**$1:** $2')
  t = t.replace(/\*\*([^*\n]+?):\*\*\s*\*+([A-Za-z0-9])/g, '**$1:** $2')

  // **Languages & Frameworks:***C++ (single * glued to closing **)
  t = t.replace(/\*\*([^*\n]+?):\*\*\*([^*\s\n])/g, '**$1:** $2')

  // Join bold split across lines: **\n\nNext.js15**
  t = t.replace(/\*\*\s*\n+\s*([^*\n]+?)\s*\*\*/g, '**$1**')

  // * *Engineered / * *Enterprise → list bullet
  t = t.replace(/^\s*\*\s+\*\s*/gm, '- ')
  t = t.replace(/\n\s*\*\s+\*\s*/g, '\n- ')

  // **Title**- ** or **Title**- detail
  t = t.replace(/(\*\*[^*\n]+\*\*)\s*-\s*\*\*/g, '$1\n\n- **')
  t = t.replace(/(\*\*[^*\n]+\*\*)\s*-\s+(?=[A-Za-z])/g, '$1\n\n- ')

  // Trailing orphan ** on label/value lines: **Stack:** … Node.js**
  t = t.replace(/^(- \*\*[^*\n]+:\*\*[^\n]*)\*\*\s*$/gm, '$1')
  t = t.replace(/([A-Za-z0-9.,/+#)])\*\*\s*$/gm, '$1')

  // "React.js**, **" → "React.js, "
  t = t.replace(/([A-Za-z0-9.+#\/]+)\*\*,\s*\*\*/g, '$1, ')
  t = t.replace(/,\s*\*\*\s*$/gm, '')

  // Orphan ** after colon or on empty lines
  t = t.replace(/:\s*\*\*\s*$/gm, ':')
  t = t.replace(/^\s*\*\*\s*$/gm, '')
  t = t.replace(/\*\*\s*\*\*/g, '')

  return t
}

/**
 * Enforce UI-safe formatting:
 * - No lines starting with "**", "--", "_" or "\--"
 * - Remove dangling "**" that appear mid-sentence like "Figma** ok"
 */
function enforceNoStrayFormattingTokens(s: string): string {
  let t = s

  // Remove forbidden line starts (keep indentation)
  t = t.replace(/^(\s*)(?:\\--+|--+|\*\*+|_+)\s*/gm, '$1')

  // Remove mid-line dangling bold closers like "Word** " or "Word**." (not paired)
  // This is intentionally conservative: only strips when "**" immediately follows a word/number.
  t = t.replace(/([A-Za-z0-9])\*\*(?=\s|[.,;:!?)]|$)/g, '$1')

  // User requirement: strip broken pipe+dash artifacts like "| - **Tools:**"
  t = t.replace(/\|\s*-\s*/g, '')

  return t
}

type ProtectedBlocks = {
  text: string
  blocks: string[]
}

/**
 * Protect fenced/inline code from markdown "repair" passes.
 * Many regex-based fixes are great for prose, but they can corrupt
 * code blocks produced by LLMs (especially when they contain `**`, `|`,
 * or unusual spacing).
 */
function protectCodeBlocks(input: string): ProtectedBlocks {
  let s = input
  const blocks: string[] = []

  // 1) Fenced code blocks ```...```
  s = s.replace(/```[\s\S]*?```/g, (m: string) => {
    const id = blocks.length
    blocks.push(m)
    return `@@OMNI_CODEBLOCK_${id}@@`
  })

  // 1b) Incomplete fenced block (common while streaming):
  // If there's an unmatched ``` left, protect from the last fence to end.
  const fenceCount = (s.match(/```/g) || []).length
  if (fenceCount % 2 === 1) {
    const last = s.lastIndexOf('```')
    if (last >= 0) {
      const tail = s.slice(last)
      const id = blocks.length
      blocks.push(tail)
      s = s.slice(0, last) + `@@OMNI_CODEBLOCK_${id}@@`
    }
  }

  // 2) Inline code `...` (keep it single-line)
  s = s.replace(/`[^`\n]+`/g, (m: string) => {
    const id = blocks.length
    blocks.push(m)
    return `@@OMNI_CODEBLOCK_${id}@@`
  })

  return { text: s, blocks }
}

function restoreCodeBlocks(input: string, blocks: string[]): string {
  let s = input
  for (let i = 0; i < blocks.length; i++) {
    s = s.replaceAll(`@@OMNI_CODEBLOCK_${i}@@`, blocks[i])
  }
  return s
}

function looksLikeLetter(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (t.length < 180) return false
  const hasGreeting =
    // Dear [Recipient], Dear Sir/Madam, Dear John,
    /\bdear\s+\[[^\]\n]{2,40}\]/i.test(text) ||
    /\bdear\s+[A-Za-z][A-Za-z.\- ]{1,40},/i.test(text) ||
    /\bdear\s+(sir|madam|principal|hod|prof|manager)\b/i.test(text)
  const hasSubject = /\bsubject\s*:/i.test(text) || /\bsub\s*:/i.test(text)
  const hasClosing =
    /\bbest regards\b/i.test(text) ||
    /\bregards\b/i.test(text) ||
    /\bsincerely\b/i.test(text) ||
    /\bthank you\b/i.test(text)
  return (hasGreeting && hasSubject) || (hasGreeting && hasClosing) || (hasSubject && hasClosing)
}

/**
 * Format jammed formal letters into readable paragraphs.
 * Intentionally conservative and only triggers when text looks like a letter.
 */
function formatLetterLikeProse(s: string): string {
  if (!looksLikeLetter(s)) return s
  let t = s

  // If a heading is glued to "Dear ..." (common LLM output), split it.
  // Example: "## Request ... (No C)Dear [Recipient],I am writing..."
  t = t.replace(/^(#{1,6}[^\n]{8,240}?)(Dear\b)/gm, '$1\n\n$2')
  // If "Dear" starts immediately after heading text without a space.
  t = t.replace(/(#{1,6}[^\n]{8,240}?)\s*(Dear\b)/g, '$1\n\n$2')

  // Ensure Subject starts on its own line
  t = t.replace(/,\s*(subject\s*:)/gi, ',\n\n$1')
  t = t.replace(/(dear[^\n]{2,80}?),\s*(subject\s*:)/gi, '$1,\n\n$2')

  // If the greeting is glued to the first sentence, break after the comma.
  t = t.replace(/(Dear[^\n]{2,80}?),\s*(I am writing|I’m writing|This is to|With reference|Regarding)\b/g, '$1,\n\n$2')
  // If comma is missing: "Dear [Recipient] I am writing..." or "Dear [Recipient],I am..."
  t = t.replace(/(Dear[^\n]{2,80}\])\s*(I am writing|I’m writing|This is to|With reference|Regarding)\b/g, '$1,\n\n$2')
  t = t.replace(/(Dear[^\n]{2,80}),\s*(I am writing|I’m writing|This is to|With reference|Regarding)\b/g, '$1,\n\n$2')

  // Add a newline after Subject line if it's glued to the body
  t = t.replace(
    /(subject\s*:[^\n]{4,140})(\s+)(i am|this is|with reference|respectfully|i hereby)\b/gi,
    '$1\n\n$3',
  )

  // Paragraph breaks before common transition phrases (handle missing space after punctuation too)
  t = t.replace(/([.?!])\s*(During my internship,)\b/g, '$1\n\n$2')
  t = t.replace(/\s+(During my internship,)\b/g, '\n\n$1')
  t = t.replace(
    /\s+(I believe that|I believe this|I request you to|I would greatly appreciate|I would appreciate|I am pleased to inform you that)\b/g,
    '\n\n$1',
  )
  t = t.replace(/([.?!])\s*(Thank you for your time and consideration\.)/gi, '$1\n\n$2')
  t = t.replace(/\s+(Thank you for your time and consideration\.)/gi, '\n\n$1')
  t = t.replace(/([.?!])\s*(Thank you for considering my request\.)/gi, '$1\n\n$2')
  t = t.replace(/\s+(Thank you for considering my request\.)/gi, '\n\n$1')

  // Closing and signature blocks
  t = t.replace(/([.?!])\s*(Best regards,?)/gi, '$1\n\n$2')
  t = t.replace(/([.?!])\s*(Sincerely,?)/gi, '$1\n\n$2')
  t = t.replace(/([.?!])\s*(Yours faithfully,?)/gi, '$1\n\n$2')
  t = t.replace(/\s+(Best regards,?)\s*/gi, '\n\n$1\n')
  t = t.replace(/\s+(Sincerely,?)\s*/gi, '\n\n$1\n')
  t = t.replace(/\s+(Yours faithfully,?)\s*/gi, '\n\n$1\n')

  // Fix missing spaces after "on" + date (on19th → on 19th)
  t = t.replace(/\bon(\d{1,2}(st|nd|rd|th)\b)/gi, 'on $1')
  t = t.replace(/\bon(\d{1,2}\s+[A-Za-z]+\b)/gi, 'on $1')
  t = t.replace(/\btill(\d{1,2}(st|nd|rd|th)\b)/gi, 'till $1')
  t = t.replace(/\btill(\d{1,2}\s+[A-Za-z]+\b)/gi, 'till $1')

  // Ensure "Subject:" is consistently capitalized
  t = t.replace(/\bsubject\s*:/gi, 'Subject:')

  // Clean excessive whitespace
  t = t.replace(/[ \t]+$/gm, '')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

/**
 * Make long “letter/resume” paragraphs readable:
 * - Break `[X][Y]` into separate blocks
 * - Convert leading `| ... | ... |` contact lines into normal text
 * - Fix common missing spaces (Next.js15, Java17, NameCity → Name City)
 */
function repairJammedProseBlocks(s: string): string {
  let t = s

  // [Date][Hiring Manager] → on separate lines
  t = t.replace(/\]\s*\[/g, ']\n[')

  // Lines that start with a pipe and look like contact rows → drop pipes
  t = t.replace(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/gm, (_, a, b, c) => {
    const row = `${String(a).trim()} • ${String(b).trim()} • ${String(c).trim()}`
    return row.replace(/\s+/g, ' ').trim()
  })

  // Any remaining leading/trailing pipes that aren’t real tables
  t = t.replace(/^\|\s*/gm, '')
  t = t.replace(/\s*\|\s*$/gm, '')

  // Fix common “wordNumber” glue: Next.js15 → Next.js 15, Java17 → Java 17
  t = t.replace(/([A-Za-z.])(\d{2,4})(?=\b)/g, '$1 $2')

  // Fix glued words: "KuiryKolkata" → "Kuiry Kolkata" (camel-case boundary)
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2')

  // Phone followed immediately by bracket blocks → new paragraph
  t = t.replace(/(\+?\d[\d\s-]{7,}\d)\s*(?=\[)/g, '$1\n\n')

  return t
}

/** Split headings glued to prior text or section numbers: Student###1. or ###2. */
export function fixGluedHeadings(s: string): string {
  let t = s
  // ## OverviewYou are → ## Overview + paragraph
  t = t.replace(
    /(#{2,3}\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)([A-Z][a-z])/g,
    '$1$2\n\n$3',
  )
  t = t.replace(/([a-zA-Z0-9])(#{1,6})(\d+\.)/g, '$1\n\n$2 $3')
  t = t.replace(/(#{1,6})(\d+\.)/g, '$1 $2')
  t = t.replace(/(#{1,6}\s+[^#\n|]{3,80})(#{1,6}\s)/g, '$1\n\n$2')
  t = t.replace(/([.!?)])(\s*#{1,6}\s*\d+\.)/g, '$1\n\n$2')
  t = t.replace(/(#{1,6}\s+[^*\n]+)\*\*\s*$/gm, '$1')
  t = t.replace(/(#{1,6}\s+[^*\n]+)\*\*(?=\s*[-*]|\s*$)/g, '$1')
  return t
}

/** Repair broken bold, headings glued to lists, newlines inside table cells. */
export function fixMalformedBoldAndHeadings(s: string): string {
  let t = s
  t = t.replace(/\|\s*\*\*\s*\n+\s*/g, '| **')
  t = t.replace(/\s*\n+\s*\*\*\s*\|/g, '** |')
  t = t.replace(/:\s*-\s*\*\*(?=\s|$)/g, ':\n\n-')
  t = t.replace(/-\s*\*\*\s*(?=\n)/g, '-')
  // #### **1. Title**- **  →  #### 1. Title
  t = t.replace(/(#{1,6}\s+)\*\*(\d+\.\s+[^*]+?)\*\*-\s*\*\*/g, '$1$2\n\n')
  t = t.replace(/(#{1,6}\s+)\*\*([^*]+?)\*\*-\s*\*\*/g, '$1$2\n\n')
  t = t.replace(/(#{1,6}\s+)\*\*([^*]+?)\*\*/g, '$1$2')
  t = t.replace(/(\*\*[^*\n]+\*\*)-\s*\*\*/g, '$1\n\n')
  t = t.replace(/(\*\*[^*\n]+\*\*)(\d+\.\s+\*\*)/g, '$1\n\n$2')
  t = t.replace(/(#{1,6}\s+[^*\n]+)(\d+\.\s+\*\*)/g, '$1\n\n$2')
  t = t.replace(/\*\*\s*\n+\s*([^*\n]+?):\s*\*\*/g, '**$1:**')
  t = t.replace(/([A-Za-z0-9 /]+)\*\*:\s*-\s+\*\*/g, '**$1:**\n\n- **')
  t = t.replace(/([🚁✈️🔧!?.\w])\s*\|\s*$/gm, '$1')
  return t
}

/** Merge consecutive pipe-lines into one line (table rows split across newlines). */
export function mergePipeLines(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let buf = ''

  const flush = () => {
    if (!buf) return
    out.push(buf.replace(/\s+/g, ' ').trim())
    buf = ''
  }

  for (const line of lines) {
    const t = line.trim()
    const isPipe = t.includes('|') && !/^#{1,6}\s/.test(t)
    if (isPipe) {
      buf += (buf ? ' ' : '') + t
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out.join('\n')
}

/** Convert model HTML fragments to markdown-friendly text. */
export function stripHtmlToMarkdown(raw: string): string {
  let s = raw
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/p>\s*/gi, '\n\n')
  s = s.replace(/<\/li>\s*<li[^>]*>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '\n- ')
  s = s.replace(/<\/li>/gi, '\n')
  s = s.replace(/<\/?ul[^>]*>/gi, '\n')
  s = s.replace(/<\/?ol[^>]*>/gi, '\n')
  s = s.replace(/<\/?p[^>]*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  return s
}

function cellCount(line: string): number {
  const t = line.trim()
  if (!t.includes('|')) return 0
  return t.split('|').filter(c => c.trim().length > 0).length
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return /^[\s\-:|]+$/.test(t) && line.includes('-')
}

function normalizeTableRow(row: string): string {
  let r = row.trim()
  if (!r.startsWith('|')) r = `| ${r}`
  if (!r.endsWith('|')) r = `${r} |`
  return r.replace(/\|\s*\|/g, '| |')
}

function separatorForColumns(n: number): string {
  return `| ${Array(Math.max(n, 2)).fill('---').join(' | ')} |`
}

/** Parse guides where the model glues Step|Action|Tip rows on one line. */
function parseStepGuideMegaLine(line: string): string | null {
  if ((line.match(/\|/g) || []).length < 8) return null
  if (!/\| Step \|/i.test(line) && !/️⃣|🔟|🚀/.test(line)) return null

  const parts: string[] = []
  const title = line.match(/\|\s*(#{1,6}\s+[^|]+)\s*\|/)
  if (title) parts.push(title[1].trim(), '')

  const rowRe =
    /\*\*((?:[1-9]️⃣|🔟|🚀)[^*]+)\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)(?=\s*\|\s*\*\*|\s*\|\s*\||$)/g
  let match: RegExpExecArray | null
  let count = 0
  while ((match = rowRe.exec(line)) !== null) {
    const step = `**${match[1].trim()}**`
    const action = match[2].trim()
    const tip = match[3].trim()
    if (!action || /^-+$/.test(action)) continue
    const block = [`### ${step}`, '', action]
    if (tip.trim()) block.push('', `> **Tip:** ${tip}`)
    parts.push(block.join('\n'))
    count++
  }
  return count > 0 ? parts.join('\n\n') : null
}

/** Parse 2-column price / budget tables jammed on one line. */
function parsePriceTableMegaLine(line: string): string | null {
  const isPrice =
    /\| Part \|/i.test(line) ||
    /\| Component \|/i.test(line) && /Cost|Price|USD/i.test(line) ||
    /Budget Breakdown/i.test(line) ||
    /Estimated Cost/i.test(line)
  if (!isPrice) return null
  if ((line.match(/\|/g) || []).length < 6) return null

  const out: string[] = []
  const title =
    line.match(/\|\s*(#{1,6}\s+\*\*[^|]*\*\*)\s*\|/i) ||
    line.match(/\|\s*(#{1,6}\s+[^|]+)\s*\|/)
  if (title) out.push(title[1].replace(/\*\*/g, '').trim(), '')

  const rowRe =
    /\|\s*\*?\*?([^|*]+?)\*?\*?\s*\|\s*(\$[^|]+?|\*\*[^|]+?\*\*)\s*(?=\s*\|\s*(?:\*?\*?[^|*]+\*?\*?\s*\||#{1,6}|---)|$)/gi
  const rows: string[] = []
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(line)) !== null) {
    let name = match[1].trim().replace(/\*\*/g, '')
    const price = match[2].trim()
    if (/^Component$/i.test(name) || /^Estimated/i.test(name) || /^-+$/.test(name.replace(/\s/g, '')))
      continue
    if (/Budget Breakdown/i.test(name)) continue
    if (!price.includes('$') && !/total/i.test(name)) continue
    rows.push(`| ${name} | ${price} |`)
  }
  if (rows.length === 0) return null
  const col1 = /Component/i.test(line) ? 'Component' : 'Item'
  out.push(`| ${col1} | Estimated Cost (USD) |`, '| --- | --- |', ...rows)
  return out.join('\n')
}

/** Split one physical line that contains many table rows glued with ` | | `. */
function splitMegaPipeLine(line: string): string[] {
  const stepGuide = parseStepGuideMegaLine(line)
  if (stepGuide) return stepGuide.split('\n')
  const priceTable = parsePriceTableMegaLine(line)
  if (priceTable) return priceTable.split('\n')
  const pipeCount = (line.match(/\|/g) || []).length
  if (pipeCount < 6) return [line]

  let s = line.trim()
  const out: string[] = []

  const headInTable = s.match(/^\|\s*(#{1,6}\s+[^|]+)\s*\|([\s\S]*)$/)
  if (headInTable) {
    out.push(headInTable[1].trim())
    out.push('')
    s = `|${headInTable[2]}`
  }

  const segments = s.split(/\s\|\s+\|/)
  for (let seg of segments) {
    seg = seg.trim()
    if (!seg) continue

    const subHead =
      seg.match(/^(#{1,6}\s+[^|]+)\s*\|([\s\S]*)$/) ||
      seg.match(/^\|\s*(#{1,6}\s+[^|]+)\s*\|([\s\S]*)$/)
    if (subHead) {
      out.push('', subHead[1].trim(), '')
      seg = subHead[2].trim()
    }

    if (!seg.startsWith('|')) seg = `| ${seg}`
    if (!seg.endsWith('|')) seg = `${seg} |`

    if (isSeparatorRow(seg)) {
      const cols = Math.max(2, (seg.match(/-+/g) || []).length)
      out.push(separatorForColumns(cols))
    } else {
      out.push(normalizeTableRow(seg))
    }
  }

  return out.length ? out : [line]
}

/** Unwrap documents where the model put everything inside pipe-delimited mega lines. */
export function unwrapMegaPipeLines(text: string): string {
  return text
    .split('\n')
    .flatMap(line => {
      const pipes = (line.match(/\|/g) || []).length
      if (pipes >= 6) return splitMegaPipeLine(line)
      return [line]
    })
    .join('\n')
}

function parseRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
}

function parseTableBlock(lines: string[]): { header: string[]; body: string[][] } | null {
  if (lines.length < 2) return null
  let headerIdx = 0
  let sepIdx = 1
  if (isSeparatorRow(lines[0])) return null
  if (!isSeparatorRow(lines[1])) {
    // no separator — treat first row as header only if we have 2+ data lines
    if (lines.length < 3) return null
    sepIdx = -1
  }
  const header = parseRow(lines[headerIdx])
  const bodyStart = sepIdx >= 0 ? sepIdx + 1 : 1
  const body = lines
    .slice(bodyStart)
    .filter(l => !isSeparatorRow(l))
    .map(parseRow)
    .filter(row => !row.every(c => /^-+$/.test(c.replace(/\s/g, ''))))
  if (header.length < 2 || body.length === 0) return null
  if (header.every(c => /^-+$/.test(c.replace(/\s/g, '')))) return null
  return { header, body }
}

/** 3-column component spec tables → spec cards. */
function componentSpecTableToCards(lines: string[]): string | null {
  const parsed = parseTableBlock(lines)
  if (!parsed) return null
  const h = parsed.header.map(x => x.toLowerCase())
  if (!h.some(c => c.includes('component'))) return null
  if (h.some(c => c.includes('cost') || c.includes('price'))) return null

  const cards: string[] = []
  for (const row of parsed.body) {
    const name = (row[0] || '').replace(/\*\*/g, '').trim()
    if (!name || /^-+$/.test(name)) continue
    const notes = row[1] || ''
    const examples = row[2] || ''
    cards.push(
      `#### ${name}\n\n**Key notes:** ${notes}\n\n**Examples:** ${examples}`,
    )
  }
  return cards.length > 0 ? cards.join('\n\n') : null
}

function isTimelineRowLabel(cell: string): boolean {
  const t = cell.trim()
  return /^\*\*[\d‑\-–\s]+\*\*$/.test(t) || /^[\d‑\-–]+$/.test(t.replace(/\*\*/g, ''))
}

function isTimelineTable(header: string[], body: string[][]): boolean {
  const h = header.map(x => x.toLowerCase())
  if (h.some(c => c.includes('month')) && h.some(c => c.includes('goal'))) return true
  if (body.length > 0 && body.every(row => isTimelineRowLabel(row[0] || ''))) return true
  return false
}

/** 3-column "Step | What | Tips" tables → readable step sections (not broken GFM tables). */
function stepTableToCards(lines: string[]): string | null {
  const parsed = parseTableBlock(lines)
  if (!parsed) return null
  const { header, body } = parsed
  if (isTimelineTable(header, body)) return null

  const h = header.map(x => x.toLowerCase())
  const isStepTable =
    h.some(c => c.includes('step')) &&
    (h.some(c => c.includes('tip')) || h.some(c => c.includes('key')))
  const looksLikeSteps = body.some(row => {
    const c0 = row[0] || ''
    if (isTimelineRowLabel(c0)) return false
    return /[1-9]️⃣|🔟|🚀/.test(c0)
  })
  if (!isStepTable && !looksLikeSteps) return null
  if (header.every(c => /^-+$/.test(c.replace(/\s/g, '')))) return null

  const cards: string[] = []
  for (const row of body) {
    const title = row[0] || 'Step'
    const action = row[1] || ''
    const tip = (row[2] || '').trim()
    const parts = [`### ${title}`, '', action]
    if (tip) parts.push('', `> **Tip:** ${tip}`)
    cards.push(parts.join('\n'))
  }
  return cards.join('\n\n')
}

export function repairBrokenTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.includes('|')) {
      out.push(line)
      i++
      continue
    }

    const block: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (l.includes('|')) {
        block.push(l.trim())
        i++
      } else if (l.trim() === '' && block.length > 0) {
        i++
        break
      } else {
        break
      }
    }

    const cards =
      stepTableToCards(block) ||
      componentSpecTableToCards(block)
    if (cards) out.push(cards)
    else out.push(...mergeTableBlock(block))

    if (i < lines.length && lines[i].trim() === '') {
      out.push('')
      i++
    }
  }

  return out.join('\n')
}

function mergeTableBlock(lines: string[]): string[] {
  if (lines.length === 0) return []

  const merged: string[] = []
  let buf = ''

  const flushBuf = () => {
    if (!buf) return
    merged.push(normalizeTableRow(buf))
    buf = ''
  }

  for (const line of lines) {
    if (isSeparatorRow(line)) {
      flushBuf()
      const cols = Math.max(2, (line.match(/-+/g) || []).length)
      merged.push(separatorForColumns(cols))
      continue
    }

    const complete =
      line.trimEnd().endsWith('|') &&
      (line.match(/\|/g) || []).length >= 2 &&
      cellCount(line) >= 2

    if (!buf) {
      buf = line
      if (complete) flushBuf()
      continue
    }

    const bufComplete = buf.trimEnd().endsWith('|') && cellCount(buf) >= 2

    if (bufComplete && complete) {
      flushBuf()
      buf = line
      if (complete) flushBuf()
    } else {
      const left = buf.replace(/\|\s*$/, '').trimEnd()
      const right = line.replace(/^\|/, '|').trim()
      buf = `${left} ${right.startsWith('|') ? right : `| ${right}`}`.replace(/\s+\|/g, ' |')
      if (buf.trimEnd().endsWith('|') && cellCount(buf) >= 2) flushBuf()
    }
  }
  flushBuf()

  if (merged.length >= 2 && !isSeparatorRow(merged[1])) {
    const cols = cellCount(merged[0])
    if (cols >= 2) merged.splice(1, 0, separatorForColumns(cols))
  }

  return merged
}

/** Model often emits "including:* Item" or "include:* Item" on one line — fix to real lists. */
export function fixInlineStarBullets(s: string): string {
  let t = s
  t = t.replace(/:\s*\*\s+(?=[A-Z])/g, ':\n\n- ')
  t = t.replace(/;\s*\*\s+(?=[A-Z])/g, ';\n\n- ')
  t = t.replace(/,\s*\*\s+(?=[A-Z])/g, ',\n\n- ')
  t = t.replace(/([^\n*])\*\s+(?=[A-Z])/g, '$1\n\n- ')
  t = t.replace(/\n-\s+([^*\n]+)\*\s+/g, '\n- $1\n\n- ')
  t = t.replace(/including:\s*\n\n-\s*/gi, 'including:\n\n- ')
  t = t.replace(/include:\s*\n\n-\s*/gi, 'include:\n\n- ')
  t = t.replace(/(highlights[^:]*):(?=\S)/gi, '$1:\n\n')
  t = t.replace(/June(\d{4})/g, 'June $1')
  return t
}

/** Fix prose sections jammed into one line after a heading (no newline before list). */
function fixJammedSections(text: string): string {
  let s = fixInlineStarBullets(text)
  s = s.replace(/([a-zA-Z)])(\d+\.\s+\*\*)/g, '$1\n\n$2')
  s = s.replace(/([a-zA-Z)])(-\s+\*\*)/g, '$1\n\n$2')
  s = s.replace(/\)(<?https?:\/\/)/g, ') $1')
  s = s.replace(/\*\s*\*([^*]+):\*\*/g, '**$1:**')
  // "Checklist**: - Battery" → proper list
  s = s.replace(/(\*\*Checklist\*\*):\s*-/gi, '$1\n\n-')
  s = s.replace(/(\*\*[^*]+\*\*):\s*-\s+(?=[A-Z])/g, '$1\n\n- ')
  // "Use Case**: - **Racing**" on same line
  s = s.replace(/(\*\*[^*]+:\*\*)\s*-\s+\*\*/g, '$1\n\n- **')
  // "**Resume Tips**- One page"
  s = s.replace(/\*\*([^*]+)\*\*\s*-\s+(?=[A-Z])/g, '**$1**\n\n')
  return s
}

/** Find component spec rows anywhere in the doc and replace the broken table block. */
function replaceComponentTablesWithCards(s: string): string {
  if (!/\|?\s*Component\s*\|?\s*Key Notes/i.test(s.replace(/\n/g, ' '))) return s

  const blockMatch = s.match(
    /(\|?\s*Component\s*\|?\s*Key Notes[\s\S]*?)(?=\n####\s*3\.|\n#{1,6}\s*3\.\s*Assembly|\n####\s*Assembly|$)/i,
  )
  if (!blockMatch) return s

  const flat = blockMatch[1].replace(/\n/g, ' ')
  const cards: string[] = []
  // Row boundary: "| | **Frame" OR "| **Motors" (single pipe before bold name)
  const chunks = flat.split(/\|\s+(?:\|\s*)?\*\*(?=[\dA-Za-z(])/).slice(1)

  for (const chunk of chunks) {
    const close = chunk.indexOf('**')
    if (close < 0) continue
    const name = chunk.slice(0, close).trim()
    if (!name || /^-+$/.test(name) || /Component/i.test(name)) continue
    const cells = chunk
      .slice(close + 2)
      .split('|')
      .map(c => c.trim())
      .filter(Boolean)
    if (cells.length < 2) continue
    cards.push(
      `#### ${name}\n\n**Key notes:** ${cells[0]}\n\n**Examples:** ${cells[cells.length - 1]}`,
    )
  }

  if (cards.length === 0) return s

  return s.replace(blockMatch[1], `${cards.join('\n\n')}\n\n`)
}

/** Extract budget / price rows and emit a clean 2-column table. */
function replaceBudgetTables(s: string): string {
  if (!/Budget Breakdown|Estimated Cost/i.test(s)) return s

  const budgetMatch = s.match(
    /(\|?\s*#{0,6}\s*\*?\*?6\.\s*Budget Breakdown[\s\S]*?)(?=---\s*Need help|---Need help|\n---\n\nNeed help|$)/i,
  )
  if (!budgetMatch) return s

  const flat = budgetMatch[1].replace(/\n/g, ' ')
  const rows: string[] = []
  for (const seg of flat.split(/\s\|\s+\|/).map(x => x.trim()).filter(Boolean)) {
    if (seg.includes('------') || /Budget Breakdown/i.test(seg)) continue
    const cells = seg.replace(/^\|/, '').split('|').map(c => c.trim()).filter(Boolean)
    if (cells.length < 2) continue
    const name = cells[0].replace(/\*\*/g, '').trim()
    const price = cells[cells.length - 1].trim()
    if (/^Component$/i.test(name) || /^Estimated/i.test(name)) continue
    if (!price.includes('$') && !/total/i.test(name)) continue
    rows.push(`| ${name} | ${price} |`)
  }
  if (rows.length === 0) return s

  const title =
    flat.match(/#{1,6}\s*\*?\*?6\.\s*Budget Breakdown\*?\*?/i) ||
    flat.match(/#{1,6}\s+[^|]*Budget[^|]*/i)

  const table = [
    title ? `#### ${title[0].replace(/^#{1,6}\s*\*?\*?/, '').replace(/\*\*/g, '').trim()}` : '#### Budget Breakdown',
    '',
    '| Component | Estimated Cost (USD) |',
    '| --- | --- |',
    ...rows,
  ].join('\n')

  return s.replace(budgetMatch[1], `${table}\n\n`)
}

type TableBlockConfig = {
  header: RegExp
  until: RegExp
  colLabels: string[]
  twoColumn?: boolean
}

function rowsFromMegaTable(flat: string, skipNames: RegExp): { name: string; cells: string[] }[] {
  const rows: { name: string; cells: string[] }[] = []
  const chunks = flat.split(/\|\s+(?:\|\s*)?\*\*(?=[\d*A-Za-z(])/).slice(1)
  for (const chunk of chunks) {
    const close = chunk.indexOf('**')
    if (close < 0) continue
    const name = chunk.slice(0, close).trim()
    if (!name || /^-+$/.test(name) || skipNames.test(name)) continue
    const cells = chunk
      .slice(close + 2)
      .split('|')
      .map(c => c.trim())
      .filter(Boolean)
    if (cells.length < 1) continue
    rows.push({ name: `**${name}**`, cells })
  }
  return rows
}

function replaceOneMegaTableBlock(s: string, cfg: TableBlockConfig): string {
  if (!cfg.header.test(s.replace(/\n/g, ' '))) return s

  const startIdx = s.search(cfg.header)
  if (startIdx < 0) return s
  const rest = s.slice(startIdx)
  const endRel = rest.search(cfg.until)
  const block = endRel > 0 ? rest.slice(0, endRel) : rest

  const flat = block.replace(/\n/g, ' ')
  const skipNames = /^(Role|Project Idea|Certificate|Month|Component|Part|Key Notes|Typical|Core CSE|Estimated|Provider|Relevance|Goal|What to|Key Techn)/i
  const rows = rowsFromMegaTable(flat, skipNames)
  if (rows.length === 0) return s

  if (cfg.twoColumn) {
    const table = [
      '| Month | Goal |',
      '| --- | --- |',
      ...rows.map(r => `| ${r.name} | ${r.cells[0] ?? ''} |`),
    ].join('\n')
    return s.replace(block, `${table}\n\n`)
  }

  const cards = rows.map(r => {
    const lines = [`#### ${r.name.replace(/\*\*/g, '')}`]
    cfg.colLabels.forEach((label, i) => {
      if (r.cells[i]) lines.push('', `**${label}:** ${r.cells[i]}`)
    })
    return lines.join('\n')
  })

  return s.replace(block, `${cards.join('\n\n')}\n\n`)
}

/** Role / project / cert / timeline mega-tables in career-style guides. */
function replaceCareerGuideTables(s: string): string {
  const configs: TableBlockConfig[] = [
    {
      header: /\| (?:Role|Drone‑related career|Drone-related career) \|/i,
      until: /#{1,6}\s*2\.|###\s*2\.|###2\.|Core Technical/i,
      colLabels: ['Typical skills', 'Why it fits'],
    },
    {
      header: /\| Project Idea \|/i,
      until: /#{1,6}\s*4\.|###\s*4\.|###4\.|Certifications/i,
      colLabels: ['Technologies', 'Showcase'],
    },
    {
      header: /\| Certificate \|/i,
      until: /#{1,6}\s*5\.|###\s*5\.|###5\.|Internships/i,
      colLabels: ['Provider', 'Relevance'],
    },
    {
      header: /\| Month \|/i,
      until: /#{1,6}\s*8\.|###\s*8\.|Timeline \(next|\*\*Bottom line|Bottom line:/i,
      colLabels: ['Goal'],
      twoColumn: true,
    },
  ]

  let out = s
  for (const cfg of configs) {
    out = replaceOneMegaTableBlock(out, cfg)
  }
  return out
}

/** Section 8 timeline wrongly turned into ### **0-2** headings with empty tip boxes. */
function fixBrokenTimelineSection(s: string): string {
  const sec = s.match(
    /(#{1,6}\s*\d*\.?\s*Timeline[^\n]*\n)([\s\S]*?)(?=\n\*\*Bottom line|\*\*Bottom line:|$)/i,
  )
  if (!sec) return s

  const rowRe =
    /#{1,3}\s+\*\*([\d‑\-–]+)\*\*\s*\n+([\s\S]*?)(?=\n+#{1,3}\s+\*\*[\d‑\-–]|\n\*\*Bottom line|$)/g
  const rows: string[] = []
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(sec[2])) !== null) {
    const goal = m[2].replace(/\n+>\s*\*\*Tip:\*\*\s*/g, '').trim()
    if (!goal) continue
    rows.push(`| **${m[1].trim()}** | ${goal} |`)
  }
  if (rows.length === 0) return stripEmptyTipBlockquotes(s)

  const table = ['| Month | Goal |', '| --- | --- |', ...rows].join('\n')
  const cleaned = `${sec[1]}${table}\n\n`
  return stripEmptyTipBlockquotes(s.replace(sec[0], cleaned))
}

/** Remove tip callouts that have no body (leftover from bad table conversion). */
export function stripEmptyTipBlockquotes(s: string): string {
  return s
    .replace(/^\s*>\s*\*\*Tip:\*\*\s*$/gim, '')
    .replace(/\n\s*>\s*\*\*Tip:\*\*\s*(?=\n|$)/g, '\n')
    .replace(/\n+>\s*\*\*Tip:\*\*\s*(?=\n+#{1,3}|\n+###|\n+\*\*Bottom|\n*$)/g, '\n')
    .replace(/\n+>\s*\*\*Tip:\*\*\s*\n/g, '\n')
    .replace(/>\s*\*\*Tip:\*\*\s*\|/g, '')
    .replace(/#{1,3}\s+\*?\*?[\d‑\-–]+\*?\*?\s*\n+[\s\S]*?>\s*\*\*Tip:\*\*\s*\n+/g, '\n')
}

/** Drop orphan "1." / "2." lines with no list content. */
export function stripOrphanListNumbers(s: string): string {
  return s.replace(/^\s*\d+\.\s*$(\r?\n)?/gm, '')
}

/** Join bold markers split across lines: "PX4, **\n\nArduPilot**". */
export function repairSplitBoldMarkers(s: string): string {
  let t = s
  t = t.replace(/,\s*\*\*\s*\n+\s*([^*\n]+?)\*\*/g, ', **$1**')
  t = t.replace(/\*\*,\s*\*\*\s*\n+\s*([^*\n]+?)\*\*/g, ', **$1**')
  t = t.replace(/-\s+\*\*\s*\n+\s*([^*\n]+?)\*\*/g, '- **$1**')
  t = t.replace(/:\s*\*\*\s*\n+\s*([^*\n]+?)\*\*/g, ': **$1**')
  t = t.replace(/\*\*\s*\n+\s*([^*\n]+?)\*\*/g, '**$1**')
  t = t.replace(/\*\*([^*,\n]+),\s*\*\*\s+([^*\n]+)\*\*/g, '**$1**, **$2**')
  t = t.replace(/([A-Za-z0-9)])\s+\*\*\s*$(?=\n)/gm, '$1')
  t = t.replace(/\s+\*\*\s*$(?=\n)/gm, '')
  return t
}

/**
 * Universal cleanup for messy markdown from any LLM (split **, * *, jammed dates, etc.).
 */
export function repairUniversalModelMarkdown(s: string): string {
  let t = s

  // Phone/value glued to next bullet: "+917980647151- **"
  t = t.replace(/(\+?\d[\d\s-]{7,}\d)\s*-\s*\*\*/g, '$1\n\n- **')
  // Project line breaks: "Platform\n* *Custom" → bullet
  t = t.replace(/\n\* \*([A-Za-z])/g, '\n- $1')
  // **Stack:***React → **Stack:** React
  t = t.replace(/\*\*Stack:\*\*\*([A-Za-z])/gi, '**Stack:** $1')
  t = t.replace(/\*\*Stack:\*\*\s*\*\s*([^*\n]+)/gi, '**Stack:** $1')

  // * *bold** or * *Title – description → proper bold / list
  t = t.replace(/\* \*(?=\*)/g, '*')
  t = t.replace(/\* \*([^*\n]+?)\*\*/g, '**$1**')
  t = t.replace(/^\* \*([A-Za-z0-9][^\n*]+)/gm, '- **$1')

  // **Frontend:***React or **Backend:***Express (single * after colon)
  t = t.replace(/\*\*([^*\n:]+):\*\*([A-Za-z0-9])/g, '**$1:** $2')
  t = t.replace(/\*\*([^*\n:]+):\*([^*\n]+)/g, '**$1:** $2')
  t = t.replace(/\n(\*\*[A-Za-z][A-Za-z0-9 /&]+:\*\*)/g, '\n- $1')
  t = t.replace(/\*\*([A-Za-z0-9 /&]+):\*\*\s*\*\*/g, '**$1:**')

  // Orphan ** lines and empty bold tails: "**Frontend:** **"
  t = t.replace(/^\s*\*\*\s*$/gm, '')
  t = t.replace(/:\s*\*\*\s*$/gm, ':')
  t = t.replace(/:\s*\*\*\s*\n/g, ':\n')

  // Dates jammed: Jan2025, Aug2023, Jun2027
  t = t.replace(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{4})\b/gi,
    '$1 $2',
  )
  t = t.replace(/\*(\d{4})/g, ' *$1')
  t = t.replace(/\)\*---/g, ')\n\n---')
  t = t.replace(/(\d{4})\*---/g, '$1\n\n---')

  // Skill / tech lines: "React.js**, **" → "React.js, "
  t = t.replace(/([A-Za-z0-9.+#\/]+)\*\*,\s*\*\*/g, '$1, ')
  t = t.replace(/,\s*\*\*\s*$/gm, '')

  // Category labels run together: "**Backend:** **Express" on one line
  t = t.replace(
    /\*\*([A-Za-z0-9 /&'()]+):\*\*\s*\*\*\s*/g,
    '**$1:** ',
  )

  // Bold label then newline list without bullet: "**Backend:**\nExpress" 
  t = t.replace(
    /\*\*([A-Za-z0-9 /&]+):\*\*\s*\n+(?=[A-Z])/g,
    '**$1:**\n\n- ',
  )

  // Horizontal rule glued to text
  t = t.replace(/([^\n-])\s*---+\s*(?=#{1,6})/g, '$1\n\n---\n\n')
  t = t.replace(/([^\n-])---+\s*$/gm, '$1\n\n---')

  t = repairSplitBoldMarkers(t)
  t = fixJammedSections(t)
  t = fixInlineStarBullets(t)
  t = stripOrphanBoldMarkers(t)

  return t
}

/** Trailing pipe from broken tables: "discounts). |" */
export function stripStrayPipeCharacters(s: string): string {
  return s
    .replace(/\)\s*\|\s*$/gm, ')')
    .replace(/\s+\|\s*$/gm, '')
    .replace(/^\|\s*$/gm, '')
}

/** Light normalize for document RAG — keeps paragraph/heading spacing intact. */
export function normalizeDocumentMarkdown(raw: string): string {
  let s = stripReasoningBlocks(raw)
  s = s.replace(/\[Source:[^\]]*\]/gi, '')
  s = s.replace(/\r\n/g, '\n')
  s = s.replace(/^(## .+)$/gm, '$1\n')
  s = s.replace(/\n{4,}/g, '\n\n\n')
  s = s.replace(/[ \t]+$/gm, '')
  return s.trim()
}

export function stripIncompleteTableTail(text: string): string {
  const lines = text.split('\n')
  let lastTableStart = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('|')) {
      lastTableStart = i
      break
    }
    if (lines[i].trim() !== '') return text
  }
  if (lastTableStart < 0) return text

  const tail = lines.slice(lastTableStart)
  const hasSep = tail.some(isSeparatorRow)
  const dataRows = tail.filter(l => l.includes('|') && !isSeparatorRow(l))
  if (!hasSep || dataRows.length <= 1) {
    return lines.slice(0, lastTableStart).join('\n').trimEnd()
  }
  return text
}

/** Remove generic model filler intros so answers start with substance. */
function stripFillerIntros(s: string): string {
  return s
    .replace(
      /^Based on the provided document context,?\s*(it seems (you're|you are)|here's|here is)[^\n]*\n+/i,
      '',
    )
    .replace(/^Based on the provided document context,?\s*/i, '')
    .replace(/^It seems you're[^\n]+\n+/i, '')
}

export function normalizeMarkdown(raw: string, opts?: { forStream?: boolean }): string {
  let s = stripReasoningBlocks(raw)
  const protected0 = protectCodeBlocks(s)
  s = protected0.text
  s = repairUniversalModelMarkdown(s)
  s = stripFillerIntros(s)
  s = stripHtmlToMarkdown(s)
  s = formatLetterLikeProse(s)
  s = s.replace(/\[Source:[^\]]*\]/gi, '')
  s = s.replace(/^\s*#{1,3}\s*$/gm, '')
  s = s.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2')
  s = s.replace(/\s*\[Page\s*[\d‑\-–—]+\]/gi, '')
  s = s.replace(/\\n/g, '\n')
  s = repairJammedProseBlocks(s)
  s = fixGluedHeadings(s)
  s = fixStrayAsterisksAndSubtitles(s)
  s = joinBrokenTableCells(s)
  s = mergePipeLines(s)
  s = fixMalformedBoldAndHeadings(s)

  // Pipe-mega-lines first (model puts whole guide on one line)
  s = unwrapMegaPipeLines(s)
  s = joinBrokenTableCells(s)
  s = mergePipeLines(s)
  s = fixMalformedBoldAndHeadings(s)

  s = s.replace(/---+(?=#{1,6})/g, '\n\n---\n\n')
  s = s.replace(/([.!?)\]])\s*---+/g, '$1\n\n---')
  s = s.replace(/---+\s*(?=#{1,6}|\*\*[A-Z])/g, '\n\n---\n\n')
  s = s.replace(/^(#{1,6})([^\s#])/gm, '$1 $2')
  s = s.replace(/^(#{1,6})\s*(\d+\.)/gm, '$1 $2')
  s = s.replace(/\*\*(.+?)\*\*\s*={3,}/g, '\n## $1\n')
  s = s.replace(/\*\*([^*\n]+)\*\*(?=#{1,6})/g, '**$1**\n\n')
  s = s.replace(/(\*\*[^*\n]+?:\*\*)(?=\S)/g, '$1 ')

  s = replaceComponentTablesWithCards(s)
  s = replaceBudgetTables(s)
  s = replaceCareerGuideTables(s)
  s = fixGluedHeadings(s)
  s = repairBrokenTables(s)
  s = fixBrokenTimelineSection(s)
  s = stripEmptyTipBlockquotes(s)
  s = repairSplitBoldMarkers(s)
  s = stripOrphanListNumbers(s)
  s = stripStrayPipeCharacters(s)
  s = fixJammedSections(s)
  s = stripEmptyTipBlockquotes(s)
  s = stripOrphanListNumbers(s)
  s = fixStrayAsterisksAndSubtitles(s)
  s = repairUniversalModelMarkdown(s)
  s = repairSplitBoldMarkers(s)
  s = s.replace(/^\|\s*(#{1,6}\s)/gm, '$1')
  s = s.replace(/&(\d)/g, '& $1')
  s = s.replace(/(\w)\*\*([A-Z][a-z]+[^*]*\*\*)/g, '$1\n\n**$2')

  s = fixInlineStarBullets(s)
  s = s.replace(/(\d+\.\s+[^\n]*?)(?=\s\d+\.\s)/g, '$1\n')
  s = s.replace(/([^\s\n*])\s\*\s(?=\S)/g, '$1\n* ')
  s = s.replace(/^(\s*)\*(?=\S)/gm, '$1* ')
  s = s.replace(/^(\s*)-(?=[A-Za-z])/gm, '$1- ')

  s = s.replace(/```(?=\d+[.)])/g, '```\n')
  s = s.replace(/```(?=\s*[-*]\s)/g, '```\n')
  s = s.replace(/([^\n])(```)/g, '$1\n$2')

  s = s.replace(/^```([A-Za-z][A-Za-z0-9+#-]*)(.*)$/gm, (_, tag, rest) => {
    const split = splitJammedFenceLang(tag)
    if (split) return `\`\`\`${split.lang}\n${split.rest}${rest}`
    if (tag && rest.trim()) return `\`\`\`${tag}\n${rest.trimStart()}`
    return `\`\`\`${tag}${rest}`
  })

  s = s.replace(/```([A-Za-z][A-Za-z0-9+#-]*)([^\n`])/g, (_, tag, next) => {
    const split = splitJammedFenceLang(tag)
    if (split) return `\`\`\`${split.lang}\n${split.rest}${next}`
    return `\`\`\`${tag}\n${next}`
  })

  s = s.replace(/```(?=[^\n A-Za-z`])/g, '```\n')
  s = s.replace(/([.!?])\s*(\*\*[A-Z][^*\n]{0,80}:\*\*)/g, '$1\n\n$2')
  s = s.replace(/([.!?])(\d+\.\s)/g, '$1\n\n$2')
  s = s.replace(/([.!?])\s*(#{1,6}\s)/g, '$1\n\n$2')
  s = s.replace(/([.!?])\s*([-*])\s/g, '$1\n\n$2 ')
  s = s.replace(/([^\n#\s])(#{1,6}\s)/g, '$1\n\n$2')
  // "**Title**Body" but not labels like "**Key notes:**"
  s = s.replace(/(\*\*[^*\n:*]+?\*\*)([A-Z][a-z])/g, '$1\n\n$2')
  s = s.replace(/\*\s+\*([^*]+:\*\*)/g, '**$1')
  s = s.replace(/^\s*[-=]{3,}\s*$/gm, '\n---\n')
  s = s.replace(/([^\n])\n([-*]\s)/g, '$1\n\n$2')
  s = s.replace(/([^\n])\n(\d+\.\s)/g, '$1\n\n$2')
  s = s.replace(/([^\n])\n(\|[^\n]+\|)/g, '$1\n\n$2')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]+$/gm, '')

  s = stripOrphanBoldMarkers(s)
  s = enforceNoStrayFormattingTokens(s)

  if (opts?.forStream) {
    s = stripIncompleteTableTail(s)
  }

  s = restoreCodeBlocks(s, protected0.blocks)
  return s.trim()
}
