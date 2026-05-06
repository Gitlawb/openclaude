import { describe, it, expect } from "bun:test";
import { callLLM } from "./llmUtils";

describe("callLLM", () => {
  it("returns LLM response text", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        choices: [{ message: { content: "test response" } }],
      }),
    });
    const origUrl = process.env.OPENAI_BASE_URL;
    const origKey = process.env.OPENAI_API_KEY;
    const origModel = process.env.OPENCLAUDE_MODEL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const result = await callLLM("hello");
      expect(result).toBe("test response");
    } finally {
      await server.stop(true);
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl; else delete process.env.OPENAI_BASE_URL;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; else delete process.env.OPENAI_API_KEY;
      if (origModel !== undefined) process.env.OPENCLAUDE_MODEL = origModel; else delete process.env.OPENCLAUDE_MODEL;
    }
  });

  it("throws when endpoint is unreachable", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    process.env.OPENAI_API_KEY = "test";
    try {
      await expect(callLLM("hello")).rejects.toThrow();
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl; else delete process.env.OPENAI_BASE_URL;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; else delete process.env.OPENAI_API_KEY;
    }
  });
});
