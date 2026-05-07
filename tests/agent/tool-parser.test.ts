import { parseToolUse } from '../../src/agent/tool-parser.js';

test('parses fenced JSON tool use', () => {
  const text = '```json\n{"tool":"echo","args":{"text":"hi"}}\n```';
  const t = parseToolUse(text);
  expect(t).not.toBeNull();
  expect(t.tool).toBe('echo');
  expect(t.args.text).toBe('hi');
});

test('returns null when no json present', () => {
  expect(parseToolUse('hello world')).toBeNull();
});
