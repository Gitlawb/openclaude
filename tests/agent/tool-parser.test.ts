import { parseToolUse } from '../../src/agent/tool-parser.js';

test('parses fenced JSON tool use', () => {
  const text = '```json\n{"tool":"echo","args":{"text":"hi"}}\n```';
  const t = parseToolUse(text);
  expect(t).not.toBeNull();
  expect(t.name).toBe('echo');
  expect(t.input.text).toBe('hi');
});

test('parses OpenAI-style name and arguments shape', () => {
  const t = parseToolUse('{"name":"echo","arguments":{"text":"hi"}}');
  expect(t).not.toBeNull();
  expect(t.name).toBe('echo');
  expect(t.input.text).toBe('hi');
});

test('parses tool and input shape', () => {
  const t = parseToolUse('{"tool":"echo","input":{"text":"hi"}}');
  expect(t).not.toBeNull();
  expect(t.name).toBe('echo');
  expect(t.input.text).toBe('hi');
});

test('returns null when no json present', () => {
  expect(parseToolUse('hello world')).toBeNull();
});

test('returned object exposes name and input fields only', () => {
  const t = parseToolUse('{"tool":"echo","args":{"text":"hi"}}');
  expect(t).not.toBeNull();
  expect(t).toMatchObject({
    type: 'tool_use',
    name: 'echo',
    input: { text: 'hi' },
  });
  expect(typeof t.id).toBe('string');
  expect('tool' in t).toBe(false);
  expect('args' in t).toBe(false);
});
