import type { Message } from './message.js'
import type { HookProgress } from './hooks.js'
import type { TaskType } from '../Task.js'

export type SdkWorkflowProgress = {
  type: string
  index?: number
  phaseIndex?: number
  completed?: boolean
  title?: string
  description?: string
  status?: string
  [key: string]: unknown
}

export type ShellProgress = {
  type: 'shell_progress' | 'bash_progress' | 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes?: number
  timeoutMs?: number
  command?: string
  pid?: number
  taskId?: string
}

export type BashProgress = ShellProgress & {
  type: 'bash_progress'
  shell?: 'bash'
}

export type PowerShellProgress = ShellProgress & {
  type: 'powershell_progress'
  shell?: 'powershell'
}

export type MCPProgress = {
  type: 'mcp_progress'
  progress?: number
  total?: number
  progressMessage?: string
}

export type AgentToolProgress = {
  type: 'agent_progress'
  agentId?: string
  totalDurationMs?: number
  totalToolUseCount?: number
  totalTokens?: number
  usage?: Record<string, unknown>
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>
  prompt?: string
  message?: Message
  summary?: string
}

export type SkillToolProgress = {
  type: 'skill_progress'
  message: Message
}

export type TaskOutputProgress = {
  type: 'waiting_for_task'
  taskDescription: string
  taskType: TaskType
}

export type WebSearchProgress = {
  type: 'web_search_progress'
  query?: string
  message?: string
}

export type REPLToolProgress = {
  type: 'repl_progress'
  message?: string
}

export type ToolProgressData =
  | ShellProgress
  | BashProgress
  | PowerShellProgress
  | HookProgress
  | MCPProgress
  | AgentToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
  | REPLToolProgress
