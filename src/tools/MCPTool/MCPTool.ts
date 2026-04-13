import { Ajv } from 'ajv'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult, ValidationResult } from '../../types/permissions.js'
import { isOutputLineTruncated } from '../../utils/terminal.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

// Allow any input object since MCP tools define their own schemas
export const inputSchema = lazySchema(() => z.object({}).passthrough())
type InputSchema = ReturnType<typeof inputSchema>

// MCP tools can return either a plain string or an array of content blocks
// (text, images, etc.). The outputSchema must reflect both shapes so the model
// knows rich content is possible.
export const outputSchema = lazySchema(() =>
  z.union([
    z.string().describe('MCP tool execution result as text'),
    z
      .array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
        }),
      )
      .describe('MCP tool execution result as content blocks'),
  ]),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export MCPProgress from centralized types to break import cycles
export type { MCPProgress } from '../../types/tools.js'

const ajv = new Ajv({ strict: false })

export const MCPTool = buildTool({
  isMcp: true,
  // Overridden in mcpClient.ts with the real MCP tool name + args
  isOpenWorld() {
    return false
  },
  // Overridden in mcpClient.ts
  name: 'mcp',
  maxResultSizeChars: 100_000,
  // Overridden in mcpClient.ts
  async description() {
    return DESCRIPTION
  },
  // Overridden in mcpClient.ts
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  // Overridden in mcpClient.ts
  async call() {
    return {
      data: '',
    }
  },
  async checkPermissions(): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'MCPTool requires permission.',
    }
  },
  async validateInput(input, context): Promise<ValidationResult> {
    if (this.inputJSONSchema) {
      try {
        const validate = ajv.compile(this.inputJSONSchema)
        if (!validate(input)) {
          return {
            result: false,
            message: ajv.errorsText(validate.errors),
            errorCode: 400,
          }
        }
      } catch (error) {
        return {
          result: false,
          message: `Failed to compile JSON schema for validation: ${error}`,
          errorCode: 500,
        }
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  // Overridden in mcpClient.ts
  userFacingName: () => 'mcp',
  renderToolUseProgressMessage,
  renderToolResultMessage,
  isResultTruncated(output: Output): boolean {
    if (typeof output === 'string') {
      return isOutputLineTruncated(output)
    }
    // Array of content blocks — check if any text block exceeds the display limit
    if (Array.isArray(output)) {
      return output.some(
        block =>
          block?.type === 'text' &&
          typeof block.text === 'string' &&
          isOutputLineTruncated(block.text),
      )
    }
    return false
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

