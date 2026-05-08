import type { PendingEditStore } from "../pendingEditStore";
import { vaultToolModules } from "./vaultTools";
import { webToolModules } from "./webTools";
import { formatToolModules } from "./formatTools";
import { thoughtToolModules } from "./thoughtTools";

export interface VaultToolResult {
  ok: boolean;
  content: string;
  preview?: string;
  pendingEdit?: { id: string; file: string; reason: string };
}

export interface ToolContext {
  vault?: string;
  braveApiKey?: string;
  pendingEditStore?: PendingEditStore;
  sessionId?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>;
      required: string[];
    };
  };
}

export interface ToolModule {
  definition: ToolDefinition;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<VaultToolResult>;
}

/** Returns true if an OpenAI-compatible endpoint is configured at runtime. */
function hasOpenAICompatibleProvider(): boolean {
  return !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
}

export function buildRegistry(ctx: ToolContext): ToolModule[] {
  const modules: ToolModule[] = [];
  // Thought tools require an OpenAI-compatible endpoint because they make direct
  // sub-calls to callLLM. We detect this by checking OPENAI_API_KEY or OPENAI_BASE_URL
  // (covers both standard OpenAI keys and local Ollama/compatible servers).
  if (hasOpenAICompatibleProvider()) {
    modules.push(...thoughtToolModules(ctx));
  }
  if (ctx.vault) {
    modules.push(...vaultToolModules(ctx));
    modules.push(...formatToolModules(ctx));
  }
  if (ctx.braveApiKey) {
    modules.push(...webToolModules(ctx));
  }
  return modules;
}
