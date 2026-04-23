import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultRegistry } from "./vaultRegistry";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "oc-vr-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("VaultRegistry", () => {
  it("starts empty", () => {
    expect(new VaultRegistry(home).list()).toEqual([]);
  });

  it("add/list/remove roundtrip", () => {
    const r = new VaultRegistry(home);
    r.add({ name: "Energinova_Hub", path: "/vaults/energinova" });
    r.add({ name: "FinPower", path: "/vaults/finpower" });
    expect(r.list().map(v => v.name)).toEqual(["Energinova_Hub", "FinPower"]);
    r.remove("Energinova_Hub");
    expect(r.list().map(v => v.name)).toEqual(["FinPower"]);
  });

  it("persists across instances", () => {
    new VaultRegistry(home).add({ name: "A", path: "/a" });
    expect(new VaultRegistry(home).list().map(v => v.name)).toEqual(["A"]);
  });

  it("rejects duplicate names", () => {
    const r = new VaultRegistry(home);
    r.add({ name: "A", path: "/a" });
    expect(() => r.add({ name: "A", path: "/b" })).toThrow();
  });
});
