/**
 * agentAdapter — bridges the OpenClaude core query engine to the serve-layer AgentFn contract.
 *
 * Two execution paths:
 *   1. External provider (CLAUDE_CODE_USE_OPENAI=1): lightweight direct fetch to any
 *      OpenAI-compatible endpoint (Groq, Ollama, etc.). Bypasses the heavy Claude Code
 *      query engine to stay well within provider request size limits (e.g. Groq: 20MB).
 *   2. Anthropic (default): calls ask() which uses the full Claude Code query engine
 *      with Anthropic OAuth / API key auth.
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { walk, searchVault, readNote, vaultRelative } from "./vaultUtils";
import type { AgentFn, AgentEvent } from "./handlers/chat";
import type { PendingEditStore } from "./pendingEditStore";
import { ask } from "../QueryEngine";
import { createAbortController } from "../utils/abortController";
import { getDefaultAppState } from "../state/AppStateStore";
import type { AppState } from "../state/AppStateStore";
import { createFileStateCacheWithSizeLimit, type FileStateCache } from "../utils/fileStateCache";

// ─── Minimal type shims (SDKMessage types come from generated stubs) ───────

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AssistantMessage {
  type: "assistant";
  message: { content: ContentBlock[]; stop_reason?: string | null };
  session_id: string;
  uuid: string;
  error?: unknown;
  parent_tool_use_id: string | null;
}

interface ResultMessage {
  type: "result";
  subtype: string;
  is_error?: boolean;
  stop_reason?: string | null;
  duration_ms?: number;
  session_id?: string;
  total_cost_usd?: number;
  usage?: unknown;
  num_turns?: number;
  error?: { code?: string; message?: string };
}

type SDKMessageLike = AssistantMessage | ResultMessage | { type: string };

// ─── SDKMessage → AgentEvent translator ────────────────────────────────────

function* translateSDKMessage(
  msg: SDKMessageLike,
  sessionId: string,
): Generator<AgentEvent> {
  switch (msg.type) {
    case "assistant": {
      const assistant = msg as AssistantMessage;
      for (const block of assistant.message.content) {
        if (block.type === "text" && block.text) {
          yield { event: "token", data: { text: block.text } };
        } else if (block.type === "tool_use") {
          yield {
            event: "tool_call",
            data: { id: block.id!, name: block.name!, args: block.input },
          };
        }
      }
      break;
    }
    case "result": {
      const result = msg as ResultMessage;
      if (result.is_error) {
        const code = result.error?.code ?? result.subtype ?? "PROVIDER_ERROR";
        const message = result.error?.message ?? "Query engine returned an error";
        yield { event: "error", data: { code, message } };
      }
      yield {
        event: "done",
        data: { sessionId, finishReason: result.stop_reason ?? result.subtype ?? "stop" },
      };
      break;
    }
    default:
      break;
  }
}

// ─── OpenAI function-calling tool definitions ──────────────────────────────

const VAULT_TOOLS = [
  {
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
  {
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
  {
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
  {
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
];

// ─── Internal types for the agentic loop ───────────────────────────────────

interface OAIToolCallAccum {
  id: string;
  name: string;
  argsBuffer: string;
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface VaultToolResult {
  ok: boolean;
  content: string;
  preview?: string;
  // Populated only by write_note:
  pendingEdit?: { id: string; file: string; reason: string };
}

type OAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// ─── Vault tool runner ─────────────────────────────────────────────────────

function runVaultTool(
  name: string,
  args: Record<string, unknown>,
  vault: string,
  pendingEditStore?: PendingEditStore,
  sessionId?: string,
): VaultToolResult {
  switch (name) {
    case "list_vault": {
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
    }
    case "read_note": {
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
    }
    case "search_vault": {
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
    }
    case "write_note": {
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
    }
    default:
      return { ok: false, content: `Unknown tool: ${name}` };
  }
}

// ─── Lightweight OpenAI-compatible agent (agentic loop with function calling) ─

/**
 * Calls any OpenAI-compatible API (Groq, Ollama, etc.) directly via streaming fetch.
 * Supports OpenAI function-calling with vault tools (list_vault, read_note, search_vault).
 * Runs up to MAX_AGENT_TURNS turns: stream → tool_calls → inject results → continue.
 *
 * Reads from env vars set by the plugin's ServerManager.buildProviderEnv():
 *   OPENAI_BASE_URL   — e.g. https://api.groq.com/openai/v1
 *   OPENAI_API_KEY    — API key or "ollama" for local
 *   OPENCLAUDE_MODEL  — model name (required for this path)
 */
const MAX_AGENT_TURNS = 5;

