import { resolve, sep, isAbsolute } from "node:path";
import { ServerError, ErrorCode } from "./errors";

export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p + sep);
}

export function resolveInsideVault(vaultRoot: string, userPath: string): string {
  const abs = isAbsolute(userPath) ? resolve(userPath) : resolve(vaultRoot, userPath);
  if (!isPathInside(vaultRoot, abs)) {
    throw new ServerError(ErrorCode.VALIDATION, `path escapes vault: ${userPath}`);
  }
  return abs;
}
