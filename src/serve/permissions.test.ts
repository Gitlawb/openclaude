import { describe, it, expect } from "bun:test";
import { checkPermission, type Preset } from "./permissions";

describe("checkPermission", () => {
  // ── conservative ──────────────────────────────────────────
  describe("conservative preset", () => {
    const p: Preset = "conservative";

    it("allows read tools", () => {
      expect(checkPermission("read_note", {}, p).allowed).toBe(true);
      expect(checkPermission("list_vault", {}, p).allowed).toBe(true);
      expect(checkPermission("search_vault", {}, p).allowed).toBe(true);
    });

    it("blocks write tools (returns allowed:false with reason)", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/conservative/i);
    });

    it("blocks delete tools", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });

    it("allows web search (read-only external)", () => {
      expect(checkPermission("web_search", {}, p).allowed).toBe(true);
      expect(checkPermission("fetch_page", {}, p).allowed).toBe(true);
    });

    it("allows thought tools (no side effects)", () => {
      expect(checkPermission("structure_thought", {}, p).allowed).toBe(true);
      expect(checkPermission("refine_argument", {}, p).allowed).toBe(true);
      expect(checkPermission("counter_argument", {}, p).allowed).toBe(true);
    });
  });

  // ── balanced ─────────────────────────────────────────────
  describe("balanced preset (default)", () => {
    const p: Preset = "balanced";

    it("allows read tools", () => {
      expect(checkPermission("read_note", {}, p).allowed).toBe(true);
    });

    it("allows write (routed through diff-preview — allowed:true, requiresPreview:true)", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(true);
      expect(r.requiresPreview).toBe(true);
    });

    it("blocks delete by default (returns allowed:false so agent must ask user)", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });

    it("allows format tools", () => {
      expect(checkPermission("summarize_notes", {}, p).allowed).toBe(true);
      expect(checkPermission("format_note", {}, p).allowed).toBe(true);
    });
  });

  // ── aggressive ───────────────────────────────────────────
  describe("aggressive preset", () => {
    const p: Preset = "aggressive";

    it("allows write without preview requirement", () => {
      const r = checkPermission("write_note", {}, p);
      expect(r.allowed).toBe(true);
      expect(r.requiresPreview).toBeUndefined();
    });

    it("still blocks delete (returns allowed:false — always ask)", () => {
      expect(checkPermission("delete_note", {}, p).allowed).toBe(false);
    });
  });

  // ── unknown tool ─────────────────────────────────────────
  it("allows unknown tools by default (fail-open for forward compatibility)", () => {
    expect(checkPermission("some_future_tool", {}, "balanced").allowed).toBe(true);
  });
});
