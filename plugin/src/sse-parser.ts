import type { SseEvent } from './types.js';

export function parseSseBuffer(buffer: string): { events: SseEvent[]; remaining: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split('\n\n');
  // Last element is either empty (after trailing \n\n) or an incomplete block
  const remaining = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = '';
    let dataLine = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6);
    }
    if (!eventName || !dataLine) continue;
    try {
      events.push({ event: eventName, data: JSON.parse(dataLine) } as SseEvent);
    } catch {
      // skip malformed data line
    }
  }

  return { events, remaining };
}
