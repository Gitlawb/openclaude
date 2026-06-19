/**
 * Inert stub for the `claude daemon` supervisor entrypoint.
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `daemonMain` resolves
 * immediately, so `claude daemon` exits without supervising anything. The
 * call site in entrypoints/cli.tsx does not catch errors (`await main()`), so
 * a no-op is preferred over throwing. No import-time side effects.
 */

export async function daemonMain(_args: string[]): Promise<void> {}
