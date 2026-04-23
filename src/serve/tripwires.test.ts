import { describe, it, expect } from "bun:test";
import { checkBashTripwire, checkFilesystemTripwire } from "./tripwires";

describe("checkBashTripwire", () => {
  it("blocks rm -rf *", () => {
    expect(() => checkBashTripwire("rm -rf *")).toThrow(/tripwire/i);
  });
  it("blocks rm -rf /vault/*", () => {
    expect(() => checkBashTripwire("rm -rf /home/user/vault/*")).toThrow(/tripwire/i);
  });
  it("blocks force push to main", () => {
    expect(() => checkBashTripwire("git push --force origin main")).toThrow(/tripwire/i);
  });
  it("allows git status", () => {
    expect(() => checkBashTripwire("git status")).not.toThrow();
  });
  it("allows ls -la", () => {
    expect(() => checkBashTripwire("ls -la")).not.toThrow();
  });
});

describe("checkFilesystemTripwire", () => {
  it("blocks write to ~/.claude/settings.json", () => {
    expect(() => checkFilesystemTripwire("write", "/home/user/.claude/settings.json")).toThrow(/tripwire/i);
  });
  it("blocks write to .openclaude/permissions.yml", () => {
    expect(() => checkFilesystemTripwire("write", "/vault/.openclaude/permissions.yml")).toThrow(/tripwire/i);
  });
  it("allows write to a normal note", () => {
    expect(() => checkFilesystemTripwire("write", "/vault/FinPower.md")).not.toThrow();
  });
});
