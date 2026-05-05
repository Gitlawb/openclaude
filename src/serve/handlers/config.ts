import type { Route } from "../http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

type ServerConfig = {
  permissions: { preset: "conservador" | "balanceado" | "agressivo" };
  backup: { retentionDays: number };
  rateLimit: { windowMs: number; max: number };
  /** Vault padrão usado quando o plugin não envia vault no contexto. */
  defaultVault?: string;
};

const DEFAULTS: ServerConfig = {
  permissions: { preset: "balanceado" },
  backup: { retentionDays: 30 },
  rateLimit: { windowMs: 60_000, max: 100 },
  defaultVault: "",
};

export { type ServerConfig };
export { readConfig };

function configPath(): string {
  return join(homedir(), ".openclaude", "server-config.json");
}
function readConfig(): ServerConfig {
  const p = configPath();
  if (!existsSync(p)) return { ...DEFAULTS };
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
