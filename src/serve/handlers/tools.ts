import type { Route } from "../http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ServerError, ErrorCode } from "../errors";
import { getActiveAgent, type AgentFn } from "./chat";
import { walk, searchVault, type SearchHit } from "../vaultUtils";

function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(content)) !== null) out.push(m[1]!.trim());
  return out;
}

function slugId(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "_");
}

async function runAgentToString(agent: AgentFn, message: string): Promise<string> {
  const pieces: string[] = [];
  for await (const ev of agent({ message, sessionId: "internal", context: {} })) {
    if (ev.event === "token") pieces.push((ev.data as { text: string }).text);
  }
  return pieces.join("");
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
  {
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
        const notePath = join(b.vault, `${note}.md`);
        if (!existsSync(notePath)) continue;
        const content = readFileSync(notePath, "utf8");
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
  },
];
