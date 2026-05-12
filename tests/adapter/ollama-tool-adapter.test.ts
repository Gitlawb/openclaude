import {
  injectToolInstructions,
  synthesizeToolUseFromText,
} from '../../src/api/adapters/ollama-tool-adapter.js';
import { adaptOutgoing } from '../../src/api/providers/ollama.js';

test('extracts JSON from fenced code block', () => {
  const text = 'Here is the call:\n```json\n{"tool":"search","args":{"q":"foo"}}\n```\nThanks';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.name).toBe('search');
  expect(res.input.q).toBe('foo');
});

test('extracts JSON from inline object', () => {
  const text = 'Result: {"tool":"calc","args":{"expr":"1+1"}}';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.name).toBe('calc');
  expect(res.input.expr).toBe('1+1');
});

test('parses OpenAI-style name and arguments shape', () => {
  const res = synthesizeToolUseFromText('{"name":"search","arguments":{"q":"foo"}}');
  expect(res).not.toBeNull();
  expect(res.name).toBe('search');
  expect(res.input.q).toBe('foo');
});

test('parses tool and input shape', () => {
  const res = synthesizeToolUseFromText('{"tool":"search","input":{"q":"foo"}}');
  expect(res).not.toBeNull();
  expect(res.name).toBe('search');
  expect(res.input.q).toBe('foo');
});

test('extracts prose-wrapped JSON object', () => {
  const text = 'I will use a tool now: {"tool":"read","args":{"file":"README.md"}} and then continue.';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.name).toBe('read');
  expect(res.input.file).toBe('README.md');
});

test('extracts JSON with braces inside a string argument', () => {
  const text = '{"tool":"run","args":{"code":"if (x) { return y; }"}}';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.name).toBe('run');
  expect(res.input.code).toBe('if (x) { return y; }');
});

test('injectToolInstructions is unchanged with empty tool schemas', () => {
  const system = 'You are concise.';
  expect(injectToolInstructions(system, [])).toBe(system);
});

test('adaptOutgoing is unchanged with empty tool schemas', () => {
  const request = {
    model: 'qwen2.5-coder',
    messages: [{ role: 'system', content: 'You are concise.' }],
  };
  expect(adaptOutgoing(request, [])).toBe(request);
});

test('synthetic tool_use block exposes id, name, and input fields', () => {
  const res = synthesizeToolUseFromText('{"tool":"search","args":{"q":"foo"}}');
  expect(res).toMatchObject({
    type: 'tool_use',
    name: 'search',
    input: { q: 'foo' },
  });
  expect(typeof res.id).toBe('string');
  expect(res.id).toMatch(/^ollama_/);
  expect('tool' in res).toBe(false);
  expect('args' in res).toBe(false);
});
