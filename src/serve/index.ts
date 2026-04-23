import { createHttpApp } from "./http";
import { ensureServerToken } from "./auth";
import { healthRoute } from "./handlers/health";

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
  const routes = [healthRoute];
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
