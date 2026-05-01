import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle | undefined;
let home: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-c-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("/config", () => {
  it("GET returns defaults", async () => {
    const r = await fetch(`${server!.url}/config`, { headers: auth() });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.permissions.preset).toBe("balanceado");
    expect(j.backup.retentionDays).toBe(30);
  });

  it("POST merges updates", async () => {
    const r = await fetch(`${server!.url}/config`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ permissions: { preset: "agressivo" } }),
    });
    expect(r.status).toBe(200);
    const j = await (await fetch(`${server!.url}/config`, { headers: auth() })).json();
    expect(j.permissions.preset).toBe("agressivo");
  });
});
