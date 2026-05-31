import { resolve, isAbsolute } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { BotConfig } from "./types.js";

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env var: ${key}`);
  return val;
}

export function loadConfig(): BotConfig {
  const botToken = env("BOT_TOKEN");
  const allowedUsersRaw = env("ALLOWED_USERS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (allowedUsersRaw.length === 0) {
    throw new Error(
      "ALLOWED_USERS is empty or missing. Refusing to start without an explicit allow-list. " +
      "Set ALLOWED_USERS to a comma-separated list of Telegram user IDs."
    );
  }
  const allowedUsers = allowedUsersRaw;
  const maxSessions = Number(env("MAX_SESSIONS", "10"));
  const sessionTimeout = Number(env("SESSION_TIMEOUT", "30"));
  const workDir = resolve(env("WORK_DIR", "~").replace(/^~/, process.env.HOME ?? "."));
  const dbPath = resolve(env("DB_PATH", "./data/sessions.db"));

  return { botToken, allowedUsers, maxSessions, sessionTimeout, workDir, dbPath };
}

/**
 * Validate and resolve a path for /cd command.
 * Prevents traversal outside the configured work directory.
 */
export function validatePath(target: string, workDir: string): string {
  const resolved = isAbsolute(target) ? resolve(target) : resolve(workDir, target);

  const boundary = workDir.endsWith("/") ? workDir : workDir + "/";
  if (resolved !== workDir && !resolved.startsWith(boundary)) {
    throw new Error(`Path traversal blocked: ${target} is outside work directory`);
  }

  if (!existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  return resolved;
}
