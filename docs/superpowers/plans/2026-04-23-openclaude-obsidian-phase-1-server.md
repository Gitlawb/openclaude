# openclaude-obsidian — Plan #1: Server Foundation (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `openclaude serve` HTTP/SSE server — the backend foundation that the future Obsidian plugin will talk to. End of Phase 1 = a usable local HTTP server with 21 endpoints, token auth, SSE streaming, session persistence, and a passing security test suite.

**Architecture:** New module `src/serve/` inside the OpenClaude repo, exposed via a new CLI subcommand `openclaude serve`. Uses native Node `http` module (no new runtime dep), delegates agent work to the existing OpenClaude core (Query engine, tools, providers). All state persists under `~/.openclaude/` (sessions, token, pending-edits).

**Tech Stack:** TypeScript strict, Bun test, native `http` + `crypto`, reuse of existing OpenClaude modules (`src/query`, `src/tools/*`, provider adapters). No new production dependencies.

**Phase scope (what ships at end of Phase 1):** Server runs, authenticates, streams chat responses via SSE using existing agent loop, persists sessions to disk, creates shadow backups before edits, tracks pending edits. **Plugin is NOT built in this phase** — it comes in Plan #2.

**Out of scope for Phase 1 (handled in Plans #2-#4):**
- Obsidian plugin UI/UX (Plan #2)
- P3 preset config system enforcement inside the agent loop (Plan #4)
- CLI installer `openclaude obsidian install` (Plan #4)
- Dataview UI rendering (Plan #3 — server side is in this phase)
- E2E tests with Playwright (Plan #4)

---

## File Structure (locked decisions)

**New files (source + tests co-located as `*.test.ts`):**
- `src/serve/index.ts` / `index.test.ts` — main entry, exported `startServer(opts)`
- `src/serve/auth.ts` / `auth.test.ts` — token generation + bearer middleware
- `src/serve/http.ts` / `http.test.ts` — native http wrapper with routing, CORS, rate limit
- `src/serve/sse.ts` / `sse.test.ts` — SSE response helper
- `src/serve/session.ts` / `session.test.ts` — session manager
- `src/serve/errors.ts` / `errors.test.ts` — typed error codes
- `src/serve/tripwires.ts` / `tripwires.test.ts` — command/path denylist
- `src/serve/paths.ts` / `paths.test.ts` — vault-bound path validation
- `src/serve/vaultRegistry.ts` / `vaultRegistry.test.ts`
- `src/serve/pendingEditStore.ts` / `pendingEditStore.test.ts`
- `src/serve/backup.ts` / `backup.test.ts` — shadow backup manager
- `src/serve/agentAdapter.ts` / `agentAdapter.test.ts` — bridge to OpenClaude core
- `src/serve/handlers/health.ts` / `health.test.ts`
- `src/serve/handlers/config.ts` / `config.test.ts`
- `src/serve/handlers/sessions.ts` / `sessions.test.ts`
- `src/serve/handlers/chat.ts` / `chat.test.ts`
- `src/serve/handlers/models.ts` / `models.test.ts`
- `src/serve/handlers/vaults.ts` / `vaults.test.ts`
- `src/serve/handlers/pendingEdits.ts` / `pendingEdits.test.ts`
- `src/serve/handlers/backups.ts` / `backups.test.ts`
- `src/serve/handlers/tools.ts` — search, dataview, analyze-results, mermaid-graph
- `src/serve/handlers/tools.search.test.ts`, `tools.dataview.test.ts`, `tools.mermaid.test.ts`
- `src/serve/security.test.ts` — end-to-end security matrix
- `src/commands/serve/index.ts` — CLI subcommand dispatch
- `src/serve/README.md` — developer docs

**Modified files:**
- `bin/openclaude` or the CLI dispatch file (detected in Task 1) — wire `serve` subcommand
- `package.json` — add `test:serve` script

**State directories (created at runtime under the user's home, NOT in the repo):**
- `~/.openclaude/server-token` — mode 0600 on Unix
- `~/.openclaude/sessions/<id>.jsonl`
- `~/.openclaude/pending-edits/<id>.json`
- `~/.openclaude/vaults.yml`
- `~/.openclaude/server-config.json`

---

## Task Overview (run in order)

1. Scaffold `src/serve/` + CLI subcommand (minimal 501 responder)
2. Token auth generator + bearer middleware
3. HTTP core with routing, CORS, rate limit
4. `/health` endpoint
5. Typed errors + standard JSON response
6. Path normalization + vault-bound validation
7. Tripwires (security backstop)
8. Vault registry (`~/.openclaude/vaults.yml`)
9. Session manager (in-memory + JSONL persist)
10. `/sessions` endpoints (list/get/delete)
11. SSE helper + `/chat` endpoint with mock agent
12. Integrate real OpenClaude Query engine into `/chat`
13. Pending edits store + `/pending-edits` endpoints
14. Shadow backup + `/backups` endpoints
15. `/config` + `/models` + `/vaults` endpoints
16. `/tools/search` (cross-vault text search)
17. `/tools/dataview` + `/tools/analyze-results`
18. `/tools/mermaid-graph`
19. End-to-end security test matrix
20. README + manual smoke + tag milestone

---

### Task 1: Scaffold `src/serve/` module + CLI subcommand

**Files:**
- Create: `src/serve/index.ts`
- Create: `src/serve/index.test.ts`
- Create: `src/commands/serve/index.ts`
- Modify: CLI dispatch (location detected in Step 1)

- [ ] **Step 1: Inspect CLI dispatch**

Run: `grep -rn "subcommand\|argv\[2\]\|process.argv" src/entrypoints/ src/cli/ | head -20`
Goal: identify the file where OpenClaude parses subcommand args. Note it for Step 7.

- [ ] **Step 2: Write the failing test**

Create `src/serve/index.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { startServer } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("startServer", () => {
  it("returns server info with url, port, token, stop()", async () => {
    const home = mkdtempSync(join(tmpdir(), "oc-s-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const server = await startServer({ port: 0 });
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.port).toBeGreaterThan(0);
      expect(typeof server.token).toBe("string");
      expect(server.token.length).toBe(64);
      await server.stop();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `bun test src/serve/index.test.ts`
Expected: FAIL with "Cannot find module './index'".

- [ ] **Step 4: Minimal `src/serve/index.ts`**

```typescript
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export type ServerOpts = {
  port?: number;
  projectDir?: string;
};

export type ServerHandle = {
  url: string;
  port: number;
  token: string;
  stop: () => Promise<void>;
};

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const token = randomBytes(32).toString("hex");
  const server: Server = createServer((_req, res) => {
    res.writeHead(501);
    res.end("Not implemented");
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind");
  const port = addr.port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 5: Run test, expect PASS**

Run: `bun test src/serve/index.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Create CLI subcommand stub**

Create `src/commands/serve/index.ts`:

```typescript
import { startServer } from "../../serve/index";

export async function serveCommand(args: string[]): Promise<void> {
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1]!, 10) : 0;
  const projectIdx = args.indexOf("--project-dir");
  const projectDir = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const server = await startServer({ port, projectDir });
  const info = { type: "server-started", url: server.url, port: server.port, token: "***redacted***" };
  console.log(JSON.stringify(info));
  const shutdown = async () => { await server.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
```

- [ ] **Step 7: Wire into CLI dispatch**

In the file found in Step 1, add a branch for `serve`. Typical pattern (adapt to actual dispatcher):

```typescript
if (subcommand === "serve") {
  const { serveCommand } = await import("./commands/serve/index");
  await serveCommand(process.argv.slice(3));
  return;
}
```

- [ ] **Step 8: Build and test manually**

Run: `bun run build`
Then in a terminal, run: `node dist/cli.mjs serve --port 7777`
Expected: prints the JSON `server-started` message; blocks until Ctrl+C.

- [ ] **Step 9: Commit**

```
git add src/serve/index.ts src/serve/index.test.ts src/commands/serve/index.ts
git commit -m "feat(serve): scaffold openclaude serve subcommand (empty 501 responder)"
```

If CLI dispatch was modified, include that file in the add.

---

### Task 2: Token auth generator + bearer middleware

**Files:**
- Create: `src/serve/auth.ts` and `src/serve/auth.test.ts`
- Modify: `src/serve/index.ts` and `src/serve/index.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/serve/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureServerToken, verifyBearer } from "./auth";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-auth-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("ensureServerToken", () => {
  it("creates 64-char hex token on first call", () => {
    const token = ensureServerToken(home);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const path = join(home, ".openclaude", "server-token");
    expect(readFileSync(path, "utf8")).toBe(token);
  });

  it("reuses existing token on subsequent calls", () => {
    const t1 = ensureServerToken(home);
    const t2 = ensureServerToken(home);
    expect(t1).toBe(t2);
  });

  it("writes token file with mode 0600 on unix", () => {
    if (process.platform === "win32") return;
    ensureServerToken(home);
    const mode = statSync(join(home, ".openclaude", "server-token")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("verifyBearer", () => {
  it("accepts matching token", () => {
    expect(verifyBearer("Bearer abc123", "abc123")).toBe(true);
  });
  it("rejects missing header", () => {
    expect(verifyBearer(undefined, "abc123")).toBe(false);
  });
  it("rejects wrong prefix", () => {
    expect(verifyBearer("Basic abc123", "abc123")).toBe(false);
  });
  it("rejects mismatch", () => {
    expect(verifyBearer("Bearer abc124", "abc123")).toBe(false);
  });
  it("rejects unequal length without leaking timing", () => {
    expect(verifyBearer("Bearer x", "xy")).toBe(false);
    expect(verifyBearer("Bearer xy", "xy")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/auth.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `src/serve/auth.ts`**

```typescript
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function ensureServerToken(home = homedir()): string {
  const dir = join(home, ".openclaude");
  const path = join(dir, "server-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { encoding: "utf8" });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return token;
}

export function verifyBearer(header: string | undefined, expected: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire into `startServer`**

Modify `src/serve/index.ts` to use `ensureServerToken`:

```typescript
import { ensureServerToken } from "./auth";
// ...
export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const token = ensureServerToken();
  // ... rest unchanged for now
}
```

- [ ] **Step 6: Run full suite**

Run: `bun test src/serve/`
Expected: all green.

- [ ] **Step 7: Commit**

```
git add src/serve/auth.ts src/serve/auth.test.ts src/serve/index.ts
git commit -m "feat(serve): add token generator + bearer middleware with constant-time compare"
```

---

### Task 3: HTTP core — routing, CORS, rate limit

**Files:**
- Create: `src/serve/http.ts`
- Create: `src/serve/http.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/serve/http.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/http.test.ts`

- [ ] **Step 3: Implement `src/serve/http.ts`**

```typescript
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { verifyBearer } from "./auth";

export type RouteHandler = (req: {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  raw: IncomingMessage;
  res: ServerResponse;
}) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | void>;

export type Route = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: RouteHandler;
  public?: boolean;
};

export type HttpAppOpts = {
  token: string;
  routes: Route[];
  rateLimit?: { windowMs: number; max: number };
  allowedOrigin?: string;
};

type Matched = { route: Route; params: Record<string, string> };

function matchRoute(routes: Route[], method: string, pathname: string): Matched | undefined {
  for (const route of routes) {
    if (route.method !== method) continue;
    const rp = route.path.split("/").filter(Boolean);
    const ap = pathname.split("/").filter(Boolean);
    if (rp.length !== ap.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i]!.startsWith(":")) params[rp[i]!.slice(1)] = decodeURIComponent(ap[i]!);
      else if (rp[i] !== ap[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return undefined;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); } catch { return text; }
}

export async function createHttpApp(opts: HttpAppOpts): Promise<{ server: Server; port: number }> {
  const allowedOrigin = opts.allowedOrigin ?? "app://obsidian.md";
  const hits = new Map<string, { count: number; resetAt: number }>();
  const rl = opts.rateLimit;

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const matched = matchRoute(opts.routes, req.method ?? "GET", url.pathname);
    if (!matched) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
      return;
    }

    if (!matched.route.public) {
      if (!verifyBearer(req.headers.authorization, opts.token)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } }));
        return;
      }
    }

    if (rl) {
      const key = req.socket.remoteAddress ?? "?";
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt < now) {
        hits.set(key, { count: 1, resetAt: now + rl.windowMs });
      } else {
        entry.count++;
        if (entry.count > rl.max) {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "RATE_LIMIT", retryAfterMs: entry.resetAt - now } }));
          return;
        }
      }
    }

    const body = (req.method === "POST" || req.method === "PUT") ? await readBody(req) : undefined;
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (query[k] = v));

    try {
      const result = await matched.route.handler({
        params: matched.params,
        query,
        body,
        headers: req.headers,
        raw: req,
        res,
      });
      if (res.writableEnded) return;
      const status = result?.status ?? 200;
      const extra = result?.headers ?? {};
      if (status === 204 || result?.body === undefined) {
        res.writeHead(status, extra);
        res.end();
        return;
      }
      res.writeHead(status, { "content-type": "application/json", ...extra });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "INTERNAL", message: String(err) } }));
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, port: addr.port };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/http.test.ts`

- [ ] **Step 5: Commit**

```
git add src/serve/http.ts src/serve/http.test.ts
git commit -m "feat(serve): add HTTP core with routing, CORS, and rate limit"
```

---

### Task 4: `/health` endpoint

**Files:**
- Create: `src/serve/handlers/health.ts` and `health.test.ts`
- Modify: `src/serve/index.ts` to use `createHttpApp` with routes

- [ ] **Step 1: Write failing test**

`src/serve/handlers/health.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-h-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("responds 200 without token (public)", async () => {
    const r = await fetch(`${server.url}/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("ok");
    expect(j.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof j.uptime_ms).toBe("number");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/health.test.ts`

- [ ] **Step 3: Implement handler**

`src/serve/handlers/health.ts`:

```typescript
import type { Route } from "../http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();

export const healthRoute: Route = {
  method: "GET",
  path: "/health",
  public: true,
  handler: async () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return {
      status: 200,
      body: {
        status: "ok",
        version: pkg.version,
        uptime_ms: Date.now() - startedAt,
      },
    };
  },
};
```

- [ ] **Step 4: Wire in `src/serve/index.ts`**

Replace the 501 stub:

```typescript
import { createHttpApp } from "./http";
import { ensureServerToken } from "./auth";
import { healthRoute } from "./handlers/health";

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const token = ensureServerToken();
  const routes = [healthRoute];
  const app = await createHttpApp({
    token, routes,
    rateLimit: { windowMs: 60_000, max: 100 },
  });
  return {
    url: `http://127.0.0.1:${app.port}`,
    port: app.port,
    token,
    stop: () => new Promise<void>((r) => app.server.close(() => r())),
  };
}
```

- [ ] **Step 5: Run full suite — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 6: Commit**

```
git add src/serve/handlers/health.ts src/serve/handlers/health.test.ts src/serve/index.ts
git commit -m "feat(serve): add /health endpoint (public, no auth)"
```

---

### Task 5: Typed errors + standard JSON response

**Files:**
- Create: `src/serve/errors.ts` and `errors.test.ts`
- Modify: `src/serve/http.ts` (use ServerError)

- [ ] **Step 1: Write failing tests**

`src/serve/errors.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { ServerError, errorResponse, ErrorCode } from "./errors";

describe("ServerError", () => {
  it("carries code, message, httpStatus", () => {
    const e = new ServerError(ErrorCode.UNAUTHORIZED, "nope");
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("nope");
    expect(e.httpStatus).toBe(401);
  });

  it("maps codes to HTTP status", () => {
    expect(new ServerError(ErrorCode.NOT_FOUND, "").httpStatus).toBe(404);
    expect(new ServerError(ErrorCode.RATE_LIMIT, "").httpStatus).toBe(429);
    expect(new ServerError(ErrorCode.CONFLICT, "").httpStatus).toBe(409);
    expect(new ServerError(ErrorCode.VAULT_UNAVAILABLE, "").httpStatus).toBe(503);
    expect(new ServerError(ErrorCode.INTERNAL, "").httpStatus).toBe(500);
    expect(new ServerError(ErrorCode.TRIPWIRE_BLOCKED, "").httpStatus).toBe(403);
  });
});

describe("errorResponse", () => {
  it("formats JSON error shape", () => {
    const r = errorResponse(new ServerError(ErrorCode.UNAUTHORIZED, "nope"));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: "UNAUTHORIZED", message: "nope" } });
  });

  it("includes extras", () => {
    const e = new ServerError(ErrorCode.RATE_LIMIT, "slow", { retryAfterMs: 5000 });
    const r = errorResponse(e);
    expect(r.body).toEqual({ error: { code: "RATE_LIMIT", message: "slow", retryAfterMs: 5000 } });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/errors.test.ts`

- [ ] **Step 3: Implement**

`src/serve/errors.ts`:

```typescript
export const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT: "RATE_LIMIT",
  CONFLICT: "CONFLICT",
  VALIDATION: "VALIDATION",
  VAULT_UNAVAILABLE: "VAULT_UNAVAILABLE",
  TRIPWIRE_BLOCKED: "TRIPWIRE_BLOCKED",
  MODEL_RATE_LIMIT: "MODEL_RATE_LIMIT",
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  MODEL_AUTH: "MODEL_AUTH",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  NETWORK: "NETWORK",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_MAP: Record<ErrorCodeType, number> = {
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMIT: 429,
  CONFLICT: 409,
  VALIDATION: 400,
  VAULT_UNAVAILABLE: 503,
  TRIPWIRE_BLOCKED: 403,
  MODEL_RATE_LIMIT: 429,
  MODEL_TIMEOUT: 504,
  MODEL_AUTH: 401,
  MODEL_NOT_FOUND: 404,
  NETWORK: 502,
  INTERNAL: 500,
};

export class ServerError extends Error {
  code: ErrorCodeType;
  httpStatus: number;
  extras?: Record<string, unknown>;
  constructor(code: ErrorCodeType, message: string, extras?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.httpStatus = STATUS_MAP[code];
    this.extras = extras;
  }
}

export function errorResponse(err: ServerError): { status: number; body: { error: Record<string, unknown> } } {
  return {
    status: err.httpStatus,
    body: { error: { code: err.code, message: err.message, ...(err.extras ?? {}) } },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/errors.test.ts`

- [ ] **Step 5: Update `http.ts` catch to handle ServerError**

In the catch block of `createHttpApp`, before the generic handler:

```typescript
import { ServerError, errorResponse } from "./errors";

// inside catch:
if (err instanceof ServerError) {
  const r = errorResponse(err);
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(JSON.stringify(r.body));
  return;
}
```

- [ ] **Step 6: Commit**

```
git add src/serve/errors.ts src/serve/errors.test.ts src/serve/http.ts
git commit -m "feat(serve): add typed ServerError with HTTP status mapping"
```

---

### Task 6: Path normalization + vault-bound validation

**Files:**
- Create: `src/serve/paths.ts` and `paths.test.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/paths.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { resolveInsideVault, isPathInside } from "./paths";

describe("resolveInsideVault", () => {
  it("resolves relative path inside vault", () => {
    expect(resolveInsideVault("/vault", "FinPower.md")).toBe("/vault/FinPower.md");
  });
  it("normalizes ./ and ..", () => {
    expect(resolveInsideVault("/vault", "./sub/../FinPower.md")).toBe("/vault/FinPower.md");
  });
  it("throws on escape via ..", () => {
    expect(() => resolveInsideVault("/vault", "../secret")).toThrow(/escape/i);
    expect(() => resolveInsideVault("/vault", "../../etc/passwd")).toThrow(/escape/i);
  });
  it("throws on absolute path outside vault", () => {
    expect(() => resolveInsideVault("/vault", "/etc/passwd")).toThrow(/escape/i);
  });
  it("accepts absolute path inside vault", () => {
    expect(resolveInsideVault("/vault", "/vault/sub/note.md")).toBe("/vault/sub/note.md");
  });
});

describe("isPathInside", () => {
  it("true for nested", () => {
    expect(isPathInside("/vault", "/vault/sub/a.md")).toBe(true);
  });
  it("false for outside", () => {
    expect(isPathInside("/vault", "/other/a.md")).toBe(false);
  });
  it("false for sibling prefix match", () => {
    expect(isPathInside("/vault", "/vaultx/a.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/paths.test.ts`

- [ ] **Step 3: Implement**

`src/serve/paths.ts`:

```typescript
import { resolve, sep, isAbsolute } from "node:path";
import { ServerError, ErrorCode } from "./errors";

export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p + sep);
}

export function resolveInsideVault(vaultRoot: string, userPath: string): string {
  const abs = isAbsolute(userPath) ? resolve(userPath) : resolve(vaultRoot, userPath);
  if (!isPathInside(vaultRoot, abs)) {
    throw new ServerError(ErrorCode.VALIDATION, `path escapes vault: ${userPath}`);
  }
  return abs;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/paths.test.ts`

- [ ] **Step 5: Commit**

```
git add src/serve/paths.ts src/serve/paths.test.ts
git commit -m "feat(serve): add vault-bound path resolution (blocks .. escapes)"
```

---

### Task 7: Tripwires (security backstop)

**Files:**
- Create: `src/serve/tripwires.ts` and `tripwires.test.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/tripwires.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { checkBashTripwire, checkFilesystemTripwire } from "./tripwires";

describe("checkBashTripwire", () => {
  it("blocks rm -rf *", () => {
    expect(() => checkBashTripwire("rm -rf *")).toThrow(/tripwire/i);
  });
  it("blocks rm -rf /vault/*", () => {
    expect(() => checkBashTripwire("rm -rf /home/user/vault/*")).toThrow(/tripwire/i);
  });
  it("blocks force push to main", () => {
    expect(() => checkBashTripwire("git push --force origin main")).toThrow(/tripwire/i);
  });
  it("allows git status", () => {
    expect(() => checkBashTripwire("git status")).not.toThrow();
  });
  it("allows ls -la", () => {
    expect(() => checkBashTripwire("ls -la")).not.toThrow();
  });
});

describe("checkFilesystemTripwire", () => {
  it("blocks write to ~/.claude/settings.json", () => {
    expect(() => checkFilesystemTripwire("write", "/home/user/.claude/settings.json")).toThrow(/tripwire/i);
  });
  it("blocks write to .openclaude/permissions.yml", () => {
    expect(() => checkFilesystemTripwire("write", "/vault/.openclaude/permissions.yml")).toThrow(/tripwire/i);
  });
  it("allows write to a normal note", () => {
    expect(() => checkFilesystemTripwire("write", "/vault/FinPower.md")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/tripwires.test.ts`

- [ ] **Step 3: Implement**

`src/serve/tripwires.ts`:

```typescript
import { ServerError, ErrorCode } from "./errors";

const BASH_DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[rf]+\s+)+(\/|\*|~)/i,
  /\bgit\s+push\s+.*(--force|-f)\b.*\b(main|master)\b/i,
  /\bchmod\s+777\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=.+of=\/dev\//i,
  /\bcurl\s+[^|]+\|\s*(sh|bash)/i,
];

const FS_PROTECTED_SUFFIXES: RegExp[] = [
  /\.claude\/settings(\.local)?\.json$/,
  /\.openclaude\/permissions\.yml$/,
  /\.openclaude\/commands\.yml$/,
];

export function checkBashTripwire(command: string): void {
  for (const re of BASH_DENY_PATTERNS) {
    if (re.test(command)) {
      throw new ServerError(ErrorCode.TRIPWIRE_BLOCKED, `bash command blocked by tripwire: ${re.source}`);
    }
  }
}

export function checkFilesystemTripwire(op: "write" | "delete", path: string): void {
  for (const re of FS_PROTECTED_SUFFIXES) {
    if (re.test(path)) {
      throw new ServerError(ErrorCode.TRIPWIRE_BLOCKED, `${op} on ${path} blocked by tripwire`);
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/tripwires.test.ts`

- [ ] **Step 5: Commit**

```
git add src/serve/tripwires.ts src/serve/tripwires.test.ts
git commit -m "feat(serve): add tripwires for destructive shell and protected config writes"
```

---

### Task 8: Vault registry

**Files:**
- Create: `src/serve/vaultRegistry.ts` and `vaultRegistry.test.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/vaultRegistry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultRegistry } from "./vaultRegistry";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-vr-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("VaultRegistry", () => {
  it("starts empty", () => {
    expect(new VaultRegistry(home).list()).toEqual([]);
  });

  it("add/list/remove roundtrip", () => {
    const r = new VaultRegistry(home);
    r.add({ name: "Energinova_Hub", path: "/vaults/energinova" });
    r.add({ name: "FinPower", path: "/vaults/finpower" });
    expect(r.list().map(v => v.name)).toEqual(["Energinova_Hub", "FinPower"]);
    r.remove("Energinova_Hub");
    expect(r.list().map(v => v.name)).toEqual(["FinPower"]);
  });

  it("persists across instances", () => {
    new VaultRegistry(home).add({ name: "A", path: "/a" });
    expect(new VaultRegistry(home).list().map(v => v.name)).toEqual(["A"]);
  });

  it("rejects duplicate names", () => {
    const r = new VaultRegistry(home);
    r.add({ name: "A", path: "/a" });
    expect(() => r.add({ name: "A", path: "/b" })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/vaultRegistry.test.ts`

- [ ] **Step 3: Implement (hand-rolled YAML, no new dependency)**

`src/serve/vaultRegistry.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServerError, ErrorCode } from "./errors";

export type VaultEntry = { name: string; path: string };

function parse(text: string): VaultEntry[] {
  const out: VaultEntry[] = [];
  let cur: Partial<VaultEntry> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("- name:")) {
      if (cur.name && cur.path) out.push(cur as VaultEntry);
      cur = { name: line.slice(7).trim().replace(/^["']|["']$/g, "") };
    } else if (line.trim().startsWith("path:")) {
      cur.path = line.split("path:")[1]!.trim().replace(/^["']|["']$/g, "");
    }
  }
  if (cur.name && cur.path) out.push(cur as VaultEntry);
  return out;
}

function serialize(entries: VaultEntry[]): string {
  return entries.map(e => `- name: "${e.name}"\n  path: "${e.path}"`).join("\n") + "\n";
}

export class VaultRegistry {
  private path: string;
  private cache: VaultEntry[];

  constructor(home: string) {
    const dir = join(home, ".openclaude");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "vaults.yml");
    this.cache = existsSync(this.path) ? parse(readFileSync(this.path, "utf8")) : [];
  }

  list(): VaultEntry[] { return [...this.cache]; }

  add(entry: VaultEntry): void {
    if (this.cache.some(v => v.name === entry.name)) {
      throw new ServerError(ErrorCode.CONFLICT, `vault named ${entry.name} already exists`);
    }
    this.cache.push(entry);
    this.flush();
  }

  remove(name: string): void {
    this.cache = this.cache.filter(v => v.name !== name);
    this.flush();
  }

  private flush(): void {
    writeFileSync(this.path, serialize(this.cache), "utf8");
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/vaultRegistry.test.ts`

- [ ] **Step 5: Commit**

```
git add src/serve/vaultRegistry.ts src/serve/vaultRegistry.test.ts
git commit -m "feat(serve): add vault registry persistence (~/.openclaude/vaults.yml)"
```

---

### Task 9: Session manager (in-memory + JSONL persist)

**Files:**
- Create: `src/serve/session.ts` and `session.test.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/session.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "./session";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-sm-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("SessionManager", () => {
  it("create returns new session with id", () => {
    const s = new SessionManager(home).create();
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.messages).toEqual([]);
  });

  it("append persists to JSONL", () => {
    const m = new SessionManager(home);
    const s = m.create();
    m.append(s.id, { role: "user", content: "hi", ts: 1 });
    const path = join(home, ".openclaude", "sessions", `${s.id}.jsonl`);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8").trim())).toEqual({ role: "user", content: "hi", ts: 1 });
  });

  it("reload reads persisted messages", () => {
    const m1 = new SessionManager(home);
    const s = m1.create();
    m1.append(s.id, { role: "user", content: "hi", ts: 1 });
    m1.append(s.id, { role: "assistant", content: "hello", ts: 2 });
    const m2 = new SessionManager(home);
    const loaded = m2.get(s.id);
    expect(loaded?.messages.length).toBe(2);
    expect(loaded?.messages[0]?.content).toBe("hi");
  });

  it("list returns all sessions", () => {
    const m = new SessionManager(home);
    m.create(); m.create(); m.create();
    expect(m.list().length).toBe(3);
  });

  it("delete removes file and cache entry", () => {
    const m = new SessionManager(home);
    const s = m.create();
    m.append(s.id, { role: "user", content: "x", ts: 0 });
    m.delete(s.id);
    expect(m.get(s.id)).toBeUndefined();
    expect(existsSync(join(home, ".openclaude", "sessions", `${s.id}.jsonl`))).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/session.test.ts`

- [ ] **Step 3: Implement**

`src/serve/session.ts`:

```typescript
import { randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync,
  appendFileSync, readdirSync, statSync,
} from "node:fs";
import { join } from "node:path";

export type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: number;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
};

export type Session = {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export class SessionManager {
  private dir: string;
  private cache = new Map<string, Session>();

  constructor(home: string) {
    this.dir = join(home, ".openclaude", "sessions");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const id = f.slice(0, -6);
      const raw = readFileSync(join(this.dir, f), "utf8");
      const messages = raw.split("\n").filter(Boolean).map(l => JSON.parse(l) as Message);
      const st = statSync(join(this.dir, f));
      this.cache.set(id, {
        id,
        createdAt: st.birthtimeMs || st.ctimeMs,
        updatedAt: st.mtimeMs,
        messages,
      });
    }
  }

  create(): Session {
    const id = randomUUID();
    const now = Date.now();
    const s: Session = { id, createdAt: now, updatedAt: now, messages: [] };
    this.cache.set(id, s);
    writeFileSync(join(this.dir, `${id}.jsonl`), "", "utf8");
    return s;
  }

  get(id: string): Session | undefined { return this.cache.get(id); }

  append(id: string, msg: Message): void {
    const s = this.cache.get(id);
    if (!s) throw new Error(`session not found: ${id}`);
    s.messages.push(msg);
    s.updatedAt = Date.now();
    appendFileSync(join(this.dir, `${id}.jsonl`), JSON.stringify(msg) + "\n", "utf8");
  }

  list(): Array<{ id: string; createdAt: number; updatedAt: number; messageCount: number }> {
    return Array.from(this.cache.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(s => ({ id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length }));
  }

  delete(id: string): void {
    this.cache.delete(id);
    const p = join(this.dir, `${id}.jsonl`);
    if (existsSync(p)) unlinkSync(p);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/session.test.ts`

- [ ] **Step 5: Commit**

```
git add src/serve/session.ts src/serve/session.test.ts
git commit -m "feat(serve): add SessionManager with JSONL persistence"
```

---

### Task 10: `/sessions` endpoints

**Files:**
- Create: `src/serve/handlers/sessions.ts` and `sessions.test.ts`
- Modify: `src/serve/index.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/handlers/sessions.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-sess-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("/sessions", () => {
  it("list starts empty", async () => {
    const r = await fetch(`${server.url}/sessions`, { headers: auth() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it("roundtrip: create, fetch, delete", async () => {
    const c = await fetch(`${server.url}/sessions`, { method: "POST", headers: auth() });
    expect(c.status).toBe(201);
    const { id } = await c.json();

    const g = await fetch(`${server.url}/sessions/${id}`, { headers: auth() });
    expect(g.status).toBe(200);
    const s = await g.json();
    expect(s.id).toBe(id);
    expect(s.messages).toEqual([]);

    const d = await fetch(`${server.url}/sessions/${id}`, { method: "DELETE", headers: auth() });
    expect(d.status).toBe(204);

    const g2 = await fetch(`${server.url}/sessions/${id}`, { headers: auth() });
    expect(g2.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/sessions.test.ts`

- [ ] **Step 3: Implement handlers**

`src/serve/handlers/sessions.ts`:

```typescript
import type { Route } from "../http";
import type { SessionManager } from "../session";
import { ServerError, ErrorCode } from "../errors";

export function sessionsRoutes(sm: SessionManager): Route[] {
  return [
    { method: "GET", path: "/sessions", handler: async () => ({ status: 200, body: sm.list() }) },
    {
      method: "POST", path: "/sessions",
      handler: async () => {
        const s = sm.create();
        return { status: 201, body: { id: s.id, createdAt: s.createdAt } };
      },
    },
    {
      method: "GET", path: "/sessions/:id",
      handler: async ({ params }) => {
        const s = sm.get(params.id!);
        if (!s) throw new ServerError(ErrorCode.NOT_FOUND, "session not found");
        return { status: 200, body: s };
      },
    },
    {
      method: "DELETE", path: "/sessions/:id",
      handler: async ({ params }) => {
        const s = sm.get(params.id!);
        if (!s) throw new ServerError(ErrorCode.NOT_FOUND, "session not found");
        sm.delete(params.id!);
        return { status: 204 };
      },
    },
  ];
}
```

- [ ] **Step 4: Wire in `src/serve/index.ts`**

```typescript
import { SessionManager } from "./session";
import { sessionsRoutes } from "./handlers/sessions";
import { homedir } from "node:os";

const sm = new SessionManager(homedir());
const routes = [
  healthRoute,
  ...sessionsRoutes(sm),
];
```

- [ ] **Step 5: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 6: Commit**

```
git add src/serve/handlers/sessions.ts src/serve/handlers/sessions.test.ts src/serve/index.ts
git commit -m "feat(serve): add /sessions CRUD endpoints"
```

---

### Task 11: SSE helper + `/chat` with mock agent

**Files:**
- Create: `src/serve/sse.ts` and `sse.test.ts`
- Create: `src/serve/handlers/chat.ts` and `chat.test.ts`
- Modify: `src/serve/index.ts`

- [ ] **Step 1: Write failing SSE tests**

`src/serve/sse.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { formatSseEvent } from "./sse";

describe("formatSseEvent", () => {
  it("formats event name + JSON data", () => {
    expect(formatSseEvent("token", { text: "hi" })).toBe('event: token\ndata: {"text":"hi"}\n\n');
  });
  it("JSON escapes newlines so each event is single data line", () => {
    expect(formatSseEvent("token", { text: "a\nb" })).toBe('event: token\ndata: {"text":"a\\nb"}\n\n');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/sse.test.ts`

- [ ] **Step 3: Implement SSE helper**

`src/serve/sse.ts`:

```typescript
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
```

- [ ] **Step 4: Write failing `/chat` test with deterministic mock agent**

`src/serve/handlers/chat.test.ts`:

```typescript
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
```

- [ ] **Step 5: Run — expect FAIL**

Run: `bun test src/serve/handlers/chat.test.ts`

- [ ] **Step 6: Implement `/chat` handler**

`src/serve/handlers/chat.ts`:

```typescript
import type { Route } from "../http";
import { SseWriter } from "../sse";
import type { SessionManager } from "../session";
import { ServerError, ErrorCode } from "../errors";

export type AgentEvent =
  | { event: "token"; data: { text: string } }
  | { event: "tool_call"; data: { id: string; name: string; args: unknown } }
  | { event: "tool_result"; data: { id: string; ok: boolean; preview?: string } }
  | { event: "pending_edit"; data: { id: string; file: string; reason: string } }
  | { event: "insight"; data: { text: string } }
  | { event: "done"; data: { sessionId?: string; finishReason: string } }
  | { event: "error"; data: { code: string; message: string } };

export type AgentFn = (input: {
  message: string;
  sessionId: string;
  context?: { activeNote?: string; vault?: string; selection?: string };
}) => AsyncIterable<AgentEvent>;

let activeAgent: AgentFn | null = null;
export function setMockAgent(fn: AgentFn): void { activeAgent = fn; }
export function setRealAgent(fn: AgentFn): void { activeAgent = fn; }
export function getActiveAgent(): AgentFn | null { return activeAgent; }

export function chatRoute(sm: SessionManager): Route {
  return {
    method: "POST",
    path: "/chat",
    handler: async ({ body, res }) => {
      if (!activeAgent) throw new ServerError(ErrorCode.INTERNAL, "no agent configured");
      const input = body as { sessionId?: string; message: string; context?: any };
      if (!input || typeof input.message !== "string") {
        throw new ServerError(ErrorCode.VALIDATION, "body.message required");
      }
      const session = input.sessionId ? (sm.get(input.sessionId) ?? sm.create()) : sm.create();
      sm.append(session.id, { role: "user", content: input.message, ts: Date.now() });

      const sse = new SseWriter(res);
      try {
        for await (const evt of activeAgent({ message: input.message, sessionId: session.id, context: input.context })) {
          if (evt.event === "done") {
            sse.send(evt.event, { ...(evt.data as object), sessionId: session.id });
          } else {
            sse.send(evt.event, evt.data);
          }
        }
      } catch (err) {
        sse.send("error", { code: "INTERNAL", message: String(err) });
      } finally {
        sse.end();
      }
    },
  };
}
```

- [ ] **Step 7: Wire in `src/serve/index.ts` with a default mock agent**

```typescript
import { chatRoute, setMockAgent } from "./handlers/chat";

// Default mock — replaced in Task 12 with real agent
setMockAgent(async function* (input) {
  yield { event: "token", data: { text: `echo: ${input.message}` } };
  yield { event: "done", data: { finishReason: "stop" } };
});

const routes = [
  healthRoute,
  ...sessionsRoutes(sm),
  chatRoute(sm),
];
```

- [ ] **Step 8: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 9: Commit**

```
git add src/serve/sse.ts src/serve/sse.test.ts src/serve/handlers/chat.ts src/serve/handlers/chat.test.ts src/serve/index.ts
git commit -m "feat(serve): add SSE helper and /chat endpoint with pluggable agent"
```

---

### Task 12: Integrate real OpenClaude Query engine

**Files:**
- Create: `src/serve/agentAdapter.ts` and `agentAdapter.test.ts`
- Modify: `src/serve/index.ts`

**Context:** This task wires the existing OpenClaude Query engine into the `AgentFn` contract from Task 11. Start by locating the real streaming call.

- [ ] **Step 1: Locate the streaming query function**

Run: `grep -rn "export.*function.*query\|export async function" src/query* src/assistant/ | head -20`

Identify the actual streaming pattern: does it return `AsyncIterable<Event>` or use callbacks? Note the module path.

- [ ] **Step 2: Write failing smoke test**

`src/serve/agentAdapter.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { createRealAgent } from "./agentAdapter";

describe("createRealAgent (smoke)", () => {
  it("returns an AgentFn that yields at least one event (error acceptable without provider)", async () => {
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1"; // forces provider fail
    const agent = createRealAgent({ strictMode: false });
    const events: string[] = [];
    try {
      for await (const evt of agent({ message: "ping", sessionId: "test", context: {} })) {
        events.push(evt.event);
        if (events.length > 5) break;
      }
    } catch { /* adapter should not throw — it yields error events */ }
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `bun test src/serve/agentAdapter.test.ts`

- [ ] **Step 4: Implement adapter (scaffold + engineer fills pseudocode)**

`src/serve/agentAdapter.ts`:

```typescript
import type { AgentFn, AgentEvent } from "./handlers/chat";

export type RealAgentOpts = { strictMode?: boolean };

export function createRealAgent(_opts: RealAgentOpts = {}): AgentFn {
  return async function* (input): AsyncIterable<AgentEvent> {
    try {
      // STEP: replace pseudocode with real imports from the module identified in Step 1.
      //
      // Example shape (pseudocode — will not compile until replaced):
      //
      // import { query as ocQuery } from "../query";
      // for await (const ev of ocQuery({
      //   messages: [{ role: "user", content: input.message }],
      //   context: input.context,
      // })) {
      //   if (ev.kind === "text")        yield { event: "token", data: { text: ev.text } };
      //   else if (ev.kind === "tool_call")   yield { event: "tool_call", data: { id: ev.id, name: ev.name, args: ev.args } };
      //   else if (ev.kind === "tool_result") yield { event: "tool_result", data: { id: ev.id, ok: !ev.error, preview: ev.preview } };
      //   else if (ev.kind === "done")        yield { event: "done", data: { finishReason: ev.reason } };
      // }
      throw new Error("adapter pseudocode — replace with real ocQuery import");
    } catch (err) {
      yield { event: "error", data: { code: "INTERNAL", message: String(err) } };
    }
  };
}
```

**Implementation guidance for the engineer executing this step:**
1. Open the module path from Step 1.
2. Read the streaming function signature and event shape.
3. Replace the pseudocode inside the try block with real imports and event translation.
4. Keep the yield-error-on-failure pattern so broken providers don't crash the server.
5. Update the test in `agentAdapter.test.ts` if needed to assert specific event types once the real loop is wired.

- [ ] **Step 5: Run — expect PASS (test accepts error path)**

Run: `bun test src/serve/agentAdapter.test.ts`

- [ ] **Step 6: Swap into server**

In `src/serve/index.ts`:

```typescript
import { createRealAgent } from "./agentAdapter";
import { setRealAgent } from "./handlers/chat";

setRealAgent(createRealAgent({ strictMode: false }));
```

Keep `setMockAgent` exported — integration tests still use it.

- [ ] **Step 7: Manual smoke**

In one terminal, build: `bun run build`
In a second terminal, run: `node dist/cli.mjs serve --port 7777`
In a third terminal, get the token: `cat ~/.openclaude/server-token`
Then: `curl -N -H "Authorization: Bearer TOKEN_HERE" -H "Content-Type: application/json" -d '{"message":"oi"}' http://127.0.0.1:7777/chat`

Expected: stream of SSE events ending with `event: done`. Stop the server with Ctrl+C.

- [ ] **Step 8: Commit**

```
git add src/serve/agentAdapter.ts src/serve/agentAdapter.test.ts src/serve/index.ts
git commit -m "feat(serve): wire real OpenClaude Query engine into /chat via adapter"
```

---

### Task 13: Pending edits store + `/pending-edits`

**Files:**
- Create: `src/serve/pendingEditStore.ts` and `pendingEditStore.test.ts`
- Create: `src/serve/handlers/pendingEdits.ts` and `pendingEdits.test.ts`
- Modify: `src/serve/index.ts`

- [ ] **Step 1: Write failing store tests**

`src/serve/pendingEditStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingEditStore } from "./pendingEditStore";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-pe-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("PendingEditStore", () => {
  it("create/get/list/delete", () => {
    const s = new PendingEditStore(home);
    const e = s.create({ file: "/v/a.md", vault: "/v", sessionId: "x", reason: "r", before: "a", after: "ab" });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.get(e.id)?.file).toBe("/v/a.md");
    expect(s.list().length).toBe(1);
    s.delete(e.id);
    expect(s.get(e.id)).toBeUndefined();
  });

  it("persists across instances", () => {
    const s1 = new PendingEditStore(home);
    const e = s1.create({ file: "/a", vault: "/v", sessionId: "x", reason: "r", before: "a", after: "b" });
    const s2 = new PendingEditStore(home);
    expect(s2.get(e.id)?.file).toBe("/a");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/pendingEditStore.test.ts`

- [ ] **Step 3: Implement store**

`src/serve/pendingEditStore.ts`:

```typescript
import { randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type PendingEditInput = {
  file: string;
  vault: string;
  sessionId: string;
  reason: string;
  before: string;
  after: string;
};

export type PendingEdit = PendingEditInput & { id: string; createdAt: number };

export class PendingEditStore {
  private dir: string;
  private cache = new Map<string, PendingEdit>();

  constructor(home: string) {
    this.dir = join(home, ".openclaude", "pending-edits");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const e = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as PendingEdit;
      this.cache.set(e.id, e);
    }
  }

  create(input: PendingEditInput): PendingEdit {
    const e: PendingEdit = { ...input, id: randomUUID(), createdAt: Date.now() };
    this.cache.set(e.id, e);
    writeFileSync(join(this.dir, `${e.id}.json`), JSON.stringify(e), "utf8");
    return e;
  }

  get(id: string): PendingEdit | undefined { return this.cache.get(id); }

  list(): PendingEdit[] {
    return Array.from(this.cache.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  delete(id: string): void {
    this.cache.delete(id);
    const p = join(this.dir, `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/pendingEditStore.test.ts`

- [ ] **Step 5: Write failing handler tests**

`src/serve/handlers/pendingEdits.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingEditStore } from "../pendingEditStore";

let server: ServerHandle;
let home: string;
let vault: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-pe-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("/pending-edits", () => {
  it("apply writes file on disk and removes entry", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "note.md");
    writeFileSync(file, "old\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "old\n", after: "new\n" });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("new\n");

    const list = await (await fetch(`${server.url}/pending-edits`, { headers: auth() })).json();
    expect(list.find((x: any) => x.id === e.id)).toBeUndefined();
  });

  it("reject deletes entry without writing", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "x.md");
    writeFileSync(file, "old\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "old\n", after: "new\n" });

    const r = await fetch(`${server.url}/pending-edits/${e.id}/reject`, { method: "POST", headers: auth() });
    expect(r.status).toBe(204);
    expect(readFileSync(file, "utf8")).toBe("old\n");
  });

  it("apply rejects with 409 if file changed since edit was queued", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "c.md");
    writeFileSync(file, "v1\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "v1\n", after: "v3\n" });
    writeFileSync(file, "v2\n", "utf8");

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(409);
  });
});
```

- [ ] **Step 6: Run — expect FAIL**

Run: `bun test src/serve/handlers/pendingEdits.test.ts`

- [ ] **Step 7: Implement handlers**

`src/serve/handlers/pendingEdits.ts`:

```typescript
import type { Route } from "../http";
import type { PendingEditStore } from "../pendingEditStore";
import { ServerError, ErrorCode } from "../errors";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { checkFilesystemTripwire } from "../tripwires";

export type PendingEditOpts = {
  createBackup?: (vault: string, file: string) => void;
};

export function pendingEditsRoutes(store: PendingEditStore, opts: PendingEditOpts = {}): Route[] {
  const createBackup = opts.createBackup ?? (() => {});
  return [
    { method: "GET", path: "/pending-edits", handler: async () => ({ status: 200, body: store.list() }) },
    {
      method: "POST", path: "/pending-edits/:id/apply",
      handler: async ({ params }) => {
        const e = store.get(params.id!);
        if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "pending edit not found");
        checkFilesystemTripwire("write", e.file);
        if (existsSync(e.file)) {
          const current = readFileSync(e.file, "utf8");
          if (current !== e.before) {
            throw new ServerError(ErrorCode.CONFLICT, "file changed since pending edit was created");
          }
        }
        createBackup(e.vault, e.file);
        writeFileSync(e.file, e.after, "utf8");
        store.delete(e.id);
        return { status: 200, body: { id: e.id, applied: true } };
      },
    },
    {
      method: "POST", path: "/pending-edits/:id/reject",
      handler: async ({ params }) => {
        const e = store.get(params.id!);
        if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "pending edit not found");
        store.delete(e.id);
        return { status: 204 };
      },
    },
  ];
}
```

- [ ] **Step 8: Wire in `src/serve/index.ts`**

```typescript
import { PendingEditStore } from "./pendingEditStore";
import { pendingEditsRoutes } from "./handlers/pendingEdits";

const pe = new PendingEditStore(homedir());
const routes = [
  healthRoute,
  ...sessionsRoutes(sm),
  chatRoute(sm),
  ...pendingEditsRoutes(pe),
];
```

- [ ] **Step 9: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 10: Commit**

```
git add src/serve/pendingEditStore.ts src/serve/pendingEditStore.test.ts src/serve/handlers/pendingEdits.ts src/serve/handlers/pendingEdits.test.ts src/serve/index.ts
git commit -m "feat(serve): add pending edits store + /pending-edits endpoints"
```

---

### Task 14: Shadow backup + `/backups`

**Files:**
- Create: `src/serve/backup.ts` and `backup.test.ts`
- Create: `src/serve/handlers/backups.ts` and `backups.test.ts`
- Modify: `src/serve/index.ts` (wire backup into apply path)

- [ ] **Step 1: Write failing backup tests**

`src/serve/backup.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "./backup";

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "oc-bk-")); });
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe("BackupManager", () => {
  it("creates backup file + index entry", () => {
    const file = join(vault, "note.md");
    writeFileSync(file, "original", "utf8");
    const bm = new BackupManager(vault);
    const entry = bm.snapshot(file, { reason: "test" });
    expect(existsSync(entry.backupPath)).toBe(true);
    expect(readFileSync(entry.backupPath, "utf8")).toBe("original");
    expect(bm.list()).toHaveLength(1);
    expect(bm.list()[0]?.originalPath).toBe(file);
  });

  it("restore writes backup content back", () => {
    const file = join(vault, "a.md");
    writeFileSync(file, "v1", "utf8");
    const bm = new BackupManager(vault);
    const entry = bm.snapshot(file, { reason: "edit" });
    writeFileSync(file, "v2", "utf8");
    bm.restore(entry.id);
    expect(readFileSync(file, "utf8")).toBe("v1");
  });

  it("pruneOlderThan removes expired entries", () => {
    const file = join(vault, "b.md");
    writeFileSync(file, "x", "utf8");
    const bm = new BackupManager(vault);
    const e = bm.snapshot(file, { reason: "r" });
    bm.forceTimestamp(e.id, Date.now() - 40 * 86_400_000);
    const pruned = bm.pruneOlderThan(30);
    expect(pruned).toBe(1);
    expect(bm.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/backup.test.ts`

- [ ] **Step 3: Implement BackupManager**

`src/serve/backup.ts`:

```typescript
import { randomUUID, createHash } from "node:crypto";
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

export type BackupEntry = {
  id: string;
  originalPath: string;
  backupPath: string;
  reason: string;
  sessionId?: string;
  createdAt: number;
};

type IndexFile = { version: 1; entries: BackupEntry[] };

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
}

export class BackupManager {
  private dir: string;
  private indexPath: string;
  private index: IndexFile;

  constructor(vaultRoot: string) {
    this.dir = join(vaultRoot, ".openclaude-backups");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.indexPath = join(this.dir, "index.json");
    this.index = existsSync(this.indexPath)
      ? JSON.parse(readFileSync(this.indexPath, "utf8"))
      : { version: 1, entries: [] };
  }

  snapshot(originalPath: string, opts: { reason: string; sessionId?: string }): BackupEntry {
    if (!existsSync(originalPath)) {
      const id = randomUUID();
      const entry: BackupEntry = {
        id, originalPath, backupPath: "", reason: opts.reason,
        sessionId: opts.sessionId, createdAt: Date.now(),
      };
      this.index.entries.push(entry);
      this.flush();
      return entry;
    }
    const id = randomUUID();
    const content = readFileSync(originalPath, "utf8");
    const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
    const fname = `${ts}-${hash}-${slug(basename(originalPath))}`;
    const backupPath = join(this.dir, fname);
    copyFileSync(originalPath, backupPath);
    const entry: BackupEntry = {
      id, originalPath, backupPath,
      reason: opts.reason, sessionId: opts.sessionId,
      createdAt: Date.now(),
    };
    this.index.entries.push(entry);
    this.flush();
    return entry;
  }

  list(): BackupEntry[] {
    return [...this.index.entries].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): BackupEntry | undefined {
    return this.index.entries.find(e => e.id === id);
  }

  restore(id: string): void {
    const e = this.get(id);
    if (!e) throw new Error("backup not found");
    if (!e.backupPath) {
      if (existsSync(e.originalPath)) unlinkSync(e.originalPath);
    } else {
      copyFileSync(e.backupPath, e.originalPath);
    }
    this.index.entries = this.index.entries.filter(x => x.id !== id);
    this.flush();
  }

  pruneOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    const toPrune = this.index.entries.filter(e => e.createdAt < cutoff);
    for (const e of toPrune) {
      if (e.backupPath && existsSync(e.backupPath)) unlinkSync(e.backupPath);
    }
    this.index.entries = this.index.entries.filter(e => e.createdAt >= cutoff);
    this.flush();
    return toPrune.length;
  }

  forceTimestamp(id: string, ts: number): void {
    const e = this.get(id);
    if (e) { e.createdAt = ts; this.flush(); }
  }

  private flush(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), "utf8");
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/backup.test.ts`

- [ ] **Step 5: Write failing `/backups` handler tests**

`src/serve/handlers/backups.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "../backup";

let server: ServerHandle; let home: string; let vault: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-srv-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("/backups", () => {
  it("list + restore roundtrip", async () => {
    const file = join(vault, "x.md");
    writeFileSync(file, "v1", "utf8");
    const bm = new BackupManager(vault);
    const e = bm.snapshot(file, { reason: "test" });
    writeFileSync(file, "v2", "utf8");

    const l = await fetch(`${server.url}/backups?vault=${encodeURIComponent(vault)}`, { headers: auth() });
    expect(l.status).toBe(200);
    const arr = await l.json();
    expect(arr.find((x: any) => x.id === e.id)).toBeTruthy();

    const r = await fetch(
      `${server.url}/backups/${e.id}/restore?vault=${encodeURIComponent(vault)}`,
      { method: "POST", headers: auth() }
    );
    expect(r.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("v1");
  });
});
```

- [ ] **Step 6: Implement handlers**

`src/serve/handlers/backups.ts`:

```typescript
import type { Route } from "../http";
import { BackupManager } from "../backup";
import { ServerError, ErrorCode } from "../errors";

function getBm(query: Record<string, string>): BackupManager {
  const vault = query.vault;
  if (!vault) throw new ServerError(ErrorCode.VALIDATION, "vault query param required");
  return new BackupManager(vault);
}

export const backupsRoutes: Route[] = [
  { method: "GET", path: "/backups", handler: async ({ query }) => ({ status: 200, body: getBm(query).list() }) },
  {
    method: "GET", path: "/backups/:id",
    handler: async ({ params, query }) => {
      const bm = getBm(query);
      const e = bm.get(params.id!);
      if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "backup not found");
      return { status: 200, body: e };
    },
  },
  {
    method: "POST", path: "/backups/:id/restore",
    handler: async ({ params, query }) => {
      const bm = getBm(query);
      bm.restore(params.id!);
      return { status: 200, body: { restored: params.id } };
    },
  },
];
```

- [ ] **Step 7: Wire backup into pending-edit apply**

Update `src/serve/index.ts`:

```typescript
import { BackupManager } from "./backup";
import { backupsRoutes } from "./handlers/backups";

const routes = [
  healthRoute,
  ...sessionsRoutes(sm),
  chatRoute(sm),
  ...pendingEditsRoutes(pe, {
    createBackup: (vault, file) => new BackupManager(vault).snapshot(file, { reason: "apply pending edit" }),
  }),
  ...backupsRoutes,
];
```

- [ ] **Step 8: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 9: Commit**

```
git add src/serve/backup.ts src/serve/backup.test.ts src/serve/handlers/backups.ts src/serve/handlers/backups.test.ts src/serve/index.ts
git commit -m "feat(serve): add shadow backup + /backups endpoints; wire backup into pending-edit apply"
```

---

### Task 15: `/config`, `/models`, `/vaults` endpoints

**Files:**
- Create: `src/serve/handlers/config.ts`, `models.ts`, `vaults.ts` with tests
- Modify: `src/serve/index.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/handlers/vaults.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

describe("/vaults", () => {
  it("register + list + remove", async () => {
    const r = await fetch(`${server.url}/vaults`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "V1", path: "/some/path" }),
    });
    expect(r.status).toBe(201);
    const list = await (await fetch(`${server.url}/vaults`, { headers: auth() })).json();
    expect(list.map((v: any) => v.name)).toContain("V1");
    const d = await fetch(`${server.url}/vaults/V1`, { method: "DELETE", headers: auth() });
    expect(d.status).toBe(204);
  });
});
```

`src/serve/handlers/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-c-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

describe("/config", () => {
  it("GET returns defaults", async () => {
    const r = await fetch(`${server.url}/config`, { headers: auth() });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.permissions.preset).toBe("balanceado");
    expect(j.backup.retentionDays).toBe(30);
  });

  it("POST merges updates", async () => {
    const r = await fetch(`${server.url}/config`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ permissions: { preset: "agressivo" } }),
    });
    expect(r.status).toBe(200);
    const j = await (await fetch(`${server.url}/config`, { headers: auth() })).json();
    expect(j.permissions.preset).toBe("agressivo");
  });
});
```

`src/serve/handlers/models.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-m-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

