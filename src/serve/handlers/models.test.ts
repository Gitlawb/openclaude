import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle | undefined;
let home: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-m-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("/models", () => {
  it("GET returns list + current", async () => {
    const r = await fetch(`${server!.url}/models`, { headers: auth() });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.available)).toBe(true);
  });

  it("POST /models/current writes override", async () => {
    const r = await fetch(`${server!.url}/models/current`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ modelId: "test-model" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.modelId).toBe("test-model");
  });
});
