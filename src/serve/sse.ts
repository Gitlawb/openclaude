import type { ServerResponse } from "node:http";

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseWriter {
  constructor(private res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.flushHeaders?.();
  }
  send(event: string, data: unknown): void {
    this.res.write(formatSseEvent(event, data));
  }
  end(): void {
    this.res.end();
  }
}
