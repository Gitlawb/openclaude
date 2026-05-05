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
import { join } from "node:path";
import type { AgentFn, AgentEvent } from "./handlers/chat";
import type { PendingEditStore } from "./pendingEditStore";
import { readConfig } from "./handlers/config";
import { buildRegistry } from "./tools/registry";
import type { ToolContext } from "./tools/registry";
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

type OAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

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
  context?: { activeNote?: string; vault?: string; selection?: string; braveApiKey?: string },
  pendingEditStore?: PendingEditStore,
): AsyncIterable<AgentEvent> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey  = process.env.OPENAI_API_KEY ?? "";
  const model   = process.env.OPENCLAUDE_MODEL ?? "gpt-4o-mini";
  // Usa vault do contexto; fallback para defaultVault configurado no servidor
  const vault   = context?.vault || readConfig().defaultVault || undefined;

  const systemPrompt = vault ? `\
Você é o OpenClaude — assistente de segundo cérebro para o vault Obsidian em: ${vault}.

## REGRA FUNDAMENTAL
SEMPRE use as tools para responder perguntas sobre o vault. NUNCA invente ou suponha conteúdo.
Fluxo obrigatório: list_vault → read_note → responda com base no conteúdo real.

## Responsabilidades
1. NAVEGAR antes de responder — use list_vault e search_vault para entender o vault real
2. LER o conteúdo — use read_note para ler arquivos antes de falar sobre eles
3. BUSCAR — use search_vault quando o usuário perguntar sobre um tema específico
4. CONSTRUIR — use write_note para criar/editar notas (sempre com diff para aprovação)

## Regras de tools
- Se o usuário perguntar "o que temos sobre X": use search_vault("X")
- Se o usuário pedir para listar notas/pastas: use list_vault()
- Se o usuário pedir para ler/consultar uma nota: use read_note(path)
- NUNCA diga que não tem acesso ao vault — você TEM as tools, use-as
- NUNCA diga que não há conteúdo sem primeiro fazer search_vault

## Formato
- Responda SEMPRE em PT-BR
- Use markdown para formatar respostas
- Seja direto e objetivo` :
  `Você é o OpenClaude, assistente de Obsidian. Responda sempre em PT-BR de forma direta e objetiva.`;

  const contextLines: string[] = [];
  if (context?.vault)       contextLines.push(`[Vault: ${context.vault}]`);
  if (context?.activeNote)  contextLines.push(`[Active note:\n${context.activeNote}]`);
  if (context?.selection)   contextLines.push(`[Selection:\n${context.selection}]`);
  const userContent = contextLines.length > 0
    ? `${contextLines.join("\n")}\n\n${message}`
    : message;

  const toolCtx: ToolContext = { vault, braveApiKey: context?.braveApiKey, pendingEditStore, sessionId };
  const registry = buildRegistry(toolCtx);
  const tools = registry.length > 0 ? registry.map(m => m.definition) : undefined;

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

      const mod = registry.find(m => m.definition.function.name === tc.function.name);
      const result = mod
        ? await mod.run(args, toolCtx)
        : { ok: false, content: `Unknown tool: ${tc.function.name}`, preview: undefined };

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
