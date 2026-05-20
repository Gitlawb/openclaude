import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React from 'react'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { enqueueStreamEvent, spawnShellTask } from '../../tasks/LocalShellTask/LocalShellTask.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { exec } from '../../utils/Shell.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import {
  matchWildcardPattern,
  permissionRuleExtractPrefix,
} from '../BashTool/bashPermissions.js'
import { parseForSecurity } from '../../utils/bash/ast.js'
import { detectShell } from './shellDetect.js'
import { getPlatform } from '../../utils/platform.js'

export { detectShell } from './shellDetect.js'

export const MONITOR_TOOL_NAME = 'Monitor'

const MONITOR_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z
      .string()
      .describe('The shell command to run and monitor'),
    description: z
      .string()
      .describe(
        'Clear, concise description of what this command does in active voice.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    taskId: z
      .string()
      .describe('The ID of the background monitor task'),
    outputFile: z
      .string()
      .describe('Path to the file where output is being written'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: 'stream shell output as notifications',
  maxResultSizeChars: 10_000,
  strict: true,

  isConcurrencySafe() {
    return true
  },

  toAutoClassifierInput(input) {
    return input.command
  },

  async preparePermissionMatcher({ command }) {
    const parsed = await parseForSecurity(command)
    if (parsed.kind !== 'simple') {
      return () => true
    }
    const subcommands = parsed.commands.map(c => c.argv.join(' '))
    return (pattern: string) => {
      const prefix = permissionRuleExtractPrefix(pattern)
      return subcommands.some(cmd => {
        if (prefix !== null) {
          return cmd === prefix || cmd.startsWith(`${prefix} `)
        }
        return matchWildcardPattern(pattern, cmd)
      })
    }
  },

  async checkPermissions(input, context) {
    // Monitor is a read-only streaming tool — it spawns a shell process and
    // streams stdout back as notifications. It does not execute commands
    // through BashTool/PowerShellTool. Security decisions for shell execution
    // belong to those tools, not to Monitor.
    //
    // NOTE: Do NOT route through powershellToolHasPermission or
    // bashToolHasPermission. Those can return 'ask' which triggers the
    // interactive permission flow (MonitorPermissionRequest → handleSelect →
    // onAllow → resolveOnce). That flow has a deadlock where the promise
    // never resolves, preventing call() from ever reaching its streaming
    // logic. Returning 'allow' directly avoids this while being safe —
    // Monitor only streams output; it doesn't modify files or execute
    // arbitrary shell commands outside of exec().
    return { behavior: 'allow' as const, updatedInput: input }
  },

  async description(input) {
    return input.description || 'Monitor shell command'
  },

  async prompt() {
    return `Execute a shell command in the background and stream its stdout line-by-line as notifications (~1s polling). Supports both bash and PowerShell (auto-detected from syntax). Write the raw command directly — do NOT wrap it in "powershell -Command" or "bash -c". Use this for monitoring logs, watching build output, or observing long-running processes. For one-shot "wait until done" commands, prefer Bash with run_in_background instead.`
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  userFacingName() {
    return 'Monitor'
  },

  getToolUseSummary(input) {
    if (!input?.description) {
      return input?.command ?? null
    }
    return input.description
  },

  getActivityDescription(input) {
    if (!input?.description) {
      return 'Starting monitor'
    }
    return `Monitoring ${input.description}`
  },

  renderToolUseMessage(
    input: Partial<z.infer<InputSchema>>,
  ): React.ReactNode {
    const cmd = input.command ?? ''
    const desc = input.description ?? ''
    if (desc && cmd) {
      return `${desc}: ${cmd}`
    }
    return cmd || desc || ''
  },

  renderToolResultMessage(
    output: Output,
  ): React.ReactNode {
    return `Monitor started · task ${output.taskId}`
  },

  mapToolResultToToolResultBlockParam(
    output: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    const outputPath = output.outputFile
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Monitor started · task ${output.taskId}. Output file: ${outputPath}. New output lines will be sent as notifications (~1s polling). Use TaskStop to end monitoring when done.`,
    }
  },

  async call(input, toolUseContext) {
    const { command, description } = input
    const { abortController, setAppState } = toolUseContext

    // Auto-detect shell only on Windows. On macOS/Linux/WSL there is no
    // PowerShell, so default to bash without running detection heuristics.
    const shellType = getPlatform() === 'windows' ? detectShell(command) : 'bash'
    let actualCommand = command
    if (shellType === 'powershell') {
      const wrapMatch = /^(?:powershell|pwsh)(?:\.exe)?\s+-Command\s+(.+)/is.exec(command)
      if (wrapMatch) {
        let inner = wrapMatch[1].trim()
        if ((inner.startsWith('"') && inner.endsWith('"')) ||
            (inner.startsWith("'") && inner.endsWith("'"))) {
          inner = inner.slice(1, -1)
        }
        actualCommand = inner
      }
    }

    const taskDescription = description || command
    const toolUseId = toolUseContext.toolUseId
    const agentId = toolUseContext.agentId

    // PowerShell: use pipe mode (onStdout) to avoid C-runtime file buffering.
    // stdout flows through Node.js pipes → onStdout callback → enqueueStreamEvent
    // without ever touching a file descriptor that PowerShell would block-buffer.
    //
    // `6>&1` redirects the information stream (where Write-Host lives) to stdout.
    // Without it, Write-Host output goes to the host console and never hits the pipe.
    if (shellType === 'powershell') {
      let pipeBuffer = ''
      let pipeTaskId: string | null = null

      const flushPipe = () => {
        if (!pipeTaskId) return
        const lines = pipeBuffer.split('\n')
        // Last element is the incomplete trailing line; keep it in the buffer
        pipeBuffer = lines.pop() || ''
        if (lines.length > 0) {
          enqueueStreamEvent(pipeTaskId, taskDescription, lines.join('\n'), toolUseId, agentId)
        }
      }

      // `6>&1` redirects the information stream (where Write-Host lives) to stdout.
      // Without it, Write-Host output goes to the host console and never hits the pipe.
      // Error stream (2) stays on stderr so cwd-tracking exit-code logic works.
      const mergedCommand = `& { ${actualCommand} } 6>&1`
      const shellCommand = await exec(mergedCommand, abortController.signal, 'powershell', {
        timeout: MONITOR_TIMEOUT_MS,
        onStdout: (data: string) => {
          pipeBuffer += data
          flushPipe()
        },
      })

      const handle = await spawnShellTask(
        { command, description: taskDescription, shellCommand, toolUseId, agentId, kind: 'monitor' },
        { abortController, getAppState: () => { throw new Error('getAppState not available in MonitorTool spawn context') }, setAppState: toolUseContext.setAppStateForTasks ?? setAppState },
      )
      pipeTaskId = handle.taskId
      flushPipe() // flush any data accumulated before taskId was available

      // Flush remaining buffer on completion (in case last line has no \n)
      void shellCommand.result.then(() => {
        if (pipeBuffer) {
          enqueueStreamEvent(pipeTaskId!, taskDescription, pipeBuffer, toolUseId, agentId)
        }
      })

      return {
        data: { taskId: handle.taskId, outputFile: getTaskOutputPath(handle.taskId) },
      }
    }

    // Bash: file-based streaming (setInterval in spawnShellTask reads
    // the output file; bash is line-buffered, no buffering issue).
    const shellCommand = await exec(actualCommand, abortController.signal, 'bash', {
      timeout: MONITOR_TIMEOUT_MS,
    })

    const handle = await spawnShellTask(
      { command, description: taskDescription, shellCommand, toolUseId, agentId, kind: 'monitor' },
      { abortController, getAppState: () => { throw new Error('getAppState not available in MonitorTool spawn context') }, setAppState: toolUseContext.setAppStateForTasks ?? setAppState },
    )

    return {
      data: { taskId: handle.taskId, outputFile: getTaskOutputPath(handle.taskId) },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
