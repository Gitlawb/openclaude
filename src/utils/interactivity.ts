import { resolvesHeadlessFlags } from '../mainCliOptions.js';

/**
 * Determines if the current session should be treated as interactive.
 * Robustly handles SSH sessions which might not report TTY status accurately.
 */
export function isInteractiveSession(options: {
  stdoutIsTTY: boolean;
  args: string[];
  env: NodeJS.ProcessEnv;
}): boolean {
  const { stdoutIsTTY, args, env } = options;

  // Explicit non-interactive flags
  // Commander-authoritative, not token scans: `openclaude ssh host -- --print`
  // rewrites argv to a literal `-- --print` POSITIONAL, which is deliberately
  // not headless. Scans classified it non-interactive, so the main action took
  // the headless branch instead of the SSH REPL branch. One parse resolves all
  // three flags, so they agree with each other and with the real parse — and it
  // judges `-pv`, `--sdk-url=x` and `-- --init-only` the same way it will.
  const { print, initOnly, sdkUrl } = resolvesHeadlessFlags(args);

  if (print || initOnly || sdkUrl) {
    return false;
  }

  // Robust interactivity check: consider SSH sessions as interactive even if isTTY is unreliable.
  // Standard SSH environment variable SSH_TTY (path to tty) is only set when a pty is allocated.
  const isSSH = Boolean(env.SSH_TTY);

  return stdoutIsTTY || isSSH;
}
