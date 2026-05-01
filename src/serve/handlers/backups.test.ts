import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupManager } from "../backup";

let server: ServerHandle | undefined;
let home: string;
let vault: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "oc-srv-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("/backups", () => {
  it("list + restore roundtrip", async () => {
    // Create backup BEFORE startServer so it's on disk
    const file = join(vault, "x.md");
    writeFileSync(file, "v1", "utf8");
    const bm = new BackupManager(vault);
    const e = bm.snapshot(file, { reason: "test" });
    writeFileSync(file, "v2", "utf8");

    server = await startServer({ port: 0 });

    const l = await fetch(`${server.url}/backups?vault=${encodeURIComponent(vault)}`, { headers: auth() });
    expect(l.status).toBe(200);
    const arr = await l.json();
    expect(arr.find((x: any) => x.id === e.id)).toBeTruthy();

    const r = await fetch(
      `${server.url}/backups/${e.id}/restore?vault=${encodeURIComponent(vault)}`,
      { method: "POST", headers: auth() }
    );
    expect(r.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("v1");
  });
});
