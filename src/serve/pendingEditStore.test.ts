import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingEditStore } from "./pendingEditStore";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-pe-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("PendingEditStore", () => {
  it("create/get/list/delete", () => {
    const s = new PendingEditStore(home);
    const e = s.create({ file: "/v/a.md", vault: "/v", sessionId: "x", reason: "r", before: "a", after: "ab" });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.get(e.id)?.file).toBe("/v/a.md");
    expect(s.list().length).toBe(1);
    s.delete(e.id);
    expect(s.get(e.id)).toBeUndefined();
  });

  it("persists across instances", () => {
    const s1 = new PendingEditStore(home);
    const e = s1.create({ file: "/a", vault: "/v", sessionId: "x", reason: "r", before: "a", after: "b" });
    const s2 = new PendingEditStore(home);
    expect(s2.get(e.id)?.file).toBe("/a");
  });

  it("list sorts by createdAt descending", () => {
    const s = new PendingEditStore(home);
    const e1 = s.create({ file: "/a", vault: "/v", sessionId: "x", reason: "r", before: "a", after: "b" });
    // Busy-wait to ensure different timestamps (Date.now resolution)
    const start = Date.now(); while (Date.now() === start) {}
    const e2 = s.create({ file: "/b", vault: "/v", sessionId: "x", reason: "r", before: "c", after: "d" });
    const list = s.list();
    expect(list.length).toBe(2);
    // Most recent first
    expect(list[0]!.id).toBe(e2.id);
    expect(list[1]!.id).toBe(e1.id);
  });
});
