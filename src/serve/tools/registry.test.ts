import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { buildRegistry } from "./registry";
import type { ToolContext } from "./registry";

const BASE_CTX: ToolContext = {
  vault: "/fake-vault",
  braveApiKey: undefined,
  pendingEditStore: undefined,
  sessionId: "test",
};

describe("buildRegistry", () => {
  it("returns empty when no vault, braveApiKey, OPENAI_API_KEY, or OPENAI_BASE_URL", () => {
    const prevKey  = process.env.OPENAI_API_KEY;
    const prevBase = process.env.OPENAI_BASE_URL;
    const prevOld  = process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CLAUDE_CODE_USE_OPENAI;
    try {
      const modules = buildRegistry({});
      expect(modules.length).toBe(0);
    } finally {
      if (prevKey  !== undefined) process.env.OPENAI_API_KEY  = prevKey;  else delete process.env.OPENAI_API_KEY;
      if (prevBase !== undefined) process.env.OPENAI_BASE_URL = prevBase; else delete process.env.OPENAI_BASE_URL;
      if (prevOld  !== undefined) process.env.CLAUDE_CODE_USE_OPENAI = prevOld; else delete process.env.CLAUDE_CODE_USE_OPENAI;
    }
  });

  it("includes thought tools when OPENAI_API_KEY is set", () => {
    const prevKey  = process.env.OPENAI_API_KEY;
    const prevBase = process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      const modules = buildRegistry({});
      const names = modules.map(m => m.definition.function.name);
      expect(names).toContain("structure_thought");
      expect(names).toContain("refine_argument");
      expect(names).toContain("counter_argument");
      expect(modules.length).toBe(3);
    } finally {
      if (prevKey  !== undefined) process.env.OPENAI_API_KEY  = prevKey;  else delete process.env.OPENAI_API_KEY;
      if (prevBase !== undefined) process.env.OPENAI_BASE_URL = prevBase; else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("includes vault tools when vault is set", () => {
    const modules = buildRegistry({ vault: "/tmp/v" });
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("list_vault");
    expect(names).toContain("read_note");
    expect(names).toContain("search_vault");
    expect(names).toContain("write_note");
  });

  it("does NOT include web tools when braveApiKey is absent", () => {
    const modules = buildRegistry({ vault: "/tmp/v" });
    const names = modules.map(m => m.definition.function.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("fetch_page");
  });

  it("includes web tools when braveApiKey is set (Task 3)", () => {
    const modules = buildRegistry({ vault: "/tmp/v", braveApiKey: "BSA_KEY" });
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("web_search");
    expect(names).toContain("fetch_page");
  });

  it("includes format tools when vault is set (Task 4)", () => {
    const modules = buildRegistry({ vault: "/tmp/v" });
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("summarize_notes");
    expect(names).toContain("format_note");
    expect(names).toContain("suggest_links");
  });

  it("each module has a definition and a run function", () => {
    const modules = buildRegistry({ vault: "/tmp/v" });
    for (const mod of modules) {
      expect(mod).toHaveProperty("definition");
      expect(mod).toHaveProperty("run");
      expect(typeof mod.run).toBe("function");
    }
  });
});

describe("buildRegistry — thought tools availability", () => {
  let savedBase: string | undefined;
  let savedKey: string | undefined;
  let savedOld: string | undefined;

  beforeEach(() => {
    savedBase = process.env.OPENAI_BASE_URL;
    savedKey  = process.env.OPENAI_API_KEY;
    savedOld  = process.env.CLAUDE_CODE_USE_OPENAI;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLAUDE_CODE_USE_OPENAI;
  });

  afterEach(() => {
    if (savedBase !== undefined) process.env.OPENAI_BASE_URL = savedBase; else delete process.env.OPENAI_BASE_URL;
    if (savedKey  !== undefined) process.env.OPENAI_API_KEY  = savedKey;  else delete process.env.OPENAI_API_KEY;
    if (savedOld  !== undefined) process.env.CLAUDE_CODE_USE_OPENAI = savedOld; else delete process.env.CLAUDE_CODE_USE_OPENAI;
  });

  it("includes thought tools when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "ollama";
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("structure_thought");
    expect(names).toContain("refine_argument");
    expect(names).toContain("counter_argument");
  });

  it("includes thought tools when OPENAI_BASE_URL is set (Ollama without key)", () => {
    process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("structure_thought");
  });

  it("excludes thought tools when neither OPENAI_API_KEY nor OPENAI_BASE_URL are set", () => {
    const modules = buildRegistry(BASE_CTX);
    const names = modules.map(m => m.definition.function.name);
    expect(names).not.toContain("structure_thought");
    expect(names).not.toContain("refine_argument");
    expect(names).not.toContain("counter_argument");
  });
});
