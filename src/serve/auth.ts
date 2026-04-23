import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function ensureServerToken(home = homedir()): string {
  const dir = join(home, ".openclaude");
  const path = join(dir, "server-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { encoding: "utf8" });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return token;
}

export function verifyBearer(header: string | undefined, expected: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
