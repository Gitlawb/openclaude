import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureServerToken, verifyBearer } from "./auth";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-auth-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("ensureServerToken", () => {
  it("creates 64-char hex token on first call", () => {
    const token = ensureServerToken(home);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const path = join(home, ".openclaude", "server-token");
    expect(readFileSync(path, "utf8")).toBe(token);
  });

  it("reuses existing token on subsequent calls", () => {
    const t1 = ensureServerToken(home);
    const t2 = ensureServerToken(home);
    expect(t1).toBe(t2);
  });

  it("writes token file with mode 0600 on unix", () => {
    if (process.platform === "win32") return;
    ensureServerToken(home);
    const mode = statSync(join(home, ".openclaude", "server-token")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("verifyBearer", () => {
  it("accepts matching token", () => {
    expect(verifyBearer("Bearer abc123", "abc123")).toBe(true);
  });
  it("rejects missing header", () => {
    expect(verifyBearer(undefined, "abc123")).toBe(false);
  });
  it("rejects wrong prefix", () => {
    expect(verifyBearer("Basic abc123", "abc123")).toBe(false);
  });
  it("rejects mismatch", () => {
    expect(verifyBearer("Bearer abc124", "abc123")).toBe(false);
  });
  it("rejects unequal length without leaking timing", () => {
    expect(verifyBearer("Bearer x", "xy")).toBe(false);
    expect(verifyBearer("Bearer xy", "xy")).toBe(true);
  });
});
