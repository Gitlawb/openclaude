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
