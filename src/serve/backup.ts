import { randomUUID, createHash } from "node:crypto";
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync,
} from "node:fs";
import { basename, join } from "node:path";

export type BackupEntry = {
  id: string;
  originalPath: string;
  backupPath: string;
  reason: string;
  sessionId?: string;
  createdAt: number;
};

type IndexFile = { version: 1; entries: BackupEntry[] };

function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40);
}

export class BackupManager {
  private dir: string;
  private indexPath: string;
  private index: IndexFile;

  constructor(vaultRoot: string) {
    this.dir = join(vaultRoot, ".openclaude-backups");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.indexPath = join(this.dir, "index.json");
    this.index = existsSync(this.indexPath)
      ? JSON.parse(readFileSync(this.indexPath, "utf8"))
      : { version: 1, entries: [] };
  }

  snapshot(originalPath: string, opts: { reason: string; sessionId?: string }): BackupEntry {
    if (!existsSync(originalPath)) {
      const id = randomUUID();
      const entry: BackupEntry = {
        id, originalPath, backupPath: "", reason: opts.reason,
        sessionId: opts.sessionId, createdAt: Date.now(),
      };
      this.index.entries.push(entry);
      this.flush();
      return entry;
    }
    const id = randomUUID();
    const content = readFileSync(originalPath, "utf8");
    const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13);
    const fname = `${ts}-${hash}-${slug(basename(originalPath))}`;
    const backupPath = join(this.dir, fname);
    copyFileSync(originalPath, backupPath);
    const entry: BackupEntry = {
      id, originalPath, backupPath,
      reason: opts.reason, sessionId: opts.sessionId,
      createdAt: Date.now(),
    };
    this.index.entries.push(entry);
    this.flush();
    return entry;
  }

  list(): BackupEntry[] {
    return [...this.index.entries].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): BackupEntry | undefined {
    return this.index.entries.find(e => e.id === id);
  }

  restore(id: string): void {
    const e = this.get(id);
    if (!e) throw new Error("backup not found");
    if (!e.backupPath) {
      if (existsSync(e.originalPath)) unlinkSync(e.originalPath);
    } else {
      copyFileSync(e.backupPath, e.originalPath);
    }
    this.index.entries = this.index.entries.filter(x => x.id !== id);
    this.flush();
  }

  pruneOlderThan(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    const toPrune = this.index.entries.filter(e => e.createdAt < cutoff);
    for (const e of toPrune) {
      if (e.backupPath && existsSync(e.backupPath)) unlinkSync(e.backupPath);
    }
    this.index.entries = this.index.entries.filter(e => e.createdAt >= cutoff);
    this.flush();
    return toPrune.length;
  }

  forceTimestamp(id: string, ts: number): void {
    const e = this.get(id);
    if (e) { e.createdAt = ts; this.flush(); }
  }

  private flush(): void {
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), "utf8");
  }
}
