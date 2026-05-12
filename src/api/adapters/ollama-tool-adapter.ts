/**
 * Ollama tool adapter
 * - injects system prompt instructions for tool schemas
 * - normalizes responses by extracting JSON and synthesizing a tool_use block
 */
export function injectToolInstructions(systemPrompt: string, toolSchemas: any[]): string {
  if (!toolSchemas || toolSchemas.length === 0) return systemPrompt;

  const schemas = JSON.stringify(toolSchemas || [], null, 2);
  return [
    systemPrompt,
    '\n\n# Tool Schemas (injected by ollama-tool-adapter)',
    schemas,
    '\n\n# Output Format',
    'When you want to call a tool, emit a JSON object only (no surrounding text) using any of these accepted shapes:',
    '{"tool":"<toolName>","args":{...}}',
    '{"tool":"<toolName>","input":{...}}',
    '{"name":"<toolName>","arguments":{...}}',
  ].join('\n');
}

export function synthesizeToolUseFromText(text: string) {
  // look for JSON in code fences ```json ... ``` or anywhere in text
  const fenceJson = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const candidate = fenceJson ? fenceJson[1].trim() : extractFirstJson(text);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    const name = parsed?.tool ?? parsed?.name;
    if (typeof parsed === 'object' && typeof name === 'string' && name) {
      return {
        type: 'tool_use',
        id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name,
        input: parsed.args ?? parsed.input ?? parsed.arguments ?? {},
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function extractFirstJson(s: string) {
  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
