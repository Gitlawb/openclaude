import { describe, it, expect } from "vitest";
import { splitMarkdown, escapeMarkdownV2 } from "../message-handler.js";

describe("splitMarkdown", () => {
  it("returns single chunk for short text", () => {
    expect(splitMarkdown("hello")).toEqual(["hello"]);
  });

  it("splits at paragraph boundary", () => {
    const text = "a".repeat(2000) + "\n\n" + "b".repeat(2000);
    const chunks = splitMarkdown(text, 3800);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toContain("a".repeat(100));
    expect(chunks[1]).toContain("b".repeat(100));
  });

  it("does not split inside code fences", () => {
    const text = "before\n\n```js\n" + "x".repeat(3000) + "\n```\n\nafter";
    const chunks = splitMarkdown(text, 3800);
    // Code block should stay intact or be properly closed/reopened
    for (const chunk of chunks) {
      const fences = chunk.match(/```/g);
      expect(fences!.length % 2).toBe(0); // each chunk has balanced fences
    }
  });

  it("handles empty string", () => {
    expect(splitMarkdown("")).toEqual([""]);
  });
});

describe("escapeMarkdownV2", () => {
  it("escapes special characters", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
    expect(escapeMarkdownV2("a*b")).toBe("a\\*b");
    expect(escapeMarkdownV2("test.code()")).toBe("test\\.code\\(\\)");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeMarkdownV2("hello world")).toBe("hello world");
  });
});
