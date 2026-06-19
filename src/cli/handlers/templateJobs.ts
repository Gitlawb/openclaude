/**
 * Inert stub for template job commands (`claude new|list|reply`).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `templatesMain` resolves
 * immediately; the call site then runs `process.exit(0)`, so the commands
 * exit quietly. The call site in entrypoints/cli.tsx does not catch errors
 * (`await main()`), so a no-op is preferred over throwing. No import-time
 * side effects.
 */

export async function templatesMain(_args: string[]): Promise<void> {}
