import { describe, it, expect, beforeAll } from "bun:test";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walk, searchVault, readNote } from "./vaultUtils";

let vault: string;
beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "oc-vault-"));
  mkdirSync(join(vault, "Projects"), { recursive: true });
  writeFileSync(join(vault, "index.md"), "# Index\n[[Projects/Alpha]]");
  writeFileSync(join(vault, "Projects", "Alpha.md"), "# Alpha\nBudget: 100k\nStatus: active");
  writeFileSync(join(vault, "Projects", "Beta.md"), "# Beta\nBudget: 50k\nStatus: planning");
});

describe("walk", () => {
  it("returns all .md files recursively", () => {
    const files = walk(vault);
    expect(files).toHaveLength(3);
    expect(files.every(f => f.endsWith(".md"))).toBe(true);
  });

  it("skips hidden directories", () => {
    const files = walk(vault);
    expect(files.some(f => f.includes(".obsidian"))).toBe(false);
  });
});

describe("searchVault", () => {
  it("returns hits with snippet and line number", () => {
    const hits = searchVault(vault, "budget", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty("snippet");
    expect(hits[0]).toHaveProperty("line");
  });

  it("respects max results", () => {
    const hits = searchVault(vault, "status", 1);
    expect(hits).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const hits = searchVault(vault, "ALPHA", 10);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("readNote", () => {
  it("reads a note by relative path", () => {
    const content = readNote(vault, "index.md");
    expect(content).toContain("# Index");
  });

  it("returns null for non-existent note", () => {
    expect(readNote(vault, "does-not-exist.md")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(readNote(vault, "../../etc/passwd")).toBeNull();
  });

  it("reads nested note", () => {
    const content = readNote(vault, "Projects/Alpha.md");
    expect(content).toContain("Budget: 100k");
  });
});
