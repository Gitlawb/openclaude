import { synthesizeToolUseFromText } from '../../src/api/adapters/ollama-tool-adapter.js';

test('extracts JSON from fenced code block', () => {
  const text = 'Here is the call:\n```json\n{"tool":"search","args":{"q":"foo"}}\n```\nThanks';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.tool).toBe('search');
  expect(res.args.q).toBe('foo');
});

test('extracts JSON from inline object', () => {
  const text = 'Result: {"tool":"calc","args":{"expr":"1+1"}}';
  const res = synthesizeToolUseFromText(text);
  expect(res).not.toBeNull();
  expect(res.tool).toBe('calc');
  expect(res.args.expr).toBe('1+1');
});
