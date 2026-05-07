import { injectToolInstructions, synthesizeToolUseFromText } from '../adapters/ollama-tool-adapter.js';

export type OllamaRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: any[];
};

export type OllamaResponse = {
  text: string;
};

/**
 * Adapt an outgoing request for Ollama: inject tool schemas into the system prompt
 */
export function adaptOutgoing(request: OllamaRequest, toolSchemas: any[] = []) : OllamaRequest {
  const sysIdx = request.messages.findIndex(m => m.role === 'system');
  const original = sysIdx >= 0 ? request.messages[sysIdx].content : '';
  const injected = injectToolInstructions(original, toolSchemas);
  const messages = [...request.messages];
  if (sysIdx >= 0) messages[sysIdx] = { role: 'system', content: injected };
  else messages.unshift({ role: 'system', content: injected });
  return { ...request, messages };
}

/**
 * Normalize an Ollama response by synthesizing a tool_use block if JSON is embedded
 */
export function adaptIncoming(resp: OllamaResponse) {
  const synth = synthesizeToolUseFromText(resp.text || '');
  if (synth) {
    return { syntheticToolUse: synth, original: resp };
  }
  return { syntheticToolUse: null, original: resp };
}
