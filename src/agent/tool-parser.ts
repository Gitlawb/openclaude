import { synthesizeToolUseFromText } from '../api/adapters/ollama-tool-adapter.js';

export type ToolUse = {
  type: 'tool_use';
  tool: string;
  args: Record<string, any>;
};

/**
 * Parse text responses to find embedded tool-use JSON and synthesize a ToolUse
 */
export function parseToolUse(text: string): ToolUse | null {
  if (!text) return null;
  const synth = synthesizeToolUseFromText(text);
  if (synth) return synth as ToolUse;

  // fallback: attempt looser heuristics
  try {
    const maybe = JSON.parse(text);
    if (maybe && maybe.tool) return { type: 'tool_use', tool: maybe.tool, args: maybe.args || {} };
  } catch (e) {
    // ignore
  }
  return null;
}
