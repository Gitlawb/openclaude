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
