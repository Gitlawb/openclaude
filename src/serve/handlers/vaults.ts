import type { Route } from "../http";
import { VaultRegistry } from "../vaultRegistry";
import { ServerError, ErrorCode } from "../errors";
import { homedir } from "node:os";

export function vaultsRoutes(): Route[] {
  const reg = () => new VaultRegistry(homedir());
  return [
    { method: "GET", path: "/vaults", handler: async () => ({ status: 200, body: reg().list() }) },
    {
      method: "POST", path: "/vaults",
      handler: async ({ body }) => {
        const b = body as { name?: string; path?: string };
        if (!b?.name || !b?.path) throw new ServerError(ErrorCode.VALIDATION, "name and path required");
        reg().add({ name: b.name, path: b.path });
        return { status: 201, body: { name: b.name, path: b.path } };
      },
    },
    {
      method: "DELETE", path: "/vaults/:name",
      handler: async ({ params }) => {
        reg().remove(params.name!);
        return { status: 204 };
      },
    },
  ];
}
