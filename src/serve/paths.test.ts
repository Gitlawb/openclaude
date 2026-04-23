import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";
import { resolveInsideVault, isPathInside } from "./paths";

// Use path.resolve() to compute the platform-native vault root so these tests
// pass on Windows, macOS, and Linux. The plan's literal "/vault" strings would
// only match on Unix — the security behavior is platform-agnostic, but string
// equality in assertions requires platform-normalized paths.
const VAULT = resolve("/vault");

describe("resolveInsideVault", () => {
  it("resolves relative path inside vault", () => {
    expect(resolveInsideVault(VAULT, "FinPower.md")).toBe(resolve(VAULT, "FinPower.md"));
  });
  it("normalizes ./ and ..", () => {
    expect(resolveInsideVault(VAULT, "./sub/../FinPower.md")).toBe(resolve(VAULT, "FinPower.md"));
  });
  it("throws on escape via ..", () => {
    expect(() => resolveInsideVault(VAULT, "../secret")).toThrow(/escape/i);
    expect(() => resolveInsideVault(VAULT, "../../etc/passwd")).toThrow(/escape/i);
  });
  it("throws on absolute path outside vault", () => {
    expect(() => resolveInsideVault(VAULT, resolve("/etc/passwd"))).toThrow(/escape/i);
  });
  it("accepts absolute path inside vault", () => {
    const inside = resolve(VAULT, "sub/note.md");
    expect(resolveInsideVault(VAULT, inside)).toBe(inside);
  });
});

describe("isPathInside", () => {
  it("true for nested", () => {
    expect(isPathInside(VAULT, resolve(VAULT, "sub/a.md"))).toBe(true);
  });
  it("false for outside", () => {
    expect(isPathInside(VAULT, resolve("/other/a.md"))).toBe(false);
  });
  it("false for sibling prefix match", () => {
    // "/vaultx" must not match "/vault" — the sep check prevents this.
    expect(isPathInside(VAULT, resolve("/vaultx/a.md"))).toBe(false);
  });
});
