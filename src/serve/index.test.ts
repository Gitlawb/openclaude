import { describe, it, expect } from "bun:test";
import { startServer } from "./index";

describe("startServer", () => {
  it("binds to 127.0.0.1, issues a 64-char hex token, and closes cleanly", async () => {
    const server = await startServer({ port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.port).toBeGreaterThan(0);
      expect(server.token).toMatch(/^[0-9a-f]{64}$/);

      // verify server is accepting connections before stop
      const before = await fetch(server.url).then(r => r.status).catch(() => -1);
      expect(before).toBe(501);
    } finally {
      await server.stop();
    }

    // verify server rejects connections after stop
    const after = await fetch(server.url).then(r => r.status).catch(() => -1);
    expect(after).toBe(-1);
  });
});
