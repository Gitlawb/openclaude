import { describe, it, expect } from "bun:test";
import { startServer } from "./index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("startServer", () => {
  it("returns server info with url, port, token, stop()", async () => {
    const home = mkdtempSync(join(tmpdir(), "oc-s-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const server = await startServer({ port: 0 });
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.port).toBeGreaterThan(0);
      expect(typeof server.token).toBe("string");
      expect(server.token.length).toBe(64);
      await server.stop();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
