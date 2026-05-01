import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-sec-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("security: token enforcement", () => {
  it("all non-public endpoints return 401 without token", async () => {
    const endpoints = [
      { method: "GET", path: "/config" },
      { method: "GET", path: "/sessions" },
      { method: "POST", path: "/chat", body: { message: "x" } },
      { method: "GET", path: "/pending-edits" },
      { method: "GET", path: "/backups?vault=/tmp" },
      { method: "POST", path: "/tools/search", body: { query: "x", vaults: [] } },
    ];
    for (const e of endpoints) {
      const r = await fetch(`${server.url}${e.path}`, {
        method: e.method,
        headers: { "content-type": "application/json" },
        body: e.body ? JSON.stringify(e.body) : undefined,
      });
      expect(r.status).toBe(401);
    }
  });

  it("/health is public (no token required)", async () => {
    const r = await fetch(`${server.url}/health`);
    expect(r.status).toBe(200);
  });

  it("wrong token returns 401", async () => {
    const r = await fetch(`${server.url}/config`, {
      headers: { authorization: "Bearer wrongtoken" },
    });
    expect(r.status).toBe(401);
  });
});

describe("security: bind address", () => {
  it("server binds only to 127.0.0.1 (loopback)", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("security: CORS", () => {
  it("allows Obsidian origin", async () => {
    const r = await fetch(`${server.url}/health`, {
      headers: { origin: "app://obsidian.md" },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe("app://obsidian.md");
  });

  it("blocks foreign origin (no ACAO header)", async () => {
    const r = await fetch(`${server.url}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("security: path confinement in search", () => {
  it("vault with no .md files returns empty results", async () => {
    const v = mkdtempSync(join(tmpdir(), "oc-vlim-"));
    const r = await fetch(`${server.url}/tools/search`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "passwd", vaults: [v] }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results).toEqual([]);
    rmSync(v, { recursive: true, force: true });
  });
});

describe("security: rate limit", () => {
  it("returns 429 after exceeding max requests", async () => {
    const h2 = mkdtempSync(join(tmpdir(), "oc-rl-"));
    process.env.HOME = h2;
    process.env.USERPROFILE = h2;
    const s2 = await startServer({ port: 0 });
    try {
      const headers = { authorization: `Bearer ${s2.token}` };
      let last: Response | undefined;
      for (let i = 0; i < 101; i++) {
        last = await fetch(`${s2.url}/config`, { headers });
      }
      expect(last?.status).toBe(429);
    } finally {
      await s2.stop();
      rmSync(h2, { recursive: true, force: true });
    }
  });
});

describe("security: tripwires (Windows-compatible)", () => {
  it("mermaid-graph refuses missing vault+seedNote", async () => {
    const r = await fetch(`${server.url}/tools/mermaid-graph`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("search refuses missing query param", async () => {
    const r = await fetch(`${server.url}/tools/search`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ vaults: [] }),
    });
    expect(r.status).toBe(400);
  });
});
