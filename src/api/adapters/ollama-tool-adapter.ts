/**
 * Ollama tool adapter
 * - injects system prompt instructions for tool schemas
 * - normalizes responses by extracting JSON and synthesizing a tool_use block
 */
export function injectToolInstructions(systemPrompt: string, toolSchemas: any[]): string {
  const schemas = JSON.stringify(toolSchemas || [], null, 2);
  return [
    systemPrompt,
    '\n\n# Tool Schemas (injected by ollama-tool-adapter)',
    schemas,
    '\n\n# Output Format',
    'When you want to call a tool, emit a JSON object only (no surrounding text) with the shape:',
    '{"tool":"<toolName>","args":{...}}',
  ].join('\n');
}

export function synthesizeToolUseFromText(text: string) {
  // look for JSON in code fences ```json ... ``` or anywhere in text
  const fenceJson = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const candidate = fenceJson ? fenceJson[1].trim() : extractFirstJson(text);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed.tool) {
      return {
        type: 'tool_use',
        tool: parsed.tool,
        args: parsed.args || {},
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function extractFirstJson(s: string) {
  // naive: find first { and matching }
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0) return s.slice(start, i + 1);
  }
  return null;
}
