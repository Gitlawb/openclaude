const EXPLICIT_REASONING_START_RE =
  /^\s*(i should\b|i need to\b|let me think\b|the task\b|the request\b)/i

const EXPLICIT_REASONING_CUE_RE =
  /\b(respond|reply|answer|greeting|small talk|need to|should|briefly|friendly)\b/i

const USER_REASONING_RE =
  /^\s*the user\b[\s\S]*\b(i should|i need to|let me think|respond|reply|answer|greeting|small talk|briefly|friendly)\b/i

export function looksLikeLeakedReasoningPrefix(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  return (
    (EXPLICIT_REASONING_START_RE.test(normalized) &&
      EXPLICIT_REASONING_CUE_RE.test(normalized)) ||
    USER_REASONING_RE.test(normalized)
  )
}

export function stripLeakedReasoningPreamble(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split(/\n\s*\n/)
  if (parts.length < 2) return text

  const first = parts[0]?.trim() ?? ''
  if (!looksLikeLeakedReasoningPrefix(first)) {
    return text
  }

  const remainder = parts.slice(1).join('\n\n').trim()
  return remainder || text
}
