import { describe, it, expect } from "bun:test";
import { buildRegistry } from "./registry";

describe("buildRegistry", () => {
  it("returns empty array when no vault", () => {
    const modules = buildRegistry({});
    expect(modules.length).toBe(0);
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

  it.skip("includes format tools when vault is set (Task 4)", () => {
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
