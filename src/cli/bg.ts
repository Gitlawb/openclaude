/**
 * Inert stub for background-session management
 * (`claude ps|logs|attach|kill` and `--bg`/`--background`).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. Every handler resolves
 * immediately without touching the ~/.claude/sessions/ registry, so the
 * commands exit quietly — the same observable behavior as the `() => null`
 * bundler stubs. The call site in entrypoints/cli.tsx does not catch errors
 * (`void main()`), so no-ops are preferred over throwing. No import-time
 * side effects.
 */

/** `claude ps [...]` — list background sessions. Stub: no registry, no output. */
export async function psHandler(_args: string[]): Promise<void> {}

/** `claude logs <id>` — tail a session log. Stub: no-op. */
export async function logsHandler(_sessionId: string | undefined): Promise<void> {}

/** `claude attach <id>` — attach to a session. Stub: no-op. */
export async function attachHandler(_sessionId: string | undefined): Promise<void> {}

/** `claude kill <id>` — terminate a session. Stub: no-op. */
export async function killHandler(_sessionId: string | undefined): Promise<void> {}

/** `claude --bg/--background ...` — spawn a detached session. Stub: no-op. */
export async function handleBgFlag(_args: string[]): Promise<void> {}
