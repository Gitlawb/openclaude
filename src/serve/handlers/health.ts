import type { Route } from "../http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const startedAt = Date.now();

export const healthRoute: Route = {
  method: "GET",
  path: "/health",
  public: true,
  handler: async () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return {
      status: 200,
      body: {
        status: "ok",
        version: pkg.version,
        uptime_ms: Date.now() - startedAt,
      },
    };
  },
};
