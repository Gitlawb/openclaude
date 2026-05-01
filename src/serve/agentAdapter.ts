/**
 * agentAdapter — bridges the OpenClaude core query engine to the serve-layer AgentFn contract.
 *
 * Each /chat invocation calls ask() (the high-level convenience wrapper in QueryEngine.ts),
 * which bootstraps a QueryEngine, calls query(), and yields SDKMessage events.
 * This adapter translates those SDKMessage events into AgentEvent for SSE streaming.
 */

import type { AgentFn, AgentEvent } from "./handlers/chat";
import { ask } from "../QueryEngine";
import { createAbortController } from "../utils/abortController";
import { getDefaultAppState } from "../state/AppStateStore";
import type { AppState } from "../state/AppStateStore";
import { createFileStateCacheWithSizeLimit, type FileStateCache } from "../utils/fileStateCache";

// ─── Minimal type shims (SDKMessage types come from generated stubs, so we
//     define the fields we actually read at runtime) ──────────────────────────

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

// ─── Translator ─────────────────────────────────────────────────────────────

/**
 * Translate a single SDKMessage into zero or more AgentEvents.
 * Yields multiple events when an assistant message has multiple content blocks.
 */
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
        const message =
          result.error?.message ?? "Query engine returned an error";
        yield { event: "error", data: { code, message } };
      }
      yield {
        event: "done",
        data: {
          sessionId,
          finishReason: result.stop_reason ?? result.subtype ?? "stop",
        },
      };
      break;
    }

    // user, stream_event, system, attachment, etc. — not streamed to the client
    default:
      break;
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export type RealAgentOpts = {
  /** If true, the adapter will run in strict mode (future use). */
  strictMode?: boolean;
};

/**
 * Create a real AgentFn that calls ask() (OpenClaude query engine).
 *
 * The returned function:
 * 1. Builds a context-aware prompt (prepends vault/selection context)
 * 2. Calls ask() with minimal configuration (empty tools for MVP)
 * 3. Translates SDKMessage → AgentEvent via translateSDKMessage()
 * 4. Catches all errors and yields AgentEvent { event: "error" }
 */
export function createRealAgent(_opts: RealAgentOpts = {}): AgentFn {
  // Persistent state across calls — multi-turn conversation lives here.
  let appState: AppState = getDefaultAppState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messages: any[] = [];
  const readFileCache = createFileStateCacheWithSizeLimit(100);

  return async function* (input): AsyncIterable<AgentEvent> {
    try {
      // ── Build context-aware prompt ──
      let prompt = input.message;
      const ctx = input.context;
      if (ctx) {
        const contextLines: string[] = [];
        if (ctx.vault) contextLines.push(`[Vault: ${ctx.vault}]`);
        if (ctx.activeNote)
          contextLines.push(`[Active note: ${ctx.activeNote}]`);
        if (ctx.selection)
          contextLines.push(`[Selection:\n${ctx.selection}]`);
        if (contextLines.length > 0) {
          prompt = `${contextLines.join("\n")}\n\n${prompt}`;
        }
      }

      const abortController = createAbortController();

      for await (const msg of ask({
        commands: [],
        prompt,
        cwd: process.cwd(),
        tools: [], // MVP: no tools; agent tool use added in later tasks
        mcpClients: [],
        canUseTool: async () => ({ behavior: "allow" as const }),
        mutableMessages: messages,
        getReadFileCache: () => readFileCache,
        setReadFileCache: (cache: FileStateCache) => {
          // Update persistent cache for subsequent calls
          for (const [key, value] of cache.entries()) {
            readFileCache.set(key, value);
          }
        },
        getAppState: () => appState,
        setAppState: (f: (prev: AppState) => AppState) => {
          appState = f(appState);
        },
        abortController,
        maxTurns: 10,
      })) {
        yield* translateSDKMessage(
          msg as unknown as SDKMessageLike,
          input.sessionId,
        );
      }
    } catch (err) {
      yield {
        event: "error",
        data: {
          code: "INTERNAL",
          message: String(err instanceof Error ? err.message : err),
        },
      };
    }
  };
}
