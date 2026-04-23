import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync, mkdirSync, chmodSync, openSync, writeSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function ensureServerToken(home = homedir()): string {
  const dir = join(home, ".openclaude");
  const path = join(dir, "server-token");
  mkdirSync(dir, { recursive: true });

  const token = randomBytes(32).toString("hex");
  try {
    // Exclusive create: fails with EEXIST if file already exists.
    // mode 0o600 is set at creation on Unix; chmod is a belt-and-suspenders safeguard.
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    if (process.platform !== "win32") chmodSync(path, 0o600);
    return token;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    // Someone else (or a prior run) wrote the file; read and validate.
    const existing = readFileSync(path, "utf8").trim();
    if (!/^[0-9a-f]{64}$/.test(existing)) {
      throw new Error(`Malformed token at ${path} (expected 64-char hex). Delete the file to regenerate.`);
    }
    return existing;
  }
}

export function verifyBearer(header: string | undefined, expected: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);
  // Hash both sides to fixed-length digests so timingSafeEqual gets equal-length buffers
  // regardless of what the attacker sends. This removes the length side-channel.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
