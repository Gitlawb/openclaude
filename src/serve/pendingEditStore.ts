import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export type PendingEditKind = "write" | "delete" | "rename" | "move";

export type PendingEditInput = {
  file: string;
  vault: string;
  sessionId: string;
  reason: string;
  before: string;
  after: string;
  kind?: PendingEditKind;  // default: "write" if absent
  newFile?: string;        // populated for rename/move
};

export type PendingEdit = PendingEditInput & { id: string; createdAt: number };

export class PendingEditStore {
  private dir: string;
  private cache = new Map<string, PendingEdit>();

  constructor(home: string) {
    this.dir = join(home, ".openclaude", "pending-edits");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      const e = JSON.parse(readFileSync(join(this.dir, f), "utf8")) as PendingEdit;
      this.cache.set(e.id, e);
    }
  }

  create(input: PendingEditInput): PendingEdit {
    const e: PendingEdit = { ...input, id: randomUUID(), createdAt: Date.now() };
    this.cache.set(e.id, e);
    writeFileSync(join(this.dir, `${e.id}.json`), JSON.stringify(e), "utf8");
    return e;
  }

  get(id: string): PendingEdit | undefined { return this.cache.get(id); }

  list(): PendingEdit[] {
    return Array.from(this.cache.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  delete(id: string): void {
    this.cache.delete(id);
    const p = join(this.dir, `${id}.json`);
    if (existsSync(p)) unlinkSync(p);
  }
}
