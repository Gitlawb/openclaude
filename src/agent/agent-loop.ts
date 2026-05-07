import { parseToolUse } from './tool-parser.js';

type ToolExecutor = (tool: string, args: Record<string, any>) => Promise<any>;

/**
 * Handle a single model response: parse for tool_use, dispatch if found.
 * Returns true if a tool was dispatched.
 */
export async function handleModelResponse(responseText: string, executor: ToolExecutor, opts?: {maxDispatches?: number}) {
  const max = opts?.maxDispatches ?? 3;
  let dispatches = 0;
  let text = responseText;

  while (dispatches < max) {
    const toolUse = parseToolUse(text);
    if (!toolUse) return false;
    dispatches++;
    await executor(toolUse.tool, toolUse.args);

    // After a dispatch we break — higher level loop can re-query model for follow-ups.
    return true;
  }
  return false;
}
