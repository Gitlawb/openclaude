import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { all } from '../../utils/generators.js'
import { createUserMessage } from '../../utils/messages.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  createCircuitBreakerState,
  defaultCircuitConfig,
  observeToolResult,
  type CircuitBreakerState,
} from '../autonomy/circuitBreakers.js'
import { isAutonomyEnabled } from '../autonomy/routePolicy.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}

function circuitBreakersEnabled(): boolean {
  const settings = getInitialSettings()
  if (!isAutonomyEnabled(settings)) return false
  // Default on when autonomy is enabled unless explicitly disabled
  return settings.autonomy?.circuitBreakers !== false
}

function extractToolObservation(
  message: Message | undefined,
  toolName: string,
): { toolName: string; error?: string; noopEdit?: boolean } | null {
  if (!message || message.type !== 'user') return null
  const content = message.message.content
  if (!Array.isArray(content)) return null
  let resultText = ''
  for (const block of content) {
    if (block.type !== 'tool_result') continue
    if (block.is_error) {
      const errText =
        typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content)
      return { toolName, error: errText }
    }
    if (typeof block.content === 'string') {
      resultText += block.content
    }
  }
  // Heuristic: successful Edit/Write with "no changes" style results
  if (
    (toolName === 'Edit' ||
      toolName === 'Write' ||
      toolName === 'NotebookEdit') &&
    /no (?:changes|modifications)|did not change|unchanged/i.test(resultText)
  ) {
    return { toolName, noopEdit: true }
  }
  return { toolName }
}

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  const circuitState = circuitBreakersEnabled()
    ? createCircuitBreakerState()
    : null
  const circuitCfg = defaultCircuitConfig()
  let circuitTripped = false

  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (circuitTripped) break

    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}
      // Run read-only batch concurrently
      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }
        const tripMsg =
          circuitState && update.message
            ? checkAndMaybeTrip(
                circuitState,
                circuitCfg,
                update.message,
                blocks,
              )
            : null
        if (tripMsg) {
          circuitTripped = true
          yield {
            message: update.message,
            newContext: currentContext,
          }
          yield {
            message: createUserMessage({ content: tripMsg }),
            newContext: currentContext,
          }
          break
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
      if (circuitTripped) break
      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) {
          continue
        }
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }
      yield { newContext: currentContext }
    } else {
      // Run non-read-only batch serially
      for await (const update of runToolsSerially(
        blocks,
        assistantMessages,
        canUseTool,
        currentContext,
      )) {
        if (update.newContext) {
          currentContext = update.newContext
        }
        const tripMsg =
          circuitState && update.message
            ? checkAndMaybeTrip(
                circuitState,
                circuitCfg,
                update.message,
                blocks,
              )
            : null
        if (tripMsg) {
          circuitTripped = true
          yield {
            message: update.message,
            newContext: currentContext,
          }
          yield {
            message: createUserMessage({ content: tripMsg }),
            newContext: currentContext,
          }
          break
        }
        yield {
          message: update.message,
          newContext: currentContext,
        }
      }
    }
  }
}

function checkAndMaybeTrip(
  state: CircuitBreakerState,
  config: ReturnType<typeof defaultCircuitConfig>,
  message: Message,
  blocks: ToolUseBlock[],
): string | null {
  const toolName =
    blocks.find(b => {
      if (message.type !== 'user' || !Array.isArray(message.message.content)) {
        return false
      }
      return message.message.content.some(
        c => c.type === 'tool_result' && c.tool_use_id === b.id,
      )
    })?.name ?? 'unknown'

  const obs = extractToolObservation(message, toolName)
  if (!obs) return null
  const result = observeToolResult(state, obs, config)
  return result.tripped ? result.message : null
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/**
 * Partition tool calls into batches where each batch is either:
 * 1. A single non-read-only tool, or
 * 2. Multiple consecutive read-only tools
 */
function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            // If isConcurrencySafe throws (e.g., due to shell-quote parse failure),
            // treat as not concurrency-safe to be conservative
            return false
          }
        })()
      : false
    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }
    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const toolUse of toolUseMessages) {
    toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(toolUse.id),
    )
    for await (const update of runToolUse(
      toolUse,
      assistantMessages.find(_ =>
        _.message.content.some(
          _ => _.type === 'tool_use' && _.id === toolUse.id,
        ),
      )!,
      canUseTool,
      currentContext,
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }
      yield {
        message: update.message,
        newContext: currentContext,
      }
    }
    markToolUseAsComplete(toolUseContext, toolUse.id)
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages.map(async function* (toolUse) {
      toolUseContext.setInProgressToolUseIDs(prev =>
        new Set(prev).add(toolUse.id),
      )
      yield* runToolUse(
        toolUse,
        assistantMessages.find(_ =>
          _.message.content.some(
            _ => _.type === 'tool_use' && _.id === toolUse.id,
          ),
        )!,
        canUseTool,
        toolUseContext,
      )
      markToolUseAsComplete(toolUseContext, toolUse.id)
    }),
    getMaxToolUseConcurrency(),
  )
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
