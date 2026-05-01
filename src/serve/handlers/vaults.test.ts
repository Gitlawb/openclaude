import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle | undefined;
let home: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("/vaults", () => {
  it("register + list + remove", async () => {
    const r = await fetch(`${server!.url}/vaults`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ name: "V1", path: "/some/path" }),
    });
    expect(r.status).toBe(201);
    const list = await (await fetch(`${server!.url}/vaults`, { headers: auth() })).json();
    expect(list.map((v: any) => v.name)).toContain("V1");
    const d = await fetch(`${server!.url}/vaults/V1`, { method: "DELETE", headers: auth() });
    expect(d.status).toBe(204);
  });
});
