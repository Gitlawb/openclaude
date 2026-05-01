import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "./backup";

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "oc-bk-")); });
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe("BackupManager", () => {
  it("creates backup file + index entry", () => {
    const file = join(vault, "note.md");
    writeFileSync(file, "original", "utf8");
    const bm = new BackupManager(vault);
    const entry = bm.snapshot(file, { reason: "test" });
    expect(existsSync(entry.backupPath)).toBe(true);
    expect(readFileSync(entry.backupPath, "utf8")).toBe("original");
    expect(bm.list()).toHaveLength(1);
    expect(bm.list()[0]?.originalPath).toBe(file);
  });

  it("restore writes backup content back", () => {
    const file = join(vault, "a.md");
    writeFileSync(file, "v1", "utf8");
    const bm = new BackupManager(vault);
    const entry = bm.snapshot(file, { reason: "edit" });
    writeFileSync(file, "v2", "utf8");
    bm.restore(entry.id);
    expect(readFileSync(file, "utf8")).toBe("v1");
  });

  it("pruneOlderThan removes expired entries", () => {
    const file = join(vault, "b.md");
    writeFileSync(file, "x", "utf8");
    const bm = new BackupManager(vault);
    const e = bm.snapshot(file, { reason: "r" });
    bm.forceTimestamp(e.id, Date.now() - 40 * 86_400_000);
    const pruned = bm.pruneOlderThan(30);
    expect(pruned).toBe(1);
    expect(bm.list()).toHaveLength(0);
  });
});
