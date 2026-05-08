import { describe, expect, it } from 'bun:test';
import { parseSseBuffer } from '../src/sse-parser.js';

describe('parseSseBuffer', () => {
  it('parses a single complete event', () => {
    const buf = 'event: token\ndata: {"text":"Hello"}\n\n';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hello' } });
    expect(remaining).toBe('');
  });

  it('parses two consecutive events', () => {
    const buf =
      'event: token\ndata: {"text":"Hi"}\n\n' +
      'event: done\ndata: {"sessionId":"s1","finishReason":"stop"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('token');
    expect(events[1].event).toBe('done');
  });

  it('leaves incomplete trailing block as remaining', () => {
    const buf = 'event: token\ndata: {"text":"Hi"}\n\nevent: tok';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(remaining).toBe('event: tok');
  });

  it('returns empty events when no complete block', () => {
    const buf = 'event: token\ndata: {"text":"Hi"}';
    const { events, remaining } = parseSseBuffer(buf);
    expect(events).toHaveLength(0);
    expect(remaining).toBe(buf);
  });

  it('skips blocks with malformed JSON', () => {
    const buf =
      'event: token\ndata: not-json\n\n' +
      'event: done\ndata: {"sessionId":"x","finishReason":"stop"}\n\n';
    const { events } = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('done');
  });

  it('handles empty buffer', () => {
    const { events, remaining } = parseSseBuffer('');
    expect(events).toHaveLength(0);
    expect(remaining).toBe('');
  });
});
