import { describe, it, expect } from "bun:test";

const THOUGHT_TOOLS = new Set(["structure_thought", "refine_argument", "counter_argument"]);

function isThoughtTool(name: string): boolean {
  return THOUGHT_TOOLS.has(name);
}

describe("isThoughtTool", () => {
  it("identifies thought tools correctly", () => {
    expect(isThoughtTool("structure_thought")).toBe(true);
    expect(isThoughtTool("refine_argument")).toBe(true);
    expect(isThoughtTool("counter_argument")).toBe(true);
  });

  it("does not classify other tools as thought tools", () => {
    expect(isThoughtTool("web_search")).toBe(false);
    expect(isThoughtTool("write_note")).toBe(false);
    expect(isThoughtTool("list_vault")).toBe(false);
  });
});
