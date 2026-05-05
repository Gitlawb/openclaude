import type { ToolModule, ToolContext, VaultToolResult } from "./registry";
import { readNote, walk, vaultRelative } from "../vaultUtils";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createCombinedAbortSignal } from "../../utils/combinedAbortSignal";

interface LinkSuggestion {
  targetNote: string;
  suggestedLink: string;
  reason: string;
  occurrences: number;
}

/** Make a non-streaming LLM call and return the text response. */
async function callLLM(prompt: string): Promise<string> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const model = process.env.OPENCLAUDE_MODEL ?? "gpt-4o-mini";

  const { signal, cleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 60_000 });
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });

    if (!res.ok) throw new Error(`LLM sub-call failed: ${res.status}`);
    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    cleanup();
  }
}

/** Extract heading titles from all vault notes as potential link targets. */
function extractNoteTopics(vault: string): Map<string, string> {
  const topics = new Map<string, string>();
  for (const file of walk(vault)) {
    const relPath = vaultRelative(vault, file);
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of content.matchAll(/^#{1,3}\s+(.+)$/gm)) {
      topics.set(match[1]!.toLowerCase().trim(), relPath);
    }
  }
  return topics;
}

export function formatToolModules(_ctx: ToolContext): ToolModule[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "summarize_notes",
          description: "Read multiple notes and create a summary using the LLM. Creates a pending edit for user approval.",
          parameters: {
            type: "object",
            properties: {
              paths: { type: "array", items: { type: "string" }, description: "Array of note paths to summarize." },
              style: { type: "string", enum: ["bullet", "narrative", "zettelkasten"], description: "Summary style." },
              targetPath: { type: "string", description: "Path for the output summary note." },
            },
            required: ["paths", "style", "targetPath"],
          },
        },
      },
      run: async (args, ctx): Promise<VaultToolResult> => {
        const { vault, pendingEditStore, sessionId } = ctx;
        if (!pendingEditStore) return { ok: false, content: "summarize_notes requires a pending edit store." };
        const paths = (args.paths as string[] | undefined) ?? [];
        const style = String(args.style ?? "bullet");
        const targetPath = String(args.targetPath ?? "");
        if (paths.length === 0) return { ok: false, content: "paths array must not be empty" };
        if (!targetPath) return { ok: false, content: "targetPath is required" };

        const noteContents: string[] = [];
        for (const p of paths) {
          const content = readNote(vault!, p);
          if (content !== null) noteContents.push(`## ${p}\n${content}`);
        }
        if (noteContents.length === 0) return { ok: false, content: "None of the provided paths exist in the vault" };

        const prompt = `Resuma as seguintes notas no estilo "${style}" em PT-BR. ` +
          `Estilo bullet = bullets concisos; narrative = texto corrido; zettelkasten = notas atômicas com [[wikilinks]].\n\n` +
          noteContents.join("\n\n---\n\n");

        let summary: string;
        try {
          summary = await callLLM(prompt);
        } catch (err) {
          return { ok: false, content: `LLM sub-call failed: ${String(err)}` };
        }

        const vaultAbs = resolve(vault!);
        const absTarget = resolve(vaultAbs, targetPath);
        if (absTarget !== vaultAbs && !absTarget.startsWith(vaultAbs + "/") && !absTarget.startsWith(vaultAbs + "\\")) {
          return { ok: false, content: "Path traversal rejected for targetPath" };
        }

        const before = readNote(vault!, targetPath) ?? "";
        const edit = pendingEditStore.create({
          file: absTarget, vault: vault!, sessionId: sessionId ?? "unknown",
          reason: `Summarize ${paths.length} notes (${style})`, before, after: summary,
        });

        return {
          ok: true,
          content: `Summary pending edit created (id: ${edit.id}) at ${targetPath}.`,
          preview: `summarized ${noteContents.length} notes`,
          pendingEdit: { id: edit.id, file: absTarget, reason: `Summarize (${style})` },
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "format_note",
          description: "Reformat a note according to instructions using the LLM. Creates a pending edit.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path of note to format." },
              instructions: { type: "string", description: "Formatting instructions." },
            },
            required: ["path", "instructions"],
          },
        },
      },
      run: async (args, ctx): Promise<VaultToolResult> => {
        const { vault, pendingEditStore, sessionId } = ctx;
        if (!pendingEditStore) return { ok: false, content: "format_note requires a pending edit store." };
        const path = String(args.path ?? "");
        const instructions = String(args.instructions ?? "");
        if (!path) return { ok: false, content: "path is required" };
        if (!instructions) return { ok: false, content: "instructions are required" };

        const vaultAbs = resolve(vault!);
        const abs = resolve(vaultAbs, path);
        if (abs !== vaultAbs && !abs.startsWith(vaultAbs + "/") && !abs.startsWith(vaultAbs + "\\")) {
          return { ok: false, content: "Path traversal rejected" };
        }

        const before = readNote(vault!, path);
        if (before === null) return { ok: false, content: `Note not found: ${path}` };

        const prompt = `Reformate a seguinte nota em PT-BR seguindo estas instruções: "${instructions}".\n\n` +
          `Retorne APENAS o novo conteúdo da nota em markdown, sem explicações.\n\n` +
          `---\n${before}\n---`;

        let formatted: string;
        try {
          formatted = await callLLM(prompt);
        } catch (err) {
          return { ok: false, content: `LLM sub-call failed: ${String(err)}` };
        }

        const edit = pendingEditStore.create({
          file: abs, vault: vault!, sessionId: sessionId ?? "unknown",
          reason: `Format: ${instructions.slice(0, 60)}`, before, after: formatted,
        });

        return {
          ok: true,
          content: `Format pending edit created (id: ${edit.id}).`,
          preview: `reformatted ${path}`,
          pendingEdit: { id: edit.id, file: abs, reason: `Format: ${instructions.slice(0, 60)}` },
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "suggest_links",
          description: "Analyze a note and suggest [[wikilinks]] to other vault notes whose headings appear in the text without being linked.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path of note to analyze." },
            },
            required: ["path"],
          },
        },
      },
      run: async (args, ctx): Promise<VaultToolResult> => {
        const { vault } = ctx;
        const path = String(args.path ?? "");
        if (!path) return { ok: false, content: "path is required" };

        const content = readNote(vault!, path);
        if (content === null) return { ok: false, content: `Note not found: ${path}` };

        const existingLinks = new Set<string>();
        for (const m of content.matchAll(/\[\[([^\]|]+)/g)) {
          existingLinks.add(m[1]!.toLowerCase().trim());
        }

        const topics = extractNoteTopics(vault!);
        const suggestions: LinkSuggestion[] = [];
        const contentLower = content.toLowerCase();

        for (const [heading, notePath] of topics.entries()) {
          if (notePath === path) continue;
          if (existingLinks.has(heading)) continue;

          let occurrences = 0;
          let idx = contentLower.indexOf(heading);
          while (idx !== -1) {
            const before = content.slice(Math.max(0, idx - 2), idx);
            if (!before.endsWith("[[")) occurrences++;
            idx = contentLower.indexOf(heading, idx + 1);
          }

          if (occurrences > 0) {
            suggestions.push({
              targetNote: notePath,
              suggestedLink: `[[${notePath.replace(/\.md$/, "")}|${heading}]]`,
              reason: `"${heading}" appears ${occurrences}x without a wikilink`,
              occurrences,
            });
          }
        }

        suggestions.sort((a, b) => b.occurrences - a.occurrences);
        const top = suggestions.slice(0, 10);

        return {
          ok: true,
          content: JSON.stringify(top),
          preview: `${top.length} link suggestions for ${path}`,
        };
      },
    },
  ];
}
