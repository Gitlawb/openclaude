import type { Route } from "../http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();

// Walk up from this module's directory to find the nearest package.json.
// Source layout: src/serve/handlers → 3 levels up. Bundled layout: dist/cli.mjs → 1 level up.
// A fixed relative path would work in one layout and break in the other.
function findPackageJson(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`package.json not found walking up from ${startDir}`);
}

const PKG_PATH = findPackageJson(dirname(fileURLToPath(import.meta.url)));
const PKG: { version: string } = JSON.parse(readFileSync(PKG_PATH, "utf8"));

export const healthRoute: Route = {
  method: "GET",
  path: "/health",
  public: true,
  handler: async () => ({
    status: 200,
    body: {
      status: "ok",
      version: PKG.version,
      uptime_ms: Date.now() - startedAt,
    },
  }),
};
