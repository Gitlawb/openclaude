import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vaultToolModules } from "./vaultTools";
import { PendingEditStore } from "../pendingEditStore";
import type { ToolModule } from "./registry";

function findTool(modules: ToolModule[], name: string): ToolModule {
  const m = modules.find(m => m.definition.function.name === name);
  if (!m) throw new Error(`Tool "${name}" not found in registry`);
  return m;
}

let vault: string;
let store: PendingEditStore;

beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "oc-tools-"));
  mkdirSync(join(vault, "Projects"), { recursive: true });
  writeFileSync(join(vault, "index.md"), "# Index\nWelcome to the vault.");
  writeFileSync(join(vault, "Projects/Alpha.md"), "# Alpha\nBudget: 100k");
  store = new PendingEditStore(tmpdir());
});

describe("list_vault", () => {
  it("lists all .md files relative to vault root", async () => {
    const tool = findTool(vaultToolModules({ vault }), "list_vault");
    const result = await tool.run({}, { vault });
    expect(result.ok).toBe(true);
    const files: string[] = JSON.parse(result.content);
    expect(files).toContain("index.md");
    expect(files.some(f => f.includes("Alpha"))).toBe(true);
  });

  it("rejects path traversal subdir", async () => {
    const tool = findTool(vaultToolModules({ vault }), "list_vault");
    const result = await tool.run({ subdir: "../../etc" }, { vault });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("traversal");
  });

  it("returns ok:false for non-existent subdir", async () => {
    const tool = findTool(vaultToolModules({ vault }), "list_vault");
    const result = await tool.run({ subdir: "nonexistent" }, { vault });
    expect(result.ok).toBe(false);
  });
});

describe("read_note", () => {
  it("returns note content", async () => {
    const tool = findTool(vaultToolModules({ vault }), "read_note");
    const result = await tool.run({ path: "index.md" }, { vault });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Welcome to the vault");
  });

  it("returns ok:false for missing note", async () => {
    const tool = findTool(vaultToolModules({ vault }), "read_note");
    const result = await tool.run({ path: "ghost.md" }, { vault });
    expect(result.ok).toBe(false);
  });
});

describe("search_vault", () => {
  it("returns matching lines", async () => {
    const tool = findTool(vaultToolModules({ vault }), "search_vault");
    const result = await tool.run({ query: "Budget" }, { vault });
    expect(result.ok).toBe(true);
    const hits = JSON.parse(result.content);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain("Budget");
  });

  it("returns empty array when no match", async () => {
    const tool = findTool(vaultToolModules({ vault }), "search_vault");
    const result = await tool.run({ query: "ZZZNOMATCH999" }, { vault });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toHaveLength(0);
  });

  it("returns ok:false when query is empty", async () => {
    const tool = findTool(vaultToolModules({ vault }), "search_vault");
    const result = await tool.run({ query: "" }, { vault });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("query is required");
  });
});

describe("write_note", () => {
  it("creates a pending edit and returns pendingEdit payload", async () => {
    const ctx = { vault, pendingEditStore: store, sessionId: "s-test" };
    const tool = findTool(vaultToolModules(ctx), "write_note");
    const result = await tool.run({ path: "NewNote.md", content: "# New\nContent.", reason: "create test" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.pendingEdit).toBeDefined();
    expect(result.pendingEdit!.reason).toBe("create test");
    const stored = store.get(result.pendingEdit!.id);
    expect(stored).toBeDefined();
    expect(stored!.after).toBe("# New\nContent.");
  });

  it("rejects path traversal", async () => {
    const ctx = { vault, pendingEditStore: store, sessionId: "s-trav" };
    const tool = findTool(vaultToolModules(ctx), "write_note");
    const result = await tool.run({ path: "../../evil.md", content: "x", reason: "hack" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("traversal");
  });
});
