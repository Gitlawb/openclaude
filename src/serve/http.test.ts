import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHttpApp, type Route } from "./http";
import type { Server } from "node:http";

let app: { server: Server; port: number };
const token = "testtoken".repeat(8); // 64 chars

const routes: Route[] = [
  { method: "GET", path: "/ping", handler: async () => ({ status: 200, body: { ok: true } }) },
  { method: "GET", path: "/echo/:id", handler: async (req) => ({ status: 200, body: { id: req.params.id } }) },
];

beforeEach(async () => {
  app = await createHttpApp({ token, routes, rateLimit: { windowMs: 60000, max: 100 } });
});
afterEach(async () => {
  await new Promise<void>((r) => app.server.close(() => r()));
});

async function call(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${app.port}${path}`, { headers });
}

describe("HTTP app", () => {
  it("rejects requests without Bearer token (401)", async () => {
    const r = await call("/ping");
    expect(r.status).toBe(401);
  });

  it("accepts valid Bearer (200)", async () => {
    const r = await call("/ping", { authorization: `Bearer ${token}` });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("resolves path params", async () => {
    const r = await call("/echo/abc", { authorization: `Bearer ${token}` });
    expect(await r.json()).toEqual({ id: "abc" });
  });

  it("returns 404 for unknown path", async () => {
    const r = await call("/nope", { authorization: `Bearer ${token}` });
    expect(r.status).toBe(404);
  });

  it("returns 404 for malformed URI in path param (no uncaught throw)", async () => {
    const r = await call("/echo/%GG", { authorization: `Bearer ${token}` });
    expect(r.status).toBe(404);
  });

  it("CORS: Obsidian origin allowed", async () => {
    const r = await call("/ping", {
      authorization: `Bearer ${token}`,
      origin: "app://obsidian.md",
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("app://obsidian.md");
  });

  it("CORS: foreign origin blocked", async () => {
    const r = await call("/ping", {
      authorization: `Bearer ${token}`,
      origin: "https://evil.example",
    });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limit: 429 after max", async () => {
    const app2 = await createHttpApp({ token, routes, rateLimit: { windowMs: 60000, max: 2 } });
    try {
      const u = `http://127.0.0.1:${app2.port}/ping`;
      const h = { authorization: `Bearer ${token}` };
      const r1 = await fetch(u, { headers: h });
      const r2 = await fetch(u, { headers: h });
      const r3 = await fetch(u, { headers: h });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
    } finally {
      await new Promise<void>((r) => app2.server.close(() => r()));
    }
  });
});