describe("/models", () => {
  it("GET returns list + current", async () => {
    const r = await fetch(`${server.url}/models`, { headers: auth() });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.available)).toBe(true);
  });

  it("POST /models/current writes override", async () => {
    const r = await fetch(`${server.url}/models/current`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ modelId: "test-model" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.modelId).toBe("test-model");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/vaults.test.ts src/serve/handlers/config.test.ts src/serve/handlers/models.test.ts`

- [ ] **Step 3: Implement vaults handler**

`src/serve/handlers/vaults.ts`:

```typescript
import type { Route } from "../http";
import { VaultRegistry } from "../vaultRegistry";
import { ServerError, ErrorCode } from "../errors";
import { homedir } from "node:os";

export function vaultsRoutes(): Route[] {
  const reg = () => new VaultRegistry(homedir());
  return [
    { method: "GET", path: "/vaults", handler: async () => ({ status: 200, body: reg().list() }) },
    {
      method: "POST", path: "/vaults",
      handler: async ({ body }) => {
        const b = body as { name?: string; path?: string };
        if (!b?.name || !b?.path) throw new ServerError(ErrorCode.VALIDATION, "name and path required");
        reg().add({ name: b.name, path: b.path });
        return { status: 201, body: { name: b.name, path: b.path } };
      },
    },
    {
      method: "DELETE", path: "/vaults/:name",
      handler: async ({ params }) => {
        reg().remove(params.name!);
        return { status: 204 };
      },
    },
  ];
}
```

- [ ] **Step 4: Implement config handler**

`src/serve/handlers/config.ts`:

```typescript
import type { Route } from "../http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

type ServerConfig = {
  permissions: { preset: "conservador" | "balanceado" | "agressivo" };
  backup: { retentionDays: number };
  rateLimit: { windowMs: number; max: number };
};

const DEFAULTS: ServerConfig = {
  permissions: { preset: "balanceado" },
  backup: { retentionDays: 30 },
  rateLimit: { windowMs: 60_000, max: 100 },
};

function configPath(): string {
  return join(homedir(), ".openclaude", "server-config.json");
}
function readConfig(): ServerConfig {
  const p = configPath();
  if (!existsSync(p)) return DEFAULTS;
  return { ...DEFAULTS, ...JSON.parse(readFileSync(p, "utf8")) };
}
function writeConfig(c: ServerConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2), "utf8");
}

