import type { Route } from "../http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();

// Read package.json once at module load so a bad/missing package.json fails fast at startup
// rather than returning 500 on first health poll.
// Path assumes __dirname = <repo>/src/serve/handlers; `../../../` resolves to repo root.
const PKG_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
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
