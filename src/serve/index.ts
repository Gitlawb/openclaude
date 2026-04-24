import { homedir } from "node:os";
import { createHttpApp } from "./http";
import { ensureServerToken } from "./auth";
import { SessionManager } from "./session";
import { healthRoute } from "./handlers/health";
import { sessionsRoutes } from "./handlers/sessions";

export type ServerOpts = {
  port?: number;
  /** Passed through for later tasks (project-scoped config); unused in scaffold. */
  projectDir?: string;
};

export type ServerHandle = {
  url: string;
  port: number;
  token: string;
  stop: () => Promise<void>;
};

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const token = ensureServerToken();
  // SessionManager is constructed per-start (not at module scope) so tests
  // that rotate process.env.HOME in beforeEach get isolated state each run.
  const sm = new SessionManager(homedir());
  const routes = [healthRoute, ...sessionsRoutes(sm)];
  const app = await createHttpApp({
    token,
    routes,
    port: opts.port,
    rateLimit: { windowMs: 60_000, max: 100 },
  });
  return {
    url: `http://127.0.0.1:${app.port}`,
    port: app.port,
    token,
    stop: () => new Promise<void>((r) => app.server.close(() => r())),
  };
}