export const configRoutes: Route[] = [
  { method: "GET", path: "/config", handler: async () => ({ status: 200, body: readConfig() }) },
  {
    method: "POST", path: "/config",
    handler: async ({ body }) => {
      const current = readConfig();
      const next = { ...current, ...(body as Partial<ServerConfig>) };
      writeConfig(next);
      return { status: 200, body: next };
    },
  },
];
```

- [ ] **Step 5: Implement models handler**

`src/serve/handlers/models.ts`:

```typescript
import type { Route } from "../http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { ServerError, ErrorCode } from "../errors";

type ModelInfo = { id: string; provider: string };

function readSettings(): any {
  const p = join(homedir(), ".claude", "settings.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function listModels(): ModelInfo[] {
  const s = readSettings();
  const agentModels = s.agentModels ?? {};
  return Object.keys(agentModels).map(id => {
    const url = agentModels[id]?.base_url ?? "";
    const provider = url.includes("openai") ? "openai" : url.includes("ollama") || url.includes("11434") ? "ollama" : "other";
    return { id, provider };
  });
}

function currentModel(): string | undefined {
  const override = join(homedir(), ".openclaude", "model-override.json");
  if (existsSync(override)) {
    try { return (JSON.parse(readFileSync(override, "utf8")) as { modelId?: string }).modelId; } catch { /* ignore */ }
  }
  return readSettings()?.agentRouting?.default;
}

export const modelsRoutes: Route[] = [
  {
    method: "GET", path: "/models",
    handler: async () => ({ status: 200, body: { available: listModels(), current: currentModel() } }),
  },
  {
    method: "POST", path: "/models/current",
    handler: async ({ body }) => {
      const modelId = (body as { modelId?: string })?.modelId;
      if (!modelId) throw new ServerError(ErrorCode.VALIDATION, "modelId required");
      const p = join(homedir(), ".openclaude", "model-override.json");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify({ modelId }), "utf8");
      return { status: 200, body: { modelId } };
    },
  },
];
```

- [ ] **Step 6: Wire in `src/serve/index.ts`**

```typescript
import { configRoutes } from "./handlers/config";
import { modelsRoutes } from "./handlers/models";
import { vaultsRoutes } from "./handlers/vaults";

