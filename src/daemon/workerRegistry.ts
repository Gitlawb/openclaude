/**
 * Inert stub for the daemon worker registry (`--daemon-worker=<kind>`).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `runDaemonWorker` resolves
 * immediately so a spawned worker process exits cleanly (code 0). The call
 * site in entrypoints/cli.tsx does not catch errors (`void main()`), so a
 * no-op is preferred over throwing. No import-time side effects.
 */

export async function runDaemonWorker(
  _kind: string | undefined,
): Promise<void> {}
