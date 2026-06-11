/**
 * Inert stub for the self-hosted runner entrypoint
 * (`claude self-hosted-runner`), which targets the
 * SelfHostedRunnerWorkerService API (register + poll).
 *
 * The bundler noop-stubs this specifier in current builds; this module
 * mirrors that behavior for the typechecker. `selfHostedRunnerMain` resolves
 * immediately, so the command exits without registering or polling. The call
 * site in entrypoints/cli.tsx does not catch errors (`void main()`), so a
 * no-op is preferred over throwing. No import-time side effects.
 */

export async function selfHostedRunnerMain(_args: string[]): Promise<void> {}
