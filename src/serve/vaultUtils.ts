import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

export interface SearchHit {
  file: string;
  vault: string;
  snippet: string;
  line: number;
}

/** Recursively collect all .md files under root (skips hidden dirs/files). */
export function walk(root: string, out: string[] = []): string[] {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Full-text search across all .md files in vault. Returns up to max hits. */
export function searchVault(vault: string, query: string, max: number): SearchHit[] {
  const needle = query.toLowerCase();
  const out: SearchHit[] = [];
  for (const f of walk(vault)) {
    const content = readFileSync(f, "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(needle)) {
        out.push({ file: f, vault, snippet: lines[i]!.slice(0, 200), line: i + 1 });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * Read a note by path relative to the vault root.
 * Returns null if not found or if path tries to escape the vault.
 */
export function readNote(vault: string, relPath: string): string | null {
  try {
    const vaultAbs = resolve(vault);
    const abs = resolve(vaultAbs, relPath);
    // Prevent path traversal
    if (abs !== vaultAbs && !abs.startsWith(vaultAbs + "/") && !abs.startsWith(vaultAbs + "\\")) {
      return null;
    }
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Return a note path relative to the vault root. */
export function vaultRelative(vault: string, abs: string): string {
  return relative(resolve(vault), abs);
}
