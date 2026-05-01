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