const routes = [
  healthRoute,
  ...configRoutes,
  ...modelsRoutes,
  ...vaultsRoutes(),
  ...sessionsRoutes(sm),
  chatRoute(sm),
  ...pendingEditsRoutes(pe, {
    createBackup: (vault, file) => new BackupManager(vault).snapshot(file, { reason: "apply pending edit" }),
  }),
  ...backupsRoutes,
];
```

- [ ] **Step 7: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 8: Commit**

```
git add src/serve/handlers/config.ts src/serve/handlers/config.test.ts src/serve/handlers/models.ts src/serve/handlers/models.test.ts src/serve/handlers/vaults.ts src/serve/handlers/vaults.test.ts src/serve/index.ts
git commit -m "feat(serve): add /config, /models, /vaults endpoints"
```

---

### Task 16: `/tools/search` cross-vault text search

**Files:**
- Create: `src/serve/handlers/tools.ts`
- Create: `src/serve/handlers/tools.search.test.ts`

- [ ] **Step 1: Write failing test**

`src/serve/handlers/tools.search.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
let v1: string; let v2: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-srv-"));
  v1 = mkdtempSync(join(tmpdir(), "v1-"));
  v2 = mkdtempSync(join(tmpdir(), "v2-"));
  mkdirSync(join(v1, "sub"), { recursive: true });
  writeFileSync(join(v1, "sub", "a.md"), "tarifa branca info", "utf8");
  writeFileSync(join(v2, "b.md"), "nothing relevant", "utf8");
  writeFileSync(join(v2, "c.md"), "tarifa azul and tarifa branca", "utf8");
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(v1, { recursive: true, force: true });
  rmSync(v2, { recursive: true, force: true });
});

