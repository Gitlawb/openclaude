import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;
const auth = () => ({ authorization: `Bearer ${server.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-sess-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("/sessions", () => {
  it("list starts empty", async () => {
    const r = await fetch(`${server.url}/sessions`, { headers: auth() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });

  it("roundtrip: create, fetch, delete", async () => {
    const c = await fetch(`${server.url}/sessions`, { method: "POST", headers: auth() });
    expect(c.status).toBe(201);
    const { id } = await c.json();

    const g = await fetch(`${server.url}/sessions/${id}`, { headers: auth() });
    expect(g.status).toBe(200);
    const s = await g.json();
    expect(s.id).toBe(id);
    expect(s.messages).toEqual([]);

    const d = await fetch(`${server.url}/sessions/${id}`, { method: "DELETE", headers: auth() });
    expect(d.status).toBe(204);

    const g2 = await fetch(`${server.url}/sessions/${id}`, { headers: auth() });
    expect(g2.status).toBe(404);
  });
});
