export function isGoalStatusContent(content: string): boolean {
  return (
    content.startsWith('Goal achieved:') ||
    content.startsWith('Goal not complete:') ||
    content.startsWith('Goal paused:')
  )
}

export function isGoalStatusSystemMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const record = message as Record<string, unknown>
  return (
    record.type === 'system' &&
    record.subtype === 'informational' &&
    typeof record.content === 'string' &&
    isGoalStatusContent(record.content)
  )
}
