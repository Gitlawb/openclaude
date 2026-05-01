import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle | undefined;
let home: string;
let v1: string;
let v2: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-srv-"));
  v1 = mkdtempSync(join(tmpdir(), "v1-"));
  v2 = mkdtempSync(join(tmpdir(), "v2-"));
  mkdirSync(join(v1, "sub"), { recursive: true });
  writeFileSync(join(v1, "sub", "a.md"), "tarifa branca info", "utf8");
  writeFileSync(join(v2, "b.md"), "nothing relevant", "utf8");
  writeFileSync(join(v2, "c.md"), "tarifa azul and tarifa branca", "utf8");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(v1, { recursive: true, force: true });
  rmSync(v2, { recursive: true, force: true });
});

describe("POST /tools/search", () => {
  it("returns matches across multiple vaults", async () => {
    const r = await fetch(`${server!.url}/tools/search`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "tarifa branca", vaults: [v1, v2] }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.results.length).toBeGreaterThanOrEqual(2);
    const paths = j.results.map((x: any) => x.file);
    expect(paths.some((p: string) => p.includes("a.md"))).toBe(true);
    expect(paths.some((p: string) => p.includes("c.md"))).toBe(true);
    expect(paths.every((p: string) => !p.includes("b.md"))).toBe(true);
  });

  it("respects maxResults", async () => {
    const r = await fetch(`${server!.url}/tools/search`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ query: "tarifa", vaults: [v1, v2], maxResults: 1 }),
    });
    const j = await r.json();
    expect(j.results.length).toBe(1);
  });
});
