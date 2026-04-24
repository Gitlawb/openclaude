import { describe, it, expect } from "bun:test";
import { formatSseEvent } from "./sse";

describe("formatSseEvent", () => {
  it("formats event name + JSON data", () => {
    expect(formatSseEvent("token", { text: "hi" })).toBe('event: token\ndata: {"text":"hi"}\n\n');
  });
  it("JSON escapes newlines so each event is single data line", () => {
    expect(formatSseEvent("token", { text: "a\nb" })).toBe('event: token\ndata: {"text":"a\\nb"}\n\n');
  });
});
