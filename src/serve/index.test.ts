import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
let origHome: string | undefined;
let origUser: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "oc-idx-"));
  origHome = process.env.HOME;
  origUser = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUser;
  rmSync(home, { recursive: true, force: true });
});

describe("startServer", () => {
  it("binds to 127.0.0.1, issues a 64-char hex token, and closes cleanly", async () => {
    const server = await startServer({ port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.port).toBeGreaterThan(0);
      expect(server.token).toMatch(/^[0-9a-f]{64}$/);

      // Unknown path without auth returns 404 (auth happens after route match)
      // For the liveness check, hit /health which is public.
      const before = await fetch(`${server.url}/health`).then(r => r.status).catch(() => -1);
      expect(before).toBe(200);
    } finally {
      await server.stop();
    }

    const after = await fetch(server.url).then(r => r.status).catch(() => -1);
    expect(after).toBe(-1);
  });
});