async function* lightweightOpenAIAgent(
  message: string,
  sessionId: string,
  context?: { activeNote?: string; vault?: string; selection?: string },
  pendingEditStore?: PendingEditStore,
): AsyncIterable<AgentEvent> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey  = process.env.OPENAI_API_KEY ?? "";
  const model   = process.env.OPENCLAUDE_MODEL ?? "gpt-4o-mini";
  const vault   = context?.vault;

  const vaultLine = vault
    ? `You are an AI assistant inside the Obsidian vault at: ${vault}.`
    : "You are a helpful AI assistant inside Obsidian.";
  const toolsHint = vault
    ? " You have tools to list, read, and search vault notes — use them proactively when the user asks about vault contents."
    : "";
  const systemPrompt = `${vaultLine}${toolsHint} Answer concisely and helpfully in the same language as the user.`;

  const contextLines: string[] = [];
  if (context?.vault)       contextLines.push(`[Vault: ${context.vault}]`);
  if (context?.activeNote)  contextLines.push(`[Active note:\n${context.activeNote}]`);
  if (context?.selection)   contextLines.push(`[Selection:\n${context.selection}]`);
  const userContent = contextLines.length > 0
    ? `${contextLines.join("\n")}\n\n${message}`
    : message;

  const tools = vault ? VAULT_TOOLS : undefined;

  const messages: OAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userContent  },
  ];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const body = JSON.stringify({
      model,
      stream: true,
      messages,
      ...(tools ? { tools } : {}),
    });

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body,
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => String(res.status));
      yield { event: "error", data: { code: String(res.status), message: errText } };
      yield { event: "done",  data: { sessionId, finishReason: "error" } };
      return;
    }

    // ── Stream SSE, accumulate tool-call deltas ─────────────────────────────
    const decoder     = new TextDecoder();
    const reader      = res.body.getReader();
    let   buffer      = "";
    let   finishReason: string | null = null;
    const toolCallMap = new Map<number, OAIToolCallAccum>();
    const assistantText: string[] = [];

    try {
      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") { streamDone = true; break; }

          try {
            const chunk  = JSON.parse(data);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (delta?.content) {
              assistantText.push(delta.content);
              yield { event: "token", data: { text: delta.content } };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls as Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>) {
                if (!toolCallMap.has(tc.index)) {
                  toolCallMap.set(tc.index, { id: "", name: "", argsBuffer: "" });
                }
                const entry = toolCallMap.get(tc.index)!;
                if (tc.id)                  entry.id         = tc.id;
                if (tc.function?.name)      entry.name       = tc.function.name;
                if (tc.function?.arguments) entry.argsBuffer += tc.function.arguments;
              }
            }
          } catch {
            // Malformed chunk — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Assemble complete tool calls from accumulated deltas
    const toolCalls: OAIToolCall[] = [...toolCallMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id:       tc.id,
        type:     "function" as const,
        function: { name: tc.name, arguments: tc.argsBuffer },
      }));

    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      yield { event: "done", data: { sessionId, finishReason: finishReason ?? "stop" } };
      return;
    }

    // ── Model requested tools — run them and inject results ─────────────────
    messages.push({
      role:       "assistant",
      content:    assistantText.join("") || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON */ }

      yield {
        event: "tool_call",
        data:  { id: tc.id, name: tc.function.name, args },
      };

      const result = vault
        ? runVaultTool(tc.function.name, args, vault, pendingEditStore, sessionId)
        : { ok: false, content: "No vault available for tool calls", preview: undefined };

      yield {
        event: "tool_result",
        data:  { id: tc.id, ok: result.ok, preview: result.preview },
      };

      // Emit pending_edit event so the plugin shows Apply/Reject buttons
      if (result.pendingEdit) {
        yield {
          event: "pending_edit",
          data:  {
            id:     result.pendingEdit.id,
            file:   result.pendingEdit.file,
            reason: result.pendingEdit.reason,
          },
        };
      }

      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      result.content,
      });
    }
    // Continue agentic loop with updated history
  }

  yield { event: "done", data: { sessionId, finishReason: "max_turns" } };
}

// ─── Factory ────────────────────────────────────────────────────────────────

export type RealAgentOpts = {
  strictMode?: boolean;
  pendingEditStore?: PendingEditStore;
};

/**
 * Create a real AgentFn.
 *
 * - If CLAUDE_CODE_USE_OPENAI=1: uses lightweightOpenAIAgent (direct fetch, no bloat).
 * - Otherwise: uses ask() with the full Claude Code query engine (Anthropic auth).
 */
export function createRealAgent(_opts: RealAgentOpts = {}): AgentFn {
  // Persistent state for the Anthropic path (multi-turn).
  let appState: AppState = getDefaultAppState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messages: any[] = [];
  const readFileCache = createFileStateCacheWithSizeLimit(100);
  const { pendingEditStore } = _opts;

  return async function* (input): AsyncIterable<AgentEvent> {
    try {
      // ── External provider path (Groq / Ollama / any OpenAI-compatible) ──
      if (process.env.CLAUDE_CODE_USE_OPENAI === "1") {
        yield* lightweightOpenAIAgent(input.message, input.sessionId, input.context, pendingEditStore);
        return;
      }

      // ── Anthropic path: full Claude Code query engine ──
      let prompt = input.message;
      const ctx = input.context;
      if (ctx) {
        const contextLines: string[] = [];
        if (ctx.vault)       contextLines.push(`[Vault: ${ctx.vault}]`);
        if (ctx.activeNote)  contextLines.push(`[Active note: ${ctx.activeNote}]`);
        if (ctx.selection)   contextLines.push(`[Selection:\n${ctx.selection}]`);
        if (contextLines.length > 0) prompt = `${contextLines.join("\n")}\n\n${prompt}`;
      }

      const cwd = input.context?.vault ?? homedir();
      const abortController = createAbortController();

      for await (const msg of ask({
        commands: [],
        prompt,
        cwd,
        tools: [],
        mcpClients: [],
        canUseTool: async () => ({ behavior: "allow" as const }),
        mutableMessages: messages,
        getReadFileCache: () => readFileCache,
        setReadFileCache: (cache: FileStateCache) => {
          for (const [key, value] of cache.entries()) {
            readFileCache.set(key, value);
          }
        },
        getAppState: () => appState,
        setAppState: (f: (prev: AppState) => AppState) => { appState = f(appState); },
        abortController,
        maxTurns: 10,
      })) {
        yield* translateSDKMessage(msg as unknown as SDKMessageLike, input.sessionId);
      }
    } catch (err) {
      yield {
        event: "error",
        data: { code: "INTERNAL", message: String(err instanceof Error ? err.message : err) },
      };
    }
  };
}
