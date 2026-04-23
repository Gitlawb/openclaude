import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle;
let home: string;
let origHome: string | undefined;
let origUser: string | undefined;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-h-"));
  origHome = process.env.HOME;
  origUser = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  await server.stop();
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUser;
  rmSync(home, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("responds 200 without token (public)", async () => {
    const r = await fetch(`${server.url}/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe("ok");
    expect(j.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof j.uptime_ms).toBe("number");
    expect(j.uptime_ms).toBeGreaterThanOrEqual(0);
  });
});
