import type { Route } from "../http";
import type { PendingEditStore } from "../pendingEditStore";
import { ServerError, ErrorCode } from "../errors";
import {
  writeFileSync, readFileSync, existsSync, mkdirSync, renameSync,
} from "node:fs";
import { dirname, join, basename } from "node:path";
import { checkFilesystemTripwire } from "../tripwires";
import { walk } from "../vaultUtils";

export type PendingEditOpts = {
  createBackup?: (vault: string, file: string) => void;
};

/** Update all [[wikilinks]] in vault from oldBasename → newBasename. O(n) vault scan. */
function updateWikilinks(vault: string, oldBasename: string, newBasename: string): void {
  const oldEsc = oldBasename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[\\[${oldEsc}(\\|[^\\]]+)?\\]\\]`, "g");
  for (const file of walk(vault)) {
    const content = readFileSync(file, "utf8");
    const updated = content.replace(re, (_m, alias) => `[[${newBasename}${alias ?? ""}]]`);
    if (updated !== content) writeFileSync(file, updated, "utf8");
  }
}

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
        const kind = e.kind ?? "write";

        if (kind === "delete") {
          if (!existsSync(e.file)) throw new ServerError(ErrorCode.NOT_FOUND, "file not found");
          const trashDir = join(e.vault, ".trash");
          mkdirSync(trashDir, { recursive: true });
          const trashPath = join(trashDir, `${basename(e.file, ".md")}-${Date.now()}.md`);
          renameSync(e.file, trashPath);
          store.delete(e.id);
          return { status: 200, body: { id: e.id, applied: true, kind: "delete", movedTo: trashPath } };
        }

        if (kind === "rename" || kind === "move") {
          if (!e.newFile) throw new ServerError(ErrorCode.VALIDATION, "newFile required for rename/move");
          if (!existsSync(e.file)) throw new ServerError(ErrorCode.NOT_FOUND, "file not found");
          mkdirSync(dirname(e.newFile), { recursive: true });
          renameSync(e.file, e.newFile);
          const oldBase = basename(e.file, ".md");
          const newBase = basename(e.newFile, ".md");
          updateWikilinks(e.vault, oldBase, newBase);
          store.delete(e.id);
          return { status: 200, body: { id: e.id, applied: true, kind, newFile: e.newFile } };
        }

        // Default: write
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
