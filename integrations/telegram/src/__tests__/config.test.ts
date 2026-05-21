import { describe, it, expect } from "vitest";
import { validatePath } from "../config.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-test-"));
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "file.txt"), "test");
  return dir;
}

describe("validatePath", () => {
  it("accepts valid subdirectory", () => {
    const base = makeTmpDir();
    const result = validatePath("sub", base);
    expect(result).toContain("sub");
  });

  it("rejects traversal outside work dir", () => {
    const base = makeTmpDir();
    expect(() => validatePath("../etc", base)).toThrow("traversal");
  });

  it("rejects non-existent path", () => {
    const base = makeTmpDir();
    expect(() => validatePath("nonexistent", base)).toThrow("does not exist");
  });

  it("rejects file (not directory)", () => {
    const base = makeTmpDir();
    expect(() => validatePath("file.txt", base)).toThrow("Not a directory");
  });
});
