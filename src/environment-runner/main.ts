/**
 * Inert stub for the headless BYOC environment runner
 * (`claude environment-runner`).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `environmentRunnerMain`
 * resolves immediately, so the command exits without registering or polling.
 * The call site in entrypoints/cli.tsx does not catch errors
 * (`await main()`), so a no-op is preferred over throwing. No import-time
 * side effects.
 */

export async function environmentRunnerMain(_args: string[]): Promise<void> {}
