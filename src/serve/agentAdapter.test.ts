/**
 * agentAdapter tests — smoke test + event translation.
 *
 * These tests verify that createRealAgent():
 * - Returns a valid AgentFn
 * - Yields at least one event (error is acceptable when no LLM is configured)
 * - Yields error events instead of throwing on provider failure
 * - Handles context prepending without crashing
 *
 * NOTE: These tests do NOT hit a real LLM provider.
 * They force provider failure via OPENAI_BASE_URL=http://127.0.0.1:1
 * and verify the adapter handles the error gracefully.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { createRealAgent, extractSuggestions } from "./agentAdapter";
import type { AgentEvent } from "./handlers/chat";
import { PendingEditStore } from "./pendingEditStore";

/** Helper: drain an AsyncIterable into an array (with timeout safety). */
async function drainEvents(
  iter: AsyncIterable<AgentEvent>,
  maxMs = 30_000,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const timer = setTimeout(() => {
    throw new Error(`drainEvents timed out after ${maxMs}ms`);
  }, maxMs);
  try {
    for await (const evt of iter) {
      events.push(evt);
    }
  } finally {
    clearTimeout(timer);
  }
  return events;
}

describe("agentAdapter — createRealAgent", () => {
  let origBaseUrl: string | undefined;
  let origApiKey: string | undefined;

  beforeEach(() => {
    origBaseUrl = process.env.OPENAI_BASE_URL;
    origApiKey = process.env.OPENAI_API_KEY;
    // Force a provider failure — guaranteed no connection
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    // Restore env
    if (origBaseUrl !== undefined) process.env.OPENAI_BASE_URL = origBaseUrl;
    else delete process.env.OPENAI_BASE_URL;
    if (origApiKey !== undefined) process.env.OPENAI_API_KEY = origApiKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it("returns a function implementing AgentFn signature", () => {
    const agent = createRealAgent();
    expect(typeof agent).toBe("function");
    // Should accept AgentFn input shape and return an async iterable
    const result = agent({
      message: "test",
      sessionId: "test-session",
    });
    expect(result).toBeDefined();
    expect(typeof (result as any)[Symbol.asyncIterator]).toBe("function");
  });

  it("yields at least one event when provider fails", async () => {
    const agent = createRealAgent();
    const events = await drainEvents(
      agent({
        message: "hello test",
        sessionId: "test-session-001",
      }),
    );
    // Must produce at least one event (error or done)
    expect(events.length).toBeGreaterThan(0);
    // Last event should be either "done" or "error"
    const lastEvent = events[events.length - 1]!;
    expect(["done", "error"]).toContain(lastEvent.event);
  });

  it("yields error event instead of throwing on failure", async () => {
    const agent = createRealAgent();
    // The agent should NOT throw — it should yield error events
    let threw = false;
    let events: AgentEvent[] = [];
    try {
      events = await drainEvents(
        agent({
          message: "test",
          sessionId: "test-session-002",
        }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // All events should be valid AgentEvents with { event, data }
    for (const evt of events) {
      expect(evt).toHaveProperty("event");
      expect(evt).toHaveProperty("data");
    }
  });

  it("handles context fields without crashing", async () => {
    const agent = createRealAgent();
    // Should not throw with all context fields populated
    const events = await drainEvents(
      agent({
        message: "summarize this",
        sessionId: "test-session-003",
        context: {
          vault: "Energinova_Hub",
          activeNote: "Projects/MOC.md",
          selection: "Some selected text",
        },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("handles empty context gracefully", async () => {
    const agent = createRealAgent();
    const events = await drainEvents(
      agent({
        message: "hello",
        sessionId: "test-session-004",
        context: {},
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("handles no context at all", async () => {
    const agent = createRealAgent();
    const events = await drainEvents(
      agent({
        message: "hello",
        sessionId: "test-session-005",
      }),
    );
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("agentAdapter — error event structure", () => {
  it("error events have { code, message } data shape", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(
        agent({
          message: "test",
          sessionId: "test-session-err",
        }),
      );
      const errorEvents = events.filter(e => e.event === "error");
      for (const evt of errorEvents) {
        expect(evt.data).toHaveProperty("code");
        expect(evt.data).toHaveProperty("message");
        expect(typeof (evt.data as any).code).toBe("string");
        expect(typeof (evt.data as any).message).toBe("string");
      }
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("done events have { finishReason } data shape", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(
        agent({
          message: "test",
          sessionId: "test-session-done",
        }),
      );
      const doneEvents = events.filter(e => e.event === "done");
      for (const evt of doneEvents) {
        expect(evt.data).toHaveProperty("finishReason");
        expect(typeof (evt.data as any).finishReason).toBe("string");
      }
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });
});

// ─── Mock-server integration tests ─────────────────────────────────────────
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { tmpdir } from "node:os";

describe("agentAdapter — vault tools with mock provider", () => {
  let vault: string;

  beforeAll(() => {
    vault = mkdtempSync(pathJoin(tmpdir(), "oc-vault-task2-"));
    mkdirSync(pathJoin(vault, "Projects"), { recursive: true });
    writeFileSync(pathJoin(vault, "index.md"), "# Index\nWelcome to the vault.");
    writeFileSync(pathJoin(vault, "Projects", "Alpha.md"), "# Alpha\nBudget: 100k");
  });

  // Helper: build a fake SSE response that returns a normal stop
  function makeStopResponse(text: string): Response {
    const body = [
      `data: {"choices":[{"delta":{"content":"${text}"},"finish_reason":null}]}`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
      `data: [DONE]`,
      "",
    ].join("\n\n");
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }

  it("yields token and done events from a mock stop response", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => makeStopResponse("hello world"),
    });
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(
        agent({ message: "hi", sessionId: "s1", context: { vault } }),
      );
      expect(events.some(e => e.event === "token")).toBe(true);
      const done = events.find(e => e.event === "done");
      expect(done).toBeDefined();
      expect((done!.data as any).finishReason).toBe("stop");
    } finally {
      await server.stop();
      delete process.env.CLAUDE_CODE_USE_OPENAI;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });

  it("executes list_vault tool call and continues to stop", async () => {
    // Turn 1: model requests list_vault
    // Turn 2: model returns stop after receiving tool result
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requestCount++;
        if (requestCount === 1) {
          // First turn: tool_call response
          const body = [
            `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_vault","arguments":""}}]},"finish_reason":null}]}`,
            `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":null}]}`,
            `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
            `data: [DONE]`,
            "",
          ].join("\n\n");
          return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
        }
        // Second turn: stop after receiving tool result
        return makeStopResponse("I found your notes.");
      },
    });
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(
        agent({ message: "list my notes", sessionId: "s2", context: { vault } }),
      );
      // Should have: tool_call, tool_result, token, done
      expect(events.some(e => e.event === "tool_call")).toBe(true);
      expect(events.some(e => e.event === "tool_result")).toBe(true);
      const toolCall = events.find(e => e.event === "tool_call");
      expect((toolCall!.data as any).name).toBe("list_vault");
      const toolResult = events.find(e => e.event === "tool_result");
      expect((toolResult!.data as any).ok).toBe(true);
      const done = events.find(e => e.event === "done");
      expect(done).toBeDefined();
      expect((done!.data as any).finishReason).toBe("stop");
      expect(requestCount).toBe(2); // Two HTTP requests (two turns)
    } finally {
      await server.stop();
      delete process.env.CLAUDE_CODE_USE_OPENAI;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });

  it("list_vault rejects path traversal subdir and returns ok:false in tool_result", async () => {
    // Mock server: turn 1 requests list_vault with traversal subdir "../.."
    //             turn 2 (never reached) would be a stop
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requestCount++;
        if (requestCount === 1) {
          // Build the SSE line for the arguments delta separately to avoid escaping issues
          const argsJson = JSON.stringify({ subdir: "../.." });
          const argsDelta = JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argsJson } }] }, finish_reason: null }],
          });
          const body = [
            `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_trav","type":"function","function":{"name":"list_vault","arguments":""}}]},"finish_reason":null}]}`,
            `data: ${argsDelta}`,
            `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
            `data: [DONE]`,
            "",
          ].join("\n\n");
          return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
        }
        // Turn 2: stop (the agent continues after injecting the tool result)
        return new Response(
          [
            `data: {"choices":[{"delta":{"content":"No files found."},"finish_reason":null}]}`,
            `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
            `data: [DONE]`,
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(
        agent({ message: "list parent notes", sessionId: "s-trav", context: { vault } }),
      );
      // Must have a tool_result with ok:false (traversal was rejected)
      const toolResult = events.find(e => e.event === "tool_result");
      expect(toolResult).toBeDefined();
      expect((toolResult!.data as any).ok).toBe(false);
    } finally {
      await server.stop();
      delete process.env.CLAUDE_CODE_USE_OPENAI;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

describe("agentAdapter — write_note tool", () => {
  it("createRealAgent accepts pendingEditStore option without throwing", () => {
    const store = new PendingEditStore(tmpdir());
    expect(() => createRealAgent({ pendingEditStore: store })).not.toThrow();
  });

  it("write_note creates a pending edit and yields pending_edit event", async () => {
    const store = new PendingEditStore(tmpdir());
    const vault = mkdtempSync(pathJoin(tmpdir(), "oc-vault-write-"));
    writeFileSync(pathJoin(vault, "existing.md"), "# Existing\nOld content.");

    // Mock server: returns write_note tool_call on turn 1, stop on turn 2
    let requestCount = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requestCount++;
        if (requestCount === 1) {
          const writeArgs = JSON.stringify({ path: "existing.md", content: "# Existing\nNew content.", reason: "test update" });
          const body = [
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_w1", type: "function", function: { name: "write_note", arguments: writeArgs } }] }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
            `data: [DONE]`,
            "",
          ].join("\n\n");
          return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
        }
        return new Response(
          [
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Done." }, finish_reason: null }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
            `data: [DONE]`,
            "",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });

    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const agent = createRealAgent({ pendingEditStore: store });
      const events = await drainEvents(
        agent({ message: "update existing.md", sessionId: "s-write", context: { vault } }),
      );

      // Verify pending_edit event emitted
      const pendingEditEvt = events.find(e => e.event === "pending_edit");
      expect(pendingEditEvt).toBeDefined();
      expect((pendingEditEvt!.data as any).reason).toBe("test update");

      // Verify tool_result ok
      const toolResultEvt = events.find(e => e.event === "tool_result");
      expect(toolResultEvt).toBeDefined();
      expect((toolResultEvt!.data as any).ok).toBe(true);

      // Verify the pending edit was stored
      const pendingId = (pendingEditEvt!.data as any).id;
      const edit = store.get(pendingId);
      expect(edit).toBeDefined();
      expect(edit!.before).toBe("# Existing\nOld content.");
      expect(edit!.after).toBe("# Existing\nNew content.");
    } finally {
      await server.stop();
      delete process.env.CLAUDE_CODE_USE_OPENAI;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

// === Task 5 additions ===

describe("extractSuggestions", () => {
  it("extracts suggestion items from structured response", () => {
    const text = `# Resposta

Aqui está o conteúdo.

📋 **Próximos Passos**
1. liste as notas de projetos ativos
2. busque tendências de mercado livre de energia
3. crie uma nota sobre blockchain

`;
    const suggestions = extractSuggestions(text);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toBe("liste as notas de projetos ativos");
    expect(suggestions[2]).toBe("crie uma nota sobre blockchain");
  });

  it("returns empty array when no Próximos Passos section", () => {
    const text = "# Resposta\n\nAlgum texto sem sugestões.";
    expect(extractSuggestions(text)).toHaveLength(0);
  });

  it("limits to 5 suggestions", () => {
    const items = Array.from({ length: 8 }, (_, i) => `${i + 1}. sugestão ${i + 1}`).join("\n");
    const text = `📋 **Próximos Passos**\n${items}\n\n`;
    expect(extractSuggestions(text).length).toBeLessThanOrEqual(5);
  });
});

describe("agentAdapter — suggestions SSE event emitted", () => {
  it("emits suggestions event before done when response contains Próximos Passos", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        const body = [
          `data: {"choices":[{"delta":{"content":"Aqui está o resumo.\\n\\n📋 **Próximos Passos**\\n1. liste o vault\\n2. busque energia solar\\n"},"finish_reason":null}]}`,
          `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
          `data: [DONE]`,
          "",
        ].join("\n\n");
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const origUseOpenAI = process.env.CLAUDE_CODE_USE_OPENAI;
    const origBaseUrl   = process.env.OPENAI_BASE_URL;
    const origApiKey    = process.env.OPENAI_API_KEY;
    const origModel     = process.env.OPENCLAUDE_MODEL;
    process.env.CLAUDE_CODE_USE_OPENAI = "1";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const agent = createRealAgent();
      const events = await drainEvents(agent({ message: "o que temos?", sessionId: "s-sugg" }));
      const suggestionsEvt = events.find(e => e.event === "suggestions");
      expect(suggestionsEvt).toBeDefined();
      expect((suggestionsEvt!.data as any).items).toContain("liste o vault");
      // done must come after suggestions
      const suggIdx = events.indexOf(suggestionsEvt!);
      const doneIdx = events.findIndex(e => e.event === "done");
      expect(doneIdx).toBeGreaterThan(suggIdx);
    } finally {
      await server.stop(true);
      origUseOpenAI !== undefined ? (process.env.CLAUDE_CODE_USE_OPENAI = origUseOpenAI) : delete process.env.CLAUDE_CODE_USE_OPENAI;
      origBaseUrl   !== undefined ? (process.env.OPENAI_BASE_URL = origBaseUrl)           : delete process.env.OPENAI_BASE_URL;
      origApiKey    !== undefined ? (process.env.OPENAI_API_KEY = origApiKey)             : delete process.env.OPENAI_API_KEY;
      origModel     !== undefined ? (process.env.OPENCLAUDE_MODEL = origModel)            : delete process.env.OPENCLAUDE_MODEL;
    }
  });
});