describe("POST /tools/search", () => {
  it("returns matches across multiple vaults", async () => {
    const r = await fetch(`${server.url}/tools/search`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "tarifa branca", vaults: [v1, v2] }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results.length).toBeGreaterThanOrEqual(2);
    const paths = j.results.map((x: any) => x.file);
    expect(paths.some((p: string) => p.includes("a.md"))).toBe(true);
    expect(paths.some((p: string) => p.includes("c.md"))).toBe(true);
    expect(paths.every((p: string) => !p.includes("b.md"))).toBe(true);
  });

  it("respects maxResults", async () => {
    const r = await fetch(`${server.url}/tools/search`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "tarifa", vaults: [v1, v2], maxResults: 1 }),
    });
    const j = await r.json();
    expect(j.results.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/tools.search.test.ts`

- [ ] **Step 3: Implement**

`src/serve/handlers/tools.ts`:

```typescript
import type { Route } from "../http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ServerError, ErrorCode } from "../errors";

function walk(root: string, out: string[] = []): string[] {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

type SearchHit = { file: string; vault: string; snippet: string; line: number };

function searchVault(vault: string, query: string, max: number): SearchHit[] {
  const needle = query.toLowerCase();
  const out: SearchHit[] = [];
  for (const f of walk(vault)) {
    const content = readFileSync(f, "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        out.push({ file: f, vault, snippet: lines[i]!.slice(0, 200), line: i + 1 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

export const toolsRoutes: Route[] = [
  {
    method: "POST", path: "/tools/search",
    handler: async ({ body }) => {
      const b = body as { query?: string; vaults?: string[]; maxResults?: number };
      if (!b?.query || !Array.isArray(b.vaults)) {
        throw new ServerError(ErrorCode.VALIDATION, "query and vaults[] required");
      }
      const max = b.maxResults ?? 10;
      const all: SearchHit[] = [];
      for (const v of b.vaults) {
        if (!existsSync(v)) continue;
        all.push(...searchVault(v, b.query, max - all.length));
        if (all.length >= max) break;
      }
      return { status: 200, body: { results: all } };
    },
  },
];
```

- [ ] **Step 4: Wire in `src/serve/index.ts`**

Add `...toolsRoutes,` to the routes array.

- [ ] **Step 5: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 6: Commit**

```
git add src/serve/handlers/tools.ts src/serve/handlers/tools.search.test.ts src/serve/index.ts
git commit -m "feat(serve): add /tools/search cross-vault text search"
```

---

### Task 17: `/tools/dataview` + `/tools/analyze-results`

**Files:**
- Modify: `src/serve/handlers/tools.ts` (add 2 routes)
- Create: `src/serve/handlers/tools.dataview.test.ts`

- [ ] **Step 1: Write failing tests**

`src/serve/handlers/tools.dataview.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { setMockAgent } from "./chat";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-dv-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  setMockAgent(async function* (input) {
    if (input.message.includes("Generate DQL")) {
      yield { event: "token", data: { text: 'TABLE status FROM "03-Projetos" WHERE status = "Ativo"' } };
      yield { event: "done", data: { finishReason: "stop" } };
    } else if (input.message.includes("Analyze")) {
      yield { event: "token", data: { text: "3 ativos. NeuroGrid parado 13 dias." } };
      yield { event: "done", data: { finishReason: "stop" } };
    }
  });
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

describe("POST /tools/dataview", () => {
  it("returns generated DQL for natural language", async () => {
    const r = await fetch(`${server.url}/tools/dataview`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ naturalLanguage: "projetos ativos" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.dql).toContain("TABLE");
    expect(j.dql).toContain("status");
  });
});

describe("POST /tools/analyze-results", () => {
  it("returns non-empty insight text", async () => {
    const r = await fetch(`${server.url}/tools/analyze-results`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({
        dql: "TABLE status FROM projetos",
        results: [{ file: "FinPower", status: "Ativo" }, { file: "NeuroGrid", status: "Ativo" }],
      }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(typeof j.insight).toBe("string");
    expect(j.insight.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/tools.dataview.test.ts`

- [ ] **Step 3: Append routes to `handlers/tools.ts`**

Add at the bottom of the file:

```typescript
import { getActiveAgent, type AgentFn } from "./chat";

async function runAgentToString(agent: AgentFn, message: string): Promise<string> {
  const pieces: string[] = [];
  for await (const ev of agent({ message, sessionId: "internal", context: {} })) {
    if (ev.event === "token") pieces.push((ev.data as { text: string }).text);
  }
  return pieces.join("");
}

toolsRoutes.push(
  {
    method: "POST", path: "/tools/dataview",
    handler: async ({ body }) => {
      const b = body as { naturalLanguage?: string };
      if (!b?.naturalLanguage) throw new ServerError(ErrorCode.VALIDATION, "naturalLanguage required");
      const agent = getActiveAgent();
      if (!agent) throw new ServerError(ErrorCode.INTERNAL, "no agent");
      const prompt = `Generate DQL (Obsidian Dataview) for: "${b.naturalLanguage}". Return ONLY the DQL, no markdown fences.`;
      const dql = (await runAgentToString(agent, prompt)).trim();
      return { status: 200, body: { dql, explanation: `Generated from: ${b.naturalLanguage}` } };
    },
  },
  {
    method: "POST", path: "/tools/analyze-results",
    handler: async ({ body }) => {
      const b = body as { dql?: string; results?: unknown[] };
      if (!b?.dql || !Array.isArray(b.results)) {
        throw new ServerError(ErrorCode.VALIDATION, "dql and results[] required");
      }
      const agent = getActiveAgent();
      if (!agent) throw new ServerError(ErrorCode.INTERNAL, "no agent");
      const prompt = `Analyze these Dataview results in 1-2 sentences. Query: ${b.dql}. Results: ${JSON.stringify(b.results).slice(0, 2000)}`;
      const insight = (await runAgentToString(agent, prompt)).trim();
      return { status: 200, body: { insight } };
    },
  },
);
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 5: Commit**

```
git add src/serve/handlers/tools.ts src/serve/handlers/tools.dataview.test.ts
git commit -m "feat(serve): add /tools/dataview and /tools/analyze-results (LLM-backed)"
```

---

### Task 18: `/tools/mermaid-graph`

**Files:**
- Modify: `src/serve/handlers/tools.ts`
- Create: `src/serve/handlers/tools.mermaid.test.ts`

- [ ] **Step 1: Write failing test**

`src/serve/handlers/tools.mermaid.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string; let vault: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-mg-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  writeFileSync(join(vault, "MOC.md"), "# MOC\n\n- [[FinPower]]\n- [[PowerSQT]]", "utf8");
  writeFileSync(join(vault, "FinPower.md"), "links to [[PowerSQT]]", "utf8");
  writeFileSync(join(vault, "PowerSQT.md"), "leaf", "utf8");
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("POST /tools/mermaid-graph", () => {
  it("returns mermaid source with seed and linked notes", async () => {
    const r = await fetch(`${server.url}/tools/mermaid-graph`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ vault, seedNote: "MOC", depth: 2 }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.mermaid).toMatch(/^graph (LR|TD)/);
    expect(j.mermaid).toContain("MOC");
    expect(j.mermaid).toContain("FinPower");
    expect(j.mermaid).toContain("PowerSQT");
    expect(j.nodeCount).toBeGreaterThanOrEqual(3);
  });

  it("caps at maxNodes", async () => {
    const r = await fetch(`${server.url}/tools/mermaid-graph`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ vault, seedNote: "MOC", depth: 3, maxNodes: 2 }),
    });
    const j = await r.json();
    expect(j.nodeCount).toBeLessThanOrEqual(2);
    expect(j.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/serve/handlers/tools.mermaid.test.ts`

- [ ] **Step 3: Append to `handlers/tools.ts`**

```typescript
function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) out.push(m[1]!.trim());
  return out;
}

function slugId(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "_");
}

toolsRoutes.push({
  method: "POST", path: "/tools/mermaid-graph",
  handler: async ({ body }) => {
    const b = body as { vault?: string; seedNote?: string; depth?: number; maxNodes?: number };
    if (!b?.vault || !b?.seedNote) throw new ServerError(ErrorCode.VALIDATION, "vault and seedNote required");
    const depth = Math.min(Math.max(b.depth ?? 2, 1), 3);
    const maxNodes = b.maxNodes ?? 50;
    const edges = new Set<string>();
    const visited = new Set<string>([b.seedNote]);
    const queue: Array<{ note: string; d: number }> = [{ note: b.seedNote, d: 0 }];
    let truncated = false;

    while (queue.length && visited.size < maxNodes) {
      const { note, d } = queue.shift()!;
      if (d >= depth) continue;
      const path = join(b.vault, `${note}.md`);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      for (const linked of extractWikilinks(content)) {
        if (visited.size >= maxNodes) { truncated = true; break; }
        edges.add(`${slugId(note)} --> ${slugId(linked)}`);
        if (!visited.has(linked)) {
          visited.add(linked);
          queue.push({ note: linked, d: d + 1 });
        }
      }
    }

    const nodeDefs = Array.from(visited).map(n => `${slugId(n)}["${n}"]`).join("\n  ");
    const edgeLines = Array.from(edges).join("\n  ");
    const mermaid = `graph LR\n  ${nodeDefs}\n  ${edgeLines}`.trim();
    return { status: 200, body: { mermaid, nodeCount: visited.size, truncated } };
  },
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/serve/`

- [ ] **Step 5: Commit**

```
git add src/serve/handlers/tools.ts src/serve/handlers/tools.mermaid.test.ts
git commit -m "feat(serve): add /tools/mermaid-graph (wikilink BFS with maxNodes cap)"
```

---

### Task 19: End-to-end security test matrix

**Files:**
- Create: `src/serve/security.test.ts`

- [ ] **Step 1: Write comprehensive suite**

`src/serve/security.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle; let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-sec-"));
  process.env.HOME = home; process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => { await server.stop(); rmSync(home, { recursive: true, force: true }); });

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

  it("/health is public", async () => {
    const r = await fetch(`${server.url}/health`);
    expect(r.status).toBe(200);
  });

  it("wrong token returns 401", async () => {
    const r = await fetch(`${server.url}/config`, { headers: { authorization: `Bearer wrongtoken` } });
    expect(r.status).toBe(401);
  });
});

describe("security: bind address", () => {
  it("binds only to 127.0.0.1", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
});

describe("security: CORS", () => {
  it("allows Obsidian origin", async () => {
    const r = await fetch(`${server.url}/health`, { headers: { origin: "app://obsidian.md" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("app://obsidian.md");
  });
  it("blocks foreign origin", async () => {
    const r = await fetch(`${server.url}/health`, { headers: { origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("security: path confinement in search", () => {
  it("never returns files outside provided vault roots", async () => {
    const v = mkdtempSync(join(tmpdir(), "oc-vlim-"));
    const r = await fetch(`${server.url}/tools/search`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "passwd", vaults: [v] }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results).toEqual([]);
    rmSync(v, { recursive: true, force: true });
  });
});

describe("security: rate limit", () => {
  it("returns 429 after crossing max", async () => {
    const h2 = mkdtempSync(join(tmpdir(), "oc-rl-"));
    process.env.HOME = h2; process.env.USERPROFILE = h2;
    const s2 = await startServer({ port: 0 });
    try {
      const headers = { authorization: `Bearer ${s2.token}` };
      let last: Response | undefined;
      for (let i = 0; i < 101; i++) last = await fetch(`${s2.url}/config`, { headers });
      expect(last?.status).toBe(429);
    } finally {
      await s2.stop();
      rmSync(h2, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run — expect PASS**

Run: `bun test src/serve/security.test.ts`

- [ ] **Step 3: Commit**

```
git add src/serve/security.test.ts
git commit -m "test(serve): add end-to-end security matrix (auth, CORS, path, rate limit)"
```

---

### Task 20: README + manual smoke + milestone tag

**Files:**
- Create: `src/serve/README.md`
- Modify: `package.json` — add `test:serve` script

- [ ] **Step 1: Write README**

`src/serve/README.md`:

```markdown
# openclaude serve

HTTP/SSE server that exposes OpenClaude as an agent backend for the Obsidian plugin (and future clients).

## Usage

```
openclaude serve --port 7777
openclaude serve              # random port, prints JSON with URL
```

On startup the server:
1. Generates a 256-bit token in `~/.openclaude/server-token` (mode 0600 on Unix)
2. Binds to `127.0.0.1` only
3. Prints `{"type":"server-started", ...}` to stdout

## Authentication

All endpoints except `/health` require `Authorization: Bearer <token>` from `~/.openclaude/server-token`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness (public) |
| GET | `/config` | Server config |
| POST | `/config` | Update config |
| GET | `/models` | Available models + current |
| POST | `/models/current` | Change current model |
| GET | `/vaults` | Registered vaults |
| POST | `/vaults` | Register vault `{name, path}` |
| DELETE | `/vaults/:name` | Unregister vault |
| GET | `/sessions` | List chat sessions |
| POST | `/sessions` | Create session |
| GET | `/sessions/:id` | Get session with messages |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/chat` | Stream agent response (SSE) |
| GET | `/pending-edits` | List edits awaiting approval |
| POST | `/pending-edits/:id/apply` | Apply edit (creates backup first) |
| POST | `/pending-edits/:id/reject` | Discard edit |
| GET | `/backups` | List backups (requires `?vault=...`) |
| GET | `/backups/:id` | Get backup entry |
| POST | `/backups/:id/restore` | Restore from backup |
| POST | `/tools/search` | Cross-vault text search |
| POST | `/tools/dataview` | Generate DQL from natural language |
| POST | `/tools/analyze-results` | Insight from Dataview results |
| POST | `/tools/mermaid-graph` | Generate Mermaid graph from seed note |

## Security

- Bind to 127.0.0.1 only
- Bearer token required (constant-time compare)
- CORS limited to `app://obsidian.md`
- Rate limit 100 req/min/IP (configurable)
- Tripwires block destructive shell and writes to protected config paths
- Vault-bound path validation rejects `..` escapes

## Development

- `bun test src/serve/` — full server test suite
- `bun run build` — rebuild dist

## Out of scope for Phase 1

- No permission preset enforcement inside agent yet (wired in Plan #4)
- No streaming token cancellation (Plan #2)
- No audit log writer (Plan #4)
- No Obsidian plugin (Plan #2)
```

- [ ] **Step 2: Add `test:serve` script**

Edit `package.json` — add to `scripts`:

```json
"test:serve": "bun test src/serve/"
```

- [ ] **Step 3: Run full suite**

Run: `bun run test:serve`
Expected: ALL GREEN.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors in `src/serve/`.

- [ ] **Step 5: Manual smoke (happy path)**

Terminal A: `bun run build`
Terminal A: `node dist/cli.mjs serve --port 7777`
Terminal B: `cat ~/.openclaude/server-token` — copy the token
Terminal B, each curl as separate command:

- `curl -s http://127.0.0.1:7777/health`
- `curl -s -H "Authorization: Bearer TOKEN" http://127.0.0.1:7777/config`
- `curl -s -H "Authorization: Bearer TOKEN" http://127.0.0.1:7777/vaults`
- `curl -s -X POST -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"name":"TestVault","path":"/tmp/test-vault"}' http://127.0.0.1:7777/vaults`
- `curl -s -X DELETE -H "Authorization: Bearer TOKEN" http://127.0.0.1:7777/vaults/TestVault`
- `curl -N -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"message":"oi"}' http://127.0.0.1:7777/chat`

Each should return 200/201/204 as appropriate. The last one should stream SSE events and close with `event: done`.

Stop Terminal A with Ctrl+C.

- [ ] **Step 6: Commit + tag**

```
git add src/serve/README.md package.json
git commit -m "docs(serve): add README and test:serve script"
git tag phase-1-server-complete
```

---

## Post-Phase checklist

- [ ] All 20 tasks complete
- [ ] `bun run test:serve` all green
- [ ] `bun run typecheck` clean for `src/serve/`
- [ ] Manual smoke passes (health, auth, config, chat SSE)
- [ ] `src/serve/README.md` documents every endpoint
- [ ] `phase-1-server-complete` tag created
- [ ] No new production dependencies added to `package.json`
- [ ] `~/.openclaude/server-token` has mode 0600 on Unix
- [ ] Server still binds only to 127.0.0.1 (not 0.0.0.0)

## What comes next

- **Plan #2** — Obsidian Plugin Skeleton: sidebar, Ctrl+K hub, chat UI talking to this server
- **Plan #3** — Features: Dataview Level 2 panel, Mermaid rendering, slash commands, installer
- **Plan #4** — Permission preset enforcement, audit log, CLI installer, E2E tests with Playwright
