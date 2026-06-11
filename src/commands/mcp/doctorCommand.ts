/**
 * MCP doctor CLI subcommand.
 */
import { type Command } from '@commander-js/extra-typings'

export function registerMcpDoctorCommand(mcp: Command): void {
  mcp
    .command('doctor [name]')
    .description(
      'Diagnose MCP configuration, precedence, disabled/pending state, and connection health. ' +
        'Note: unless --config-only is used, stdio servers may be spawned and remote servers may be contacted. ' +
        'Only use this command in directories you trust.',
    )
    .option(
      '-s, --scope <scope>',
      'Restrict config analysis to a specific scope (local, project, user, or enterprise)',
    )
    .option(
      '--config-only',
      'Skip live connection checks and only analyze configuration state',
    )
    .option('--json', 'Output the diagnostics report as JSON')
    .action(
      async (
        name: string | undefined,
        options: {
          scope?: string
          configOnly?: boolean
          json?: boolean
        },
      ) => {
        const { mcpDoctorHandler } = await import('../../cli/handlers/mcp.js')
        await mcpDoctorHandler(name, options)
      },
    )
}
