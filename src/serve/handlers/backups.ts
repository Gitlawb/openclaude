import type { Route } from "../http";
import { BackupManager } from "../backup";
import { ServerError, ErrorCode } from "../errors";

function getBm(query: Record<string, string>): BackupManager {
  const vault = query.vault;
  if (!vault) throw new ServerError(ErrorCode.VALIDATION, "vault query param required");
  return new BackupManager(vault);
}

export const backupsRoutes: Route[] = [
  { method: "GET", path: "/backups", handler: async ({ query }) => ({ status: 200, body: getBm(query).list() }) },
  {
    method: "GET", path: "/backups/:id",
    handler: async ({ params, query }) => {
      const bm = getBm(query);
      const e = bm.get(params.id!);
      if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "backup not found");
      return { status: 200, body: e };
    },
  },
  {
    method: "POST", path: "/backups/:id/restore",
    handler: async ({ params, query }) => {
      const bm = getBm(query);
      bm.restore(params.id!);
      return { status: 200, body: { restored: params.id } };
    },
  },
];
