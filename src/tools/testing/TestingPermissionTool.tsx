/**
 * This testing-only tool will always pop up a permission dialog when called by
 * the model.
 */
import { z } from 'zod/v4';
import type { Tool } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
const NAME = 'TestingPermission';
const inputSchema = lazySchema(() => z.strictObject({}));
type InputSchema = ReturnType<typeof inputSchema>;
export const TestingPermissionTool: Tool<InputSchema, string> = buildTool({
  name: NAME,
  maxResultSizeChars: 100_000,
  async description() {
    return 'Test tool that always asks for permission';
  },
  async prompt() {
    return 'Test tool that always asks for permission before executing. Used for end-to-end testing.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  userFacingName() {
    return 'TestingPermission';
  },
  isEnabled() {
    return ("production" as string) === 'test';
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async checkPermissions() {
    // This tool always requires permission
    return {
      behavior: 'ask' as const,
      message: `Run test?`
    };
  },
  renderToolUseMessage() {
    return null;
  },
  renderToolUseProgressMessage() {
    return null;
  },
  renderToolUseQueuedMessage() {
    return null;
  },
  renderToolUseRejectedMessage() {
    return null;
  },
  renderToolResultMessage() {
    return null;
  },
  renderToolUseErrorMessage() {
    return null;
  },
  async call() {
    return {
      data: `${NAME} executed successfully`
    };
  },
  mapToolResultToToolResultBlockParam(result, toolUseID) {
    return {
      type: 'tool_result',
      content: String(result),
      tool_use_id: toolUseID
    };
  }
} satisfies ToolDef<InputSchema, string>);
