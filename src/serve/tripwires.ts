import { ServerError, ErrorCode } from "./errors";

const BASH_DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[rf]+\s+)+(\/|\*|~)/i,
  /\bgit\s+push\s+.*(--force|-f)\b.*\b(main|master)\b/i,
  /\bchmod\s+777\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=.+of=\/dev\//i,
  /\bcurl\s+[^|]+\|\s*(sh|bash)/i,
];

const FS_PROTECTED_SUFFIXES: RegExp[] = [
  /\.claude\/settings(\.local)?\.json$/,
  /\.openclaude\/permissions\.yml$/,
  /\.openclaude\/commands\.yml$/,
];

export function checkBashTripwire(command: string): void {
  for (const re of BASH_DENY_PATTERNS) {
    if (re.test(command)) {
      throw new ServerError(ErrorCode.TRIPWIRE_BLOCKED, `bash command blocked by tripwire: ${re.source}`);
    }
  }
}

export function checkFilesystemTripwire(op: "write" | "delete", path: string): void {
  for (const re of FS_PROTECTED_SUFFIXES) {
    if (re.test(path)) {
      throw new ServerError(ErrorCode.TRIPWIRE_BLOCKED, `${op} on ${path} blocked by tripwire`);
    }
  }
}
