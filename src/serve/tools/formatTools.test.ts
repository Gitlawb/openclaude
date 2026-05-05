import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatToolModules } from "./formatTools";
import type { ToolModule } from "./registry";
import { PendingEditStore } from "../pendingEditStore";

function findTool(modules: ToolModule[], name: string): ToolModule {
  const m = modules.find(m => m.definition.function.name === name);
  if (!m) throw new Error(`Tool "${name}" not found`);
  return m;
}

let vault: string;
let store: PendingEditStore;

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "oc-fmt-"));
  writeFileSync(join(vault, "NoteA.md"), "# Project Alpha\nBudget: 100k\nStatus: active");
  writeFileSync(join(vault, "NoteB.md"), "# Project Beta\nBudget: 50k\nStatus: planning");
  writeFileSync(join(vault, "Ref.md"), "# Reference\nThis document discusses Project Alpha and Project Beta in detail.");
  store = new PendingEditStore(tmpdir());
});

describe("formatToolModules", () => {
  it("exports summarize_notes, format_note, suggest_links", () => {
    const modules = formatToolModules({ vault });
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("summarize_notes");
    expect(names).toContain("format_note");
    expect(names).toContain("suggest_links");
  });
});

describe("summarize_notes", () => {
  it("returns ok:false when no paths provided", async () => {
    const ctx = { vault, pendingEditStore: store, sessionId: "s-sum" };
    const tool = findTool(formatToolModules(ctx), "summarize_notes");
    const result = await tool.run({ paths: [], style: "bullet", targetPath: "Summary.md" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when LLM endpoint unreachable", async () => {
    const ctx = { vault, pendingEditStore: store, sessionId: "s-sum2" };
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    try {
      const tool = findTool(formatToolModules(ctx), "summarize_notes");
      const result = await tool.run({ paths: ["NoteA.md"], style: "bullet", targetPath: "Summary.md" }, ctx);
      expect(result.ok).toBe(false);
      expect(result.content).toContain("LLM sub-call failed");
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("creates pending edit when LLM mock responds", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        choices: [{ message: { content: "## Summary\n- Budget: 100k\n- Status: active" } }],
      }),
    });
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const ctx = { vault, pendingEditStore: store, sessionId: "s-sum3" };
      const tool = findTool(formatToolModules(ctx), "summarize_notes");
      const result = await tool.run({ paths: ["NoteA.md"], style: "bullet", targetPath: "Summary.md" }, ctx);
      expect(result.ok).toBe(true);
      expect(result.pendingEdit).toBeDefined();
      const stored = store.get(result.pendingEdit!.id);
      expect(stored!.after).toContain("Summary");
    } finally {
      await server.stop(true);
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

describe("format_note", () => {
  it("returns ok:false when note not found", async () => {
    const ctx = { vault, pendingEditStore: store, sessionId: "s-fmt" };
    const tool = findTool(formatToolModules(ctx), "format_note");
    const result = await tool.run({ path: "ghost.md", instructions: "add YAML" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("creates pending edit when LLM responds", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        choices: [{ message: { content: "---\ntitle: Alpha\n---\n# Project Alpha" } }],
      }),
    });
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const ctx = { vault, pendingEditStore: store, sessionId: "s-fmt2" };
      const tool = findTool(formatToolModules(ctx), "format_note");
      const result = await tool.run({ path: "NoteA.md", instructions: "add YAML frontmatter" }, ctx);
      expect(result.ok).toBe(true);
      expect(result.pendingEdit).toBeDefined();
    } finally {
      await server.stop(true);
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

describe("suggest_links", () => {
  it("returns ok:false when note not found", async () => {
    const ctx = { vault };
    const tool = findTool(formatToolModules(ctx), "suggest_links");
    const result = await tool.run({ path: "ghost.md" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("returns suggestions array for a note that mentions headings without wikilinks", async () => {
    const ctx = { vault };
    const tool = findTool(formatToolModules(ctx), "suggest_links");
    // Ref.md mentions "Project Alpha" and "Project Beta" (headings from NoteA/NoteB) without wikilinks
    const result = await tool.run({ path: "Ref.md" }, ctx);
    expect(result.ok).toBe(true);
    const suggestions = JSON.parse(result.content);
    expect(Array.isArray(suggestions)).toBe(true);
    // Should find at least one suggestion (Alpha or Beta mentioned in Ref.md without [[ ]])
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
