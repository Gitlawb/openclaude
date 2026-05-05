import type { Route } from "../http";
import type { PendingEditStore } from "../pendingEditStore";
import { ServerError, ErrorCode } from "../errors";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { checkFilesystemTripwire } from "../tripwires";

export type PendingEditOpts = {
  createBackup?: (vault: string, file: string) => void;
};

export function pendingEditsRoutes(store: PendingEditStore, opts: PendingEditOpts = {}): Route[] {
  const createBackup = opts.createBackup ?? (() => {});
  return [
    { method: "GET", path: "/pending-edits", handler: async () => ({ status: 200, body: store.list() }) },
    {
      method: "POST", path: "/pending-edits/:id/apply",
      handler: async ({ params }) => {
        const e = store.get(params.id!);
        if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "pending edit not found");
        checkFilesystemTripwire("write", e.file);
        if (existsSync(e.file)) {
          const current = readFileSync(e.file, "utf8");
          if (current !== e.before) {
            throw new ServerError(ErrorCode.CONFLICT, "file changed since pending edit was created");
          }
        }
        createBackup(e.vault, e.file);
        mkdirSync(dirname(e.file), { recursive: true });
        writeFileSync(e.file, e.after, "utf8");
        store.delete(e.id);
        return { status: 200, body: { id: e.id, applied: true } };
      },
    },
    {
      method: "POST", path: "/pending-edits/:id/reject",
      handler: async ({ params }) => {
        const e = store.get(params.id!);
        if (!e) throw new ServerError(ErrorCode.NOT_FOUND, "pending edit not found");
        store.delete(e.id);
        return { status: 204 };
      },
    },
  ];
}
