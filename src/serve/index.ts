import { homedir } from "node:os";
import { createHttpApp } from "./http";
import { ensureServerToken } from "./auth";
import { SessionManager } from "./session";
import { healthRoute } from "./handlers/health";
import { sessionsRoutes } from "./handlers/sessions";
import { chatRoute, setMockAgent, setRealAgent } from "./handlers/chat";
import { pendingEditsRoutes } from "./handlers/pendingEdits";
import { backupsRoutes } from "./handlers/backups";
import { configRoutes } from "./handlers/config";
import { modelsRoutes } from "./handlers/models";
import { vaultsRoutes } from "./handlers/vaults";
import { toolsRoutes } from "./handlers/tools";
import { PendingEditStore } from "./pendingEditStore";
import { BackupManager } from "./backup";
import { createRealAgent } from "./agentAdapter";

// Wire the real OpenClaude query engine as the default agent.
// Tests override this in beforeEach via setMockAgent; the override wins
// because setMockAgent/setRealAgent assign to a module-level variable.
setRealAgent(createRealAgent());

// Re-export setMockAgent for tests
export { setMockAgent };

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
  // Enable config reading — the serve subcommand dispatches before the CLI's
  // main bootstrap, so we need to do this explicitly.
  const { enableConfigs } = await import("../utils/config.js");
  enableConfigs();

  const token = ensureServerToken();
  // SessionManager is constructed per-start (not at module scope) so tests
  // that rotate process.env.HOME in beforeEach get isolated state each run.
  const sm = new SessionManager(homedir());
  const pe = new PendingEditStore(homedir());
  const routes = [
    healthRoute,
    ...configRoutes,
    ...modelsRoutes,
    ...vaultsRoutes(),
    ...sessionsRoutes(sm),
    chatRoute(sm),
    ...pendingEditsRoutes(pe, {
      createBackup: (vault: string, file: string) => new BackupManager(vault).snapshot(file, { reason: "apply pending edit" }),
    }),
    ...backupsRoutes,
    ...toolsRoutes,
  ];
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
