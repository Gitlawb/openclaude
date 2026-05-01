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

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createRealAgent } from "./agentAdapter";
import type { AgentEvent } from "./handlers/chat";

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
