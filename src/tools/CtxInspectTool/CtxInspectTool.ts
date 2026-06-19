import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPrompt, CTX_INSPECT_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({}),
)
type InputSchema = ReturnType<typeof inputSchema>

type CtxInspectOutput = {
  committedSpans: number
  collapsedMessages: number
  stagedSpans: number
  armed: boolean
  health: {
    totalSpawns: number
    totalErrors: number
    totalEmptySpawns: number
    lastError: string | null
    emptySpawnWarningEmitted: boolean
  }
}

export const CtxInspectTool = buildTool({
  name: CTX_INSPECT_TOOL_NAME,
  isEnabled() {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../../services/contextCollapse/index.js') as typeof import('../../services/contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return isContextCollapseEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return getPrompt()
  },
  async prompt() {
    return getPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  async call(_input, _context) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getStats, getContextCollapseState } =
      require('../../services/contextCollapse/index.js') as typeof import('../../services/contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */

    const stats = getStats()
    const state = getContextCollapseState()

    const result: CtxInspectOutput = {
      committedSpans: stats.collapsedSpans,
      collapsedMessages: stats.collapsedMessages,
      stagedSpans: stats.stagedSpans,
      armed: state?.armed ?? false,
      health: {
        totalSpawns: stats.health.totalSpawns,
        totalErrors: stats.health.totalErrors,
        totalEmptySpawns: stats.health.totalEmptySpawns,
        lastError: stats.health.lastError,
        emptySpawnWarningEmitted: stats.health.emptySpawnWarningEmitted,
      },
    }

    return { data: result }
  },
  renderToolUseMessage() {
    return null
  },
  maxResultSizeChars: 4096,
  mapToolResultToToolResultBlockParam(
    output: CtxInspectOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: JSON.stringify(output, null, 2),
    }
  },
} satisfies ToolDef<InputSchema, CtxInspectOutput>)
