import { resolve, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { walk, searchVault, readNote, vaultRelative } from "../vaultUtils";
import type { ToolModule, ToolContext, VaultToolResult } from "./registry";

export function vaultToolModules(_ctx: ToolContext): ToolModule[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "list_vault",
          description:
            "List all markdown notes in the vault. Returns a JSON array of file paths relative to the vault root. Use to discover what notes exist before reading them.",
          parameters: {
            type: "object",
            properties: {
              subdir: {
                type: "string",
                description:
                  "Optional subdirectory to list (relative to vault root). Omit to list the entire vault.",
              },
            },
            required: [],
          },
        },
      },
      async run(args: Record<string, unknown>, ctx: ToolContext): Promise<VaultToolResult> {
        const vault = ctx.vault!;
        const subdir = typeof args.subdir === "string" && args.subdir ? args.subdir : "";
        const vaultAbs = resolve(vault);
        const root = subdir ? resolve(vaultAbs, subdir) : vaultAbs;
        // Guard: root must stay inside vault
        if (root !== vaultAbs && !root.startsWith(vaultAbs + "/") && !root.startsWith(vaultAbs + "\\")) {
          return { ok: false, content: `Path traversal rejected: ${subdir}` };
        }
        if (!existsSync(root)) {
          return { ok: false, content: `Directory not found: ${subdir || vault}` };
        }
        const files = walk(root).map(f => vaultRelative(vault, f));
        return { ok: true, content: JSON.stringify(files), preview: `${files.length} notes` };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "read_note",
          description:
            "Read the full content of a note by its relative path. Use paths returned by list_vault.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Path to the note relative to the vault root (e.g. 'Projects/Alpha.md').",
              },
            },
            required: ["path"],
          },
        },
      },
      async run(args: Record<string, unknown>, ctx: ToolContext): Promise<VaultToolResult> {
        const vault = ctx.vault!;
        const path = String(args.path ?? "");
        const content = readNote(vault, path);
        if (content === null) {
          return { ok: false, content: `Note not found or path invalid: ${path}` };
        }
        const truncated = content.length > 10_000;
        return {
          ok: true,
          content: truncated ? content.slice(0, 10_000) + "\n…[truncated]" : content,
          preview: `${content.length} chars`,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "search_vault",
          description:
            "Full-text search across all notes in the vault. Returns matching lines with file, line number, and snippet. Case-insensitive.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search term (case-insensitive substring match).",
              },
              maxResults: {
                type: "number",
                description: "Maximum results to return (default 10, max 20).",
              },
            },
            required: ["query"],
          },
        },
      },
      async run(args: Record<string, unknown>, ctx: ToolContext): Promise<VaultToolResult> {
        const vault = ctx.vault!;
        const query = String(args.query ?? "");
        if (!query) return { ok: false, content: "query is required" };
        const max = Math.min(Number(args.maxResults ?? 10), 20);
        const hits = searchVault(vault, query, max).map(h => ({
          ...h,
          file: vaultRelative(vault, h.file),
        }));
        return {
          ok: true,
          content: JSON.stringify(hits),
          preview: `${hits.length} matches for "${query}"`,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "write_note",
          description:
            "Propose creating or updating a note. The change is queued for user review — nothing is written until the user clicks Apply in the diff preview. Always use this for any note creation or modification.",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Destination path relative to vault root (e.g. 'Projects/NewNote.md'). Creates the note if it does not exist.",
              },
              content: {
                type: "string",
                description: "Full new content for the note (markdown).",
              },
              reason: {
                type: "string",
                description: "Short explanation of why this change is being made (shown to user in diff preview).",
              },
            },
            required: ["path", "content", "reason"],
          },
        },
      },
      async run(args: Record<string, unknown>, ctx: ToolContext): Promise<VaultToolResult> {
        const vault = ctx.vault!;
        const { pendingEditStore, sessionId } = ctx;
        if (!pendingEditStore) {
          return {
            ok: false,
            content:
              "write_note requires a pending edit store. Make sure the server started with a store configured.",
          };
        }
        const path    = String(args.path ?? "");
        const content = String(args.content ?? "");
        const reason  = String(args.reason ?? "Agent-proposed change");
        if (!path) return { ok: false, content: "path is required" };

        const vaultAbs = resolve(vault);
        const abs      = resolve(vaultAbs, path);
        // Block path traversal
        if (abs !== vaultAbs && !abs.startsWith(vaultAbs + "/") && !abs.startsWith(vaultAbs + "\\")) {
          return { ok: false, content: "Path traversal rejected" };
        }

        // Ensure parent directory exists
        mkdirSync(dirname(abs), { recursive: true });

        const before = readNote(vault, path) ?? "";
        const edit   = pendingEditStore.create({
          file: abs, vault, sessionId: sessionId ?? "unknown", reason, before, after: content,
        });

        return {
          ok:          true,
          content:     `Pending edit created (id: ${edit.id}). The user will be prompted to review and apply the change.`,
          preview:     `pending edit for ${path}`,
          pendingEdit: { id: edit.id, file: abs, reason },
        };
      },
    },
  ];
}
