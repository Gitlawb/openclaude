// Stub — OverflowTestTool not included in source snapshot.
// isEnabled() → false keeps it out of the tool list, matching the previous
// behavior where the missing module resolved to a null tool object.
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

export const OVERFLOW_TEST_TOOL_NAME = 'OverflowTest'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export const OverflowTestTool = buildTool({
  name: OVERFLOW_TEST_TOOL_NAME,
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  isEnabled() {
    return false
  },
  async description() {
    return ''
  },
  async prompt() {
    return ''
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(_output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${OVERFLOW_TEST_TOOL_NAME} is not available in this build`,
    }
  },
  async call(): Promise<never> {
    throw new Error(`${OVERFLOW_TEST_TOOL_NAME} is not available in this build`)
  },
} satisfies ToolDef<InputSchema, never>)
