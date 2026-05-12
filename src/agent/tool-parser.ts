import { synthesizeToolUseFromText } from '../api/adapters/ollama-tool-adapter.js';

export type ToolUse = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
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
    const name = maybe?.tool ?? maybe?.name;
    if (maybe && typeof name === 'string' && name) {
      return {
        type: 'tool_use',
        id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name,
        input: maybe.args ?? maybe.input ?? maybe.arguments ?? {},
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}
