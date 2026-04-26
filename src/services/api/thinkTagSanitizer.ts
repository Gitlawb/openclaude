/**
 * Think-tag sanitizer for reasoning content leaks.
 *
 * Some OpenAI-compatible reasoning models (MiniMax M2.7, GLM-4.5/5, DeepSeek, Kimi K2,
 * self-hosted vLLM builds) emit chain-of-thought inline inside the `content` field using
 * XML-like tags instead of the separate `reasoning_content` channel. Example:
 *
 *   <think>the user wants foo, let me check bar</think>Here is the answer: ...
 *
 * This module strips those blocks structurally (tag-based), independent of English
 * phrasings. Three layers:
 *
 *   1. `createThinkTagFilter()` — streaming state machine. Feeds deltas, emits only
 *      the visible (non-reasoning) portion, and buffers partial tags across chunk
 *      boundaries so `</th` + `ink>` still parses correctly.
 *
 *   2. `stripThinkTags()` — whole-text cleanup. Removes closed pairs, unterminated
 *      opens at block boundaries, and orphan open/close tags. Used for non-streaming
 *      responses and as a safety net after stream close.
 *
 *   3. Flush discards buffered partial tags at stream end (false-negative bias —
 *      prefer losing a partial reasoning fragment over leaking it).
 */

const TAG_NAMES = [
  'think',
  'thinking',
  'reasoning',
  'thought',
  'reasoning_scratchpad',
] as const

const TAG_ALT = TAG_NAMES.join('|')

const OPEN_TAG_RE = new RegExp(`<\\s*(?:${TAG_ALT})\\b[^>]*>`, 'i')
const CLOSE_TAG_RE = new RegExp(`<\\s*/\\s*(?:${TAG_ALT})\\s*>`, 'i')

const CLOSED_PAIR_RE_G = new RegExp(
  `<\\s*(${TAG_ALT})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`,
  'gi',
)
const UNTERMINATED_OPEN_RE = new RegExp(
  `(?:^|\\n)[ \\t]*<\\s*(?:${TAG_ALT})\\b[^>]*>[\\s\\S]*$`,
  'i',
)
const ORPHAN_TAG_RE_G = new RegExp(
  `<\\s*/?\\s*(?:${TAG_ALT})\\b[^>]*>\\s*`,
  'gi',
)

const MAX_PARTIAL_TAG = 64

/**
 * Remove reasoning/thinking blocks from a complete text body.
 *
 * Handles:
 *   - Closed pairs: <think>...</think> (lazy match, anywhere in text)
 *   - Unterminated open tags at a block boundary: strips from the tag to end of string
 *   - Orphan open or close tags (no matching partner)
 *
 * False-negative bias: prefers leaving a few tag characters in rare edge cases over
 * stripping legitimate content.
 */
export function stripThinkTags(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(CLOSED_PAIR_RE_G, '')
  out = out.replace(UNTERMINATED_OPEN_RE, '')
  out = out.replace(ORPHAN_TAG_RE_G, '')
  return out
}

export interface ThinkTagFilter {
  feed(chunk: string): string
  flush(): string
  isInsideBlock(): boolean
}

/**
 * Streaming state machine. Feed deltas, emits visible (non-reasoning) text.
 * Handles tags split across chunk boundaries by holding back a short tail buffer
 * whenever the current buffer ends with what looks like a partial tag.
 */
export function createThinkTagFilter(): ThinkTagFilter {
  let inside = false
  let buffer = ''

  function findPartialTagStart(s: string): number {
    const lastLt = s.lastIndexOf('<')
    if (lastLt === -1) return -1
    if (s.indexOf('>', lastLt) !== -1) return -1
    const tail = s.slice(lastLt)
    if (tail.length > MAX_PARTIAL_TAG) return -1

    const m = /^<\s*\/?\s*([a-zA-Z_]\w*)?\s*$/.exec(tail)
    if (!m) return -1
    const partialName = (m[1] ?? '').toLowerCase()
    if (!partialName) return lastLt
    if (TAG_NAMES.some(name => name.startsWith(partialName))) return lastLt
    return -1
  }

  function feed(chunk: string): string {
    if (!chunk) return ''
    buffer += chunk
    let out = ''

    while (buffer.length > 0) {
      if (!inside) {
        const open = OPEN_TAG_RE.exec(buffer)
        if (open) {
          out += buffer.slice(0, open.index)
          buffer = buffer.slice(open.index + open[0].length)
          inside = true
          continue
        }

        const partialStart = findPartialTagStart(buffer)
        if (partialStart === -1) {
          out += buffer
          buffer = ''
        } else {
          out += buffer.slice(0, partialStart)
          buffer = buffer.slice(partialStart)
        }
        return out
      }

      const close = CLOSE_TAG_RE.exec(buffer)
      if (close) {
        buffer = buffer.slice(close.index + close[0].length)
        inside = false
        continue
      }

      const partialStart = findPartialTagStart(buffer)
      if (partialStart === -1) {
        buffer = ''
      } else {
        buffer = buffer.slice(partialStart)
      }
      return out
    }

    return out
  }

  function flush(): string {
    const held = buffer
    const wasInside = inside
    buffer = ''
    inside = false

    if (wasInside) return ''
    if (!held) return ''

    if (/^<\s*\/?\s*[a-zA-Z_]/.test(held)) return ''
    return held
  }

  return { feed, flush, isInsideBlock: () => inside }
}
