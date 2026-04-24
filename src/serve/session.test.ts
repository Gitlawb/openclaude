import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "./session";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-sm-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("SessionManager", () => {
  it("create returns new session with id", () => {
    const s = new SessionManager(home).create();
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.messages).toEqual([]);
  });

  it("append persists to JSONL", () => {
    const m = new SessionManager(home);
    const s = m.create();
    m.append(s.id, { role: "user", content: "hi", ts: 1 });
    const path = join(home, ".openclaude", "sessions", `${s.id}.jsonl`);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8").trim())).toEqual({ role: "user", content: "hi", ts: 1 });
  });

  it("reload reads persisted messages", () => {
    const m1 = new SessionManager(home);
    const s = m1.create();
    m1.append(s.id, { role: "user", content: "hi", ts: 1 });
    m1.append(s.id, { role: "assistant", content: "hello", ts: 2 });
    const m2 = new SessionManager(home);
    const loaded = m2.get(s.id);
    expect(loaded?.messages.length).toBe(2);
    expect(loaded?.messages[0]?.content).toBe("hi");
  });

  it("list returns all sessions", () => {
    const m = new SessionManager(home);
    m.create(); m.create(); m.create();
    expect(m.list().length).toBe(3);
  });

  it("delete removes file and cache entry", () => {
    const m = new SessionManager(home);
    const s = m.create();
    m.append(s.id, { role: "user", content: "x", ts: 0 });
    m.delete(s.id);
    expect(m.get(s.id)).toBeUndefined();
    expect(existsSync(join(home, ".openclaude", "sessions", `${s.id}.jsonl`))).toBe(false);
  });
});
