import type { PendingEditStore } from "../pendingEditStore";
import { vaultToolModules } from "./vaultTools";
import { webToolModules } from "./webTools";
import { formatToolModules } from "./formatTools";

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

export interface ToolModule {
  definition: object;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<VaultToolResult>;
}

export function buildRegistry(ctx: ToolContext): ToolModule[] {
  const modules: ToolModule[] = [];
  if (ctx.vault) {
    modules.push(...vaultToolModules(ctx));
    modules.push(...formatToolModules(ctx));
  }
  if (ctx.braveApiKey) {
    modules.push(...webToolModules(ctx));
  }
  return modules;
}
