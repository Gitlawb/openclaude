import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServerError, ErrorCode } from "./errors";

export type VaultEntry = { name: string; path: string };

function parse(text: string): VaultEntry[] {
  const out: VaultEntry[] = [];
  let cur: Partial<VaultEntry> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("- name:")) {
      if (cur.name && cur.path) out.push(cur as VaultEntry);
      cur = { name: line.slice(7).trim().replace(/^["']|["']$/g, "") };
    } else if (line.trim().startsWith("path:")) {
      cur.path = line.split("path:")[1]!.trim().replace(/^["']|["']$/g, "");
    }
  }
  if (cur.name && cur.path) out.push(cur as VaultEntry);
  return out;
}

function serialize(entries: VaultEntry[]): string {
  return entries.map(e => `- name: "${e.name}"\n  path: "${e.path}"`).join("\n") + "\n";
}

export class VaultRegistry {
  private path: string;
  private cache: VaultEntry[];

  constructor(home: string) {
    const dir = join(home, ".openclaude");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "vaults.yml");
    this.cache = existsSync(this.path) ? parse(readFileSync(this.path, "utf8")) : [];
  }

  list(): VaultEntry[] { return [...this.cache]; }

  add(entry: VaultEntry): void {
    if (this.cache.some(v => v.name === entry.name)) {
      throw new ServerError(ErrorCode.CONFLICT, `vault named ${entry.name} already exists`);
    }
    this.cache.push(entry);
    this.flush();
  }

  remove(name: string): void {
    this.cache = this.cache.filter(v => v.name !== name);
    this.flush();
  }

  private flush(): void {
    writeFileSync(this.path, serialize(this.cache), "utf8");
  }
}
