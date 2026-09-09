export type AgentDisplayStatus = 'pending' | 'running' | 'backgrounded' | 'completed' | 'failed' | 'killed' | 'timeout' | 'max_turns' | 'max_tool_calls'
export function agentStatusLabel(status: AgentDisplayStatus, activity?: string | null): string {
  switch (status) {
    case 'failed': return 'Failed'
    case 'killed': return 'Stopped'
    case 'timeout': return 'Time limit reached'
    case 'max_turns': return 'Turn limit reached'
    case 'max_tool_calls': return 'Tool limit reached'
    case 'completed': return 'Done'
    case 'backgrounded': return 'Running in the background'
    case 'pending': return 'Awaiting response'
    default: return activity || 'Working…'
  }
}

/** Reserve the prompt/footer and divide the dynamic area among active groups. */
export function agentGroupLayout(columns: number, rows: number, agents: number, activeGroups = 1) {
  const budget = Math.max(1, Math.floor(Math.max(1, rows - 8) / Math.max(1, activeGroups)))
  const gap = budget >= 3 ? 1 : 0
  const compact = columns < 70 || agents * 2 + 2 > budget
  const lineHeight = compact ? 1 : 2
  const remaining = budget - gap - 1
  const visible = agents * lineHeight <= remaining ? agents : Math.max(0, Math.floor((remaining - 1) / lineHeight))
  const showOverflow = visible < agents && remaining > 0
  return { compact, visible, hidden: agents - visible, showOverflow, gap, width: Math.max(1, columns), height: gap + 1 + visible * lineHeight + Number(showOverflow) }
}
