import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;
let vault: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-mg-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  writeFileSync(join(vault, "MOC.md"), "# MOC\n\n- [[FinPower]]\n- [[PowerSQT]]", "utf8");
  writeFileSync(join(vault, "FinPower.md"), "links to [[PowerSQT]]", "utf8");
  writeFileSync(join(vault, "PowerSQT.md"), "leaf", "utf8");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("POST /tools/mermaid-graph", () => {
  it("returns mermaid source with seed and linked notes", async () => {
    const r = await fetch(`${server.url}/tools/mermaid-graph`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ vault, seedNote: "MOC", depth: 2 }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.mermaid).toMatch(/^graph (LR|TD)/);
    expect(j.mermaid).toContain("MOC");
    expect(j.mermaid).toContain("FinPower");
    expect(j.mermaid).toContain("PowerSQT");
    expect(j.nodeCount).toBeGreaterThanOrEqual(3);
  });

  it("caps at maxNodes", async () => {
    const r = await fetch(`${server.url}/tools/mermaid-graph`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ vault, seedNote: "MOC", depth: 3, maxNodes: 2 }),
    });
    const j = await r.json();
    expect(j.nodeCount).toBeLessThanOrEqual(2);
    expect(j.truncated).toBe(true);
  });
});
