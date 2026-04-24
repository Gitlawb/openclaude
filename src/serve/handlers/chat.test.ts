import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setMockAgent } from "./chat";

let server: ServerHandle;
let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-chat-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  setMockAgent(async function* () {
    yield { event: "token", data: { text: "Hello " } };
    yield { event: "token", data: { text: "world" } };
    yield { event: "done", data: { finishReason: "stop" } };
  });
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

async function parseSse(body: ReadableStream<Uint8Array> | null): Promise<Array<{ event: string; data: any }>> {
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<{ event: string; data: any }> = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = chunk.split("\n");
      const event = lines.find(l => l.startsWith("event: "))?.slice(7) ?? "";
      const dataLine = lines.find(l => l.startsWith("data: "))?.slice(6) ?? "null";
      events.push({ event, data: JSON.parse(dataLine) });
    }
  }
  return events;
}

describe("POST /chat", () => {
  it("streams SSE events from mock agent", async () => {
    const r = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const events = await parseSse(r.body);
    expect(events.map(e => e.event)).toEqual(["token", "token", "done"]);
    expect(events[0]?.data).toEqual({ text: "Hello " });
  });

  it("creates session if none provided", async () => {
    const r = await fetch(`${server.url}/chat`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const events = await parseSse(r.body);
    const done = events.find(e => e.event === "done");
    expect(done?.data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
