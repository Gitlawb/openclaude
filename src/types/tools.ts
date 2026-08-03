import type {
  AssistantMessage,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
} from './message.js'
import type { AgentId } from './ids.js'

// ---------------------------------------------------------------------------
// NOTE: This file was reconstructed from usage sites — the original was a
// type-only module erased at compile time and absent from cli.js.map.
// Shapes are inferred from onProgress construction sites in
// src/tools/BashTool/BashTool.tsx, src/tools/PowerShellTool/PowerShellTool.tsx,
// src/tools/AgentTool/AgentTool.tsx, src/tools/SkillTool/SkillTool.ts,
// src/tools/TaskOutputTool/TaskOutputTool.tsx,
// src/tools/WebSearchTool/WebSearchTool.ts and src/services/mcp/client.ts.
// See issue #473 for the typecheck-foundation effort.
// ---------------------------------------------------------------------------

export type BashProgress = {
  type: 'bash_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
  taskId: string
  timeoutMs: number
}

export type PowerShellProgress = {
  type: 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
  timeoutMs: number
  taskId: string
}

/**
 * Shared shell-progress payload forwarded by AgentTool from a sub-agent's
 * bash/powershell tool calls, and consumed generically by BashModeProgress
 * for `!`-prefixed bash-mode commands (either backend).
 */
export type ShellProgress = BashProgress | PowerShellProgress

/**
 * `message` is usually normalized (one content block) via normalizeMessages,
 * but processSlashCommand.tsx forwards a raw (un-normalized) AssistantMessage
 * for forked-command agent progress — so both shapes are accepted.
 */
export type AgentToolProgress = {
  type: 'agent_progress'
  message: NormalizedUserMessage | NormalizedAssistantMessage | AssistantMessage
  prompt: string
  agentId: AgentId
}

export type SkillToolProgress = {
  type: 'skill_progress'
  message: NormalizedUserMessage | NormalizedAssistantMessage
  prompt: string
  agentId: AgentId
}

/**
 * Flat (not per-status-discriminated) shape — MCPTool/UI.tsx destructures
 * progress/total/progressMessage off `.data` unconditionally, without first
 * narrowing on `status`, so those fields must be optional on every status.
 */
export type MCPProgress = {
  type: 'mcp_progress'
  status: 'started' | 'completed' | 'failed' | 'progress'
  serverName: string
  toolName: string
  elapsedTimeMs?: number
  /** MCP protocol progress notification fields (SDK Progress type), status==='progress' only */
  progress?: number
  total?: number
  progressMessage?: string
}

export type TaskOutputProgress = {
  type: 'waiting_for_task'
  taskDescription: string
  taskType: string
}

export type WebSearchProgress =
  | {
      type: 'query_update'
      query: string
    }
  | {
      type: 'search_results_received'
      resultCount: number
      query: string
    }

/**
 * Emitted by the REPL tool's inner-tool-call progress (verified from a
 * single consumption site — no construction site survives in this source,
 * so `phase` beyond 'start' is unconfirmed).
 */
export type REPLToolProgress = {
  type: 'repl_tool_call'
  phase: string
  toolName: string
  toolInput: unknown
}

/**
 * Element of the `workflow_progress` delta batch emitted alongside
 * `task_progress` SDK events (src/utils/sdkEventQueue.ts). The consumer
 * (PhaseProgress.tsx, referenced by comment at sdkEventQueue.ts:29-31) is not
 * present in this source — no construction site exists here either, so this
 * shape is inferred only from that comment ("upsert by `${type}:${index}`
 * then group by phaseIndex"). Low confidence.
 */
export type SdkWorkflowProgress = {
  type: string
  index: number
  phaseIndex: number
}

/**
 * Union of all built-in tools' progress payloads. Excludes HookProgress
 * (src/types/hooks.ts), which is combined separately into `Progress` in
 * src/Tool.ts (`Progress = ToolProgressData | HookProgress`).
 */
export type ToolProgressData =
  | BashProgress
  | PowerShellProgress
  | AgentToolProgress
  | SkillToolProgress
  | MCPProgress
  | TaskOutputProgress
  | WebSearchProgress
  | REPLToolProgress
