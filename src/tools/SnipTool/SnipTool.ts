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
        'Short message IDs to remove — the [id:XXXXXX] values appended to user messages.',
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
  async call(input) {
    const { markForSnip } =
      require('../../services/compact/snipCompact.js') as typeof import('../../services/compact/snipCompact.js')
    markForSnip(input.message_ids)
    return { data: { sniped: input.message_ids.length } }
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
      content: `Marked ${content.sniped} message(s) for removal. They will be removed from context before the next model call.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
