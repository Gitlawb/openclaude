/* eslint-disable @typescript-eslint/no-require-imports */
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPrompt, SNIP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.object({
    message_ids: z
      .array(z.string())
      .describe(
        'Short internal snip message IDs to remove.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Output = { sniped: number }

export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return false
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
  async call(input, context) {
    const { markForSnip } =
      require('../../services/compact/snipCompact.js') as typeof import('../../services/compact/snipCompact.js')
    // Resolve short IDs → UUIDs against THIS conversation's messages so the
    // pending removal is scoped to this session (see markForSnip). Report the
    // count that actually resolved, not the raw request length: stale or
    // unresolvable IDs are never queued, so echoing them would overstate the snip.
    const queued = markForSnip(input.message_ids, context.messages)
    return { data: { sniped: queued.length } }
  },
  renderToolUseMessage() {
    return null
  },
  userFacingName: () => 'Snip',
  maxResultSizeChars: 1024,
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content:
        `Queued ${content.sniped} message(s) for snipping before the next model call. ` +
        `Some may be kept if removing them would split a tool call from its result; ` +
        `when pruning old tool output, queue the whole related tool interaction.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
