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
      // A snip is a queued request, not a guaranteed removal: snipCompactIfNeeded
      // refuses to drop a tool_result whose paired tool_use would survive (it
      // would orphan the tool call), so the request can no-op. Describe it
      // honestly and give the model the observable signal + repair, otherwise it
      // treats a structural no-op as a successful context reduction.
      content:
        `Queued ${content.sniped} message(s) for snipping before the next model call. ` +
        `A queued message is kept if removing it would orphan a tool call (for example, ` +
        `snipping one result from a turn that ran several tools in parallel). If a message ` +
        `you queued still shows its [id:...] tag on the next turn, it was kept; snip all of ` +
        `that turn's tool results together to remove them.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
