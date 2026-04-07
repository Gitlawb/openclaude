const REASONING_START_RE =
  /^\s*(the user\b|i should\b|i need to\b|let me think\b|the task\b|the request\b)/i

const REASONING_CUE_RE =
  /\b(respond|reply|answer|help|greeting|small talk|request|task|need to|should)\b/i

export function looksLikeLeakedReasoningPrefix(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  return (
    REASONING_START_RE.test(normalized) &&
    REASONING_CUE_RE.test(normalized)
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
