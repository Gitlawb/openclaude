import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  createUserMessage,
  REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  findToolByNameOrUniquePrefix,
  type Tools,
  type ToolUseContext,
} from '../../Tool.js'
import { getAllBaseTools } from '../../tools.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createChildAbortController } from '../../utils/abortController.js'
import { isDebugMode, logForDebugging } from '../../utils/debug.js'
import { runToolUse } from './toolExecution.js'

// Hard upper bound to escape silent limbos (e.g. processQueue busy-loop or
// runToolUse generator that never resolves). Only active in --debug since this
// is diagnostic instrumentation, not behavior we want to ship to users yet.
const TOOL_EXECUTOR_WATCHDOG_MS = 60_000

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: ToolUseBlock
  canonicalName: string
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  // Progress messages are stored separately and yielded immediately
  pendingProgress: Message[]
  cancelled?: boolean
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  // Child of toolUseContext.abortController. Fires when a Bash tool errors
  // so sibling subprocesses die immediately instead of running to completion.
  // Aborting this does NOT abort the parent — query.ts won't end the turn.
  private siblingAbortController: AbortController
  private discarded = false
  // Signal to wake up getRemainingResults when progress is available
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools will receive synthetic errors.
   */
  discard(): void {
    this.discarded = true
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    let toolDefinition = findToolByNameOrUniquePrefix(
      this.toolDefinitions,
      block.name,
    )
    if (!toolDefinition) {
      const baseTool = findToolByNameOrUniquePrefix(
        getAllBaseTools(),
        block.name,
      )
      if (baseTool && !baseTool.isMcp && baseTool.name !== block.name) {
        toolDefinition = baseTool
        logForDebugging(
          `Recovered truncated base tool name ${block.name} as ${baseTool.name}: ${block.id}`,
        )
      }
    }
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        canonicalName: block.name,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      canonicalName: toolDefinition.name,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  /**
   * Check if a tool can execute based on current concurrency state
   */
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        if (isDebugMode()) {
          logForDebugging(
            JSON.stringify({
              type: 'streaming_tool_blocked_by_concurrency',
              toolName: tool.block.name,
              toolUseId: tool.id,
              isConcurrencySafe: tool.isConcurrencySafe,
              executingNames: this.tools
                .filter(t => t.status === 'executing')
                .map(t => `${t.block.name}(${t.isConcurrencySafe ? 'safe' : 'unsafe'})`),
            }),
            { level: 'debug' },
          )
        }
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): Message {
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  /**
   * Determine why a tool should be cancelled.
   */
  private getAbortReason(
    tool: TrackedTool,
  ): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      // 'interrupt' means the user typed a new message while tools were
      // running. Only cancel tools whose interruptBehavior is 'cancel';
      // 'block' tools shouldn't reach here (abort isn't fired).
      if (this.toolUseContext.abortController.signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByNameOrUniquePrefix(
      this.toolDefinitions,
      tool.canonicalName,
    )
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.canonicalName}(${truncated})`
    }
    return tool.canonicalName
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  private cancelUnfinishedTools(): void {
    for (const tool of this.tools) {
      if (tool.status !== 'executing' && tool.status !== 'queued') continue
      const reason = this.getAbortReason(tool)
      if (!reason) continue
      tool.cancelled = true
      tool.pendingProgress = []
      tool.contextModifiers = []
      tool.results = [this.createSyntheticErrorMessage(tool.id, reason, tool.assistantMessage)]
      tool.status = 'completed'
    }
    this.updateInterruptibleState()
    this.progressAvailableResolve?.()
    this.progressAvailableResolve = undefined
  }

  /**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      for await (const update of generator) {
        if (tool.cancelled) return
        // Check if we were aborted by a sibling tool error or user interruption.
        // Only add the synthetic error if THIS tool didn't produce the error.
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          // Only Bash errors cancel siblings. Bash commands often have implicit
          // dependency chains (e.g. mkdir fails → subsequent commands pointless).
          // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
          if (tool.canonicalName === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          // Progress messages go to pendingProgress for immediate yielding
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            // Signal that progress is available
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      if (tool.cancelled) return
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      // NOTE: we currently don't support context modifiers for concurrent
      //       tools. None are actively being used, but if we want to use
      //       them in concurrent tools, we need to support that here.
      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults().catch((error: unknown) => {
      // If collectResults throws (e.g. MCP transport error not caught by
      // runToolUse's internal try/catch), mark the tool as completed with an
      // error result so getRemainingResults() doesn't wait forever.
      if (!tool.cancelled && tool.status !== 'completed' && tool.status !== 'yielded') {
        const errorText =
          error instanceof Error ? error.message : String(error)
        tool.results = [
          {
            message: {
              type: 'user' as const,
              uuid: crypto.randomUUID(),
              message: {
                role: 'user' as const,
                content: [
                  {
                    type: 'tool_result' as const,
                    content: `<tool_use_error>${errorText}</tool_use_error>`,
                    is_error: true,
                    tool_use_id: tool.id,
                  },
                ],
              },
              toolUseResult: `Error: ${errorText}`,
              sourceToolAssistantUUID: tool.assistantMessage.uuid,
            },
          },
        ]
        tool.status = 'completed'
        this.updateInterruptibleState()
      }
    })
    tool.promise = promise

    // Process more queue when done
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  /**
   * Get any completed results that haven't been yielded yet (non-blocking)
   * Maintains order where necessary
   * Also yields any pending progress messages immediately
   */
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      // Always yield pending progress messages immediately, regardless of tool status
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Check if any tool has pending progress messages
   */
  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  /**
   * Wait for remaining tools and yield their results as they complete
   * Also yields progress messages as they become available
   */
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    const signal = this.toolUseContext.abortController.signal
    const onAbort = () => this.cancelUnfinishedTools()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) onAbort()
      const debug = isDebugMode()
      let lastProgressAt = Date.now()
      let iterations = 0

      const snapshot = (event: string) => {
        if (!debug) return
        const statuses: Record<string, number> = {}
        for (const t of this.tools) {
          statuses[t.status] = (statuses[t.status] ?? 0) + 1
        }
        logForDebugging(
          JSON.stringify({
            type: event,
            iterations,
            totalTools: this.tools.length,
            statuses,
            hasExecuting: this.hasExecutingTools(),
            hasCompleted: this.hasCompletedResults(),
            hasPendingProgress: this.hasPendingProgress(),
            msSinceProgress: Date.now() - lastProgressAt,
          }),
          { level: 'debug' },
        )
      }

      while (this.hasUnfinishedTools()) {
        iterations++
        snapshot('streaming_tool_iter_start')
        await this.processQueue()

        let yieldedThisIter = false
        for (const result of this.getCompletedResults()) {
          yieldedThisIter = true
          lastProgressAt = Date.now()
          yield result
        }

        // If we still have executing tools but nothing completed, wait for any to complete
        // OR for progress to become available
        if (
          this.hasExecutingTools() &&
          !this.hasCompletedResults() &&
          !this.hasPendingProgress()
        ) {
          const executingPromises = this.tools
            .filter(t => t.status === 'executing' && t.promise)
            .map(t => t.promise!)

          // Also wait for progress to become available
          const progressPromise = new Promise<void>(resolve => {
            this.progressAvailableResolve = resolve
          })

          if (executingPromises.length > 0) {
            // Watchdog: in --debug, never wait more than TOOL_EXECUTOR_WATCHDOG_MS
            // for a single race. If it fires, the loop will go around again and
            // emit a fresh snapshot, exposing what's stuck without us having to
            // guess. Outside debug, behavior is unchanged.
            if (debug) {
              const watchdog = new Promise<'watchdog'>(resolve =>
                setTimeout(() => resolve('watchdog'), TOOL_EXECUTOR_WATCHDOG_MS),
              )
              const winner = await Promise.race<unknown>([
                ...executingPromises,
                progressPromise,
                watchdog,
              ])
              if (winner === 'watchdog') {
                snapshot('streaming_tool_watchdog_fired')
              }
            } else {
              await Promise.race([...executingPromises, progressPromise])
            }
          } else if (debug) {
            // hasExecutingTools=true but executingPromises empty means we have a
            // tool stuck in 'executing' with no promise — would be a busy loop.
            snapshot('streaming_tool_executing_without_promise')
          }
        } else if (!yieldedThisIter && debug) {
          snapshot('streaming_tool_iter_no_progress')
        }
      }

      for (const result of this.getCompletedResults()) {
        yield result
      }
      if (debug) snapshot('streaming_tool_loop_exit')
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.progressAvailableResolve = undefined
    }
  }

  /**
   * Check if there are any completed results ready to yield
   */
  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  /**
   * Check if there are any tools still executing
   */
  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  /**
   * Check if there are any unfinished tools
   */
  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  /**
   * Get the current tool use context (may have been modified by context modifiers)
   */
  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
