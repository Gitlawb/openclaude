import type { Message } from './message.js'

type ProgressBase = {
  type: string
  timestamp?: string
  taskId?: string
  task_id?: string
  toolUseID?: string
  tool_use_id?: string
  [key: string]: unknown
}

export type ShellProgress = ProgressBase & {
  type: 'bash_progress' | 'powershell_progress'
  command?: string
  output?: string
  fullOutput?: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
}

export type BashProgress = ShellProgress & {
  type: 'bash_progress'
}

export type PowerShellProgress = ShellProgress & {
  type: 'powershell_progress'
}

export type AgentToolProgress = ProgressBase & {
  type: 'agent_progress'
  message?: Message
  agentId?: string
  agentName?: string
  summary?: string
  status?: string
}

export type MCPProgress = ProgressBase & {
  type: 'mcp_progress'
  server?: string
  tool?: string
  summary?: string
}

export type REPLToolProgress = ProgressBase & {
  type: 'repl_progress'
  summary?: string
}

export type SkillToolProgress = ProgressBase & {
  type: 'skill_progress'
  skill?: string
  summary?: string
}

export type TaskOutputProgress = ProgressBase & {
  type: 'task_progress'
  description?: string
  status?: string
  summary?: string
}

export type WebSearchProgress = ProgressBase & {
  type: 'web_search_progress'
  query?: string
  provider?: string
  summary?: string
}

export type SdkWorkflowProgress = ProgressBase & {
  type?: 'workflow_progress'
  phaseIndex?: number
  stepIndex?: number
  status?: string
  label?: string
  summary?: string
}

export type ToolProgressData =
  | AgentToolProgress
  | BashProgress
  | MCPProgress
  | PowerShellProgress
  | REPLToolProgress
  | ShellProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
  | SdkWorkflowProgress
