import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

describe("/pending-edits delete/rename/move kinds", () => {
  it("apply with kind=delete moves file to .trash/", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "ToDelete.md");
    writeFileSync(file, "# trash me\n", "utf8");
    const e = store.create({
      file, vault, sessionId: "s", reason: "cleanup",
      before: "# trash me\n", after: "", kind: "delete",
    });

    server = await startServer({ port: 0 });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(200);
    const body = await a.json() as any;
    expect(body.kind).toBe("delete");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(body.movedTo)).toBe(true);
  });

  it("apply with kind=rename moves file and updates wikilinks", async () => {
    const store = new PendingEditStore(home);
    const file = join(vault, "OldName.md");
    const newFile = join(vault, "NewName.md");
    const linker = join(vault, "Linker.md");
    writeFileSync(file, "# Old\n", "utf8");
    writeFileSync(linker, "See [[OldName]] for details.\n", "utf8");
    const e = store.create({
      file, vault, sessionId: "s", reason: "rename",
      before: "# Old\n", after: "# Old\n", kind: "rename", newFile,
    });

    server = await startServer({ port: 0 });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(200);
    const body = await a.json() as any;
    expect(body.kind).toBe("rename");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
    expect(readFileSync(linker, "utf8")).toContain("[[NewName]]");
  });

  it("apply with kind=move moves file to target directory", async () => {
    const store = new PendingEditStore(home);
    const archiveDir = join(vault, "Archive");
    mkdirSync(archiveDir, { recursive: true });
    const file = join(vault, "Note.md");
    const newFile = join(archiveDir, "Note.md");
    writeFileSync(file, "# Note\n", "utf8");
    const e = store.create({
      file, vault, sessionId: "s", reason: "archive",
      before: "# Note\n", after: "# Note\n", kind: "move", newFile,
    });

    server = await startServer({ port: 0 });

    const a = await fetch(`${server.url}/pending-edits/${e.id}/apply`, { method: "POST", headers: auth() });
    expect(a.status).toBe(200);
    const body = await a.json() as any;
    expect(body.kind).toBe("move");
    expect(existsSync(file)).toBe(false);
    expect(existsSync(newFile)).toBe(true);
  });
});
