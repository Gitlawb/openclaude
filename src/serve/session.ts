import { randomUUID } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync,
  appendFileSync, readdirSync, statSync,
} from "node:fs";
import { join } from "node:path";

export type Message = {
  role: "user" | "assistant" | "tool";
  content: string;
  ts: number;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
};

export type Session = {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export class SessionManager {
  private dir: string;
  private cache = new Map<string, Session>();

  constructor(home: string) {
    this.dir = join(home, ".openclaude", "sessions");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const id = f.slice(0, -6);
      const raw = readFileSync(join(this.dir, f), "utf8");
      const messages = raw.split("\n").filter(Boolean).map(l => JSON.parse(l) as Message);
      const st = statSync(join(this.dir, f));
      this.cache.set(id, {
        id,
        createdAt: st.birthtimeMs || st.ctimeMs,
        updatedAt: st.mtimeMs,
        messages,
      });
    }
  }

  create(): Session {
    const id = randomUUID();
    const now = Date.now();
    const s: Session = { id, createdAt: now, updatedAt: now, messages: [] };
    this.cache.set(id, s);
    writeFileSync(join(this.dir, `${id}.jsonl`), "", "utf8");
    return s;
  }

  get(id: string): Session | undefined { return this.cache.get(id); }

  append(id: string, msg: Message): void {
    const s = this.cache.get(id);
    if (!s) throw new Error(`session not found: ${id}`);
    s.messages.push(msg);
    s.updatedAt = Date.now();
    appendFileSync(join(this.dir, `${id}.jsonl`), JSON.stringify(msg) + "\n", "utf8");
  }

  list(): Array<{ id: string; createdAt: number; updatedAt: number; messageCount: number }> {
    return Array.from(this.cache.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(s => ({ id: s.id, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length }));
  }

  delete(id: string): void {
    this.cache.delete(id);
    const p = join(this.dir, `${id}.jsonl`);
    if (existsSync(p)) unlinkSync(p);
  }
}
