import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PendingEditStore } from "../pendingEditStore";
import { setMockAgent } from "./chat";

let server: ServerHandle | undefined;
let home: string;
let vault: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "oc-pe-"));
  vault = mkdtempSync(join(tmpdir(), "oc-v-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  setMockAgent(async function* () {
    yield { event: "token", data: { text: "mock" } };
    yield { event: "done", data: { finishReason: "stop" } };
  });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe("/pending-edits", () => {
  it("apply writes file on disk and removes entry", async () => {
    // Create entries BEFORE startServer so the server's store reads them from disk
    const store = new PendingEditStore(home);
    const file = join(vault, "note.md");
    writeFileSync(file, "old\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "old\n", after: "new\n" });

    server = await startServer({ port: 0 });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("new\n");

    const list = await (await fetch(`${server.url}/pending-edits`, { headers: auth() })).json();
    expect(list.find((x: any) => x.id === e.id)).toBeUndefined();
  });

  it("reject deletes entry without writing", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "x.md");
    writeFileSync(file, "old\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "old\n", after: "new\n" });

    server = await startServer({ port: 0 });

    const r = await fetch(`${server.url}/pending-edits/${e.id}/reject`, { method: "POST", headers: auth() });
    expect(r.status).toBe(204);
    expect(readFileSync(file, "utf8")).toBe("old\n");
  });

  it("apply rejects with 409 if file changed since edit was queued", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "c.md");
    writeFileSync(file, "v1\n", "utf8");
    const e = store.create({ file, vault, sessionId: "s", reason: "r", before: "v1\n", after: "v3\n" });
    writeFileSync(file, "v2\n", "utf8");

    server = await startServer({ port: 0 });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(409);
  });
});
