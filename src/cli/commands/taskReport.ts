import {
  Command as CommanderCommand,
  Option,
} from '@commander-js/extra-typings'

import type { TaskReportArgs, TaskReportFormat } from '../../utils/taskReport.js'

export type TaskReportCommandOptions = {
  json?: boolean
  markdown?: boolean
  transcript?: string
  session?: string
  out?: string
}

export type TaskReportCommandDeps = {
  cwd?: () => string
  exit?: (code: number) => void
  taskReportHandler?: (options: TaskReportArgs) => Promise<void>
  printTaskReportError?: (error: unknown) => Promise<void>
}

export function registerTaskReportCommand(
  program: CommanderCommand,
  deps: TaskReportCommandDeps = {},
): void {
  program
    .command('report')
    .description('Generate a deterministic task report for an OpenClaude session')
    .addOption(new Option('--json', 'Print JSON output').conflicts('markdown'))
    .addOption(new Option('--markdown', 'Print Markdown output').conflicts('json'))
    .option('--transcript <file>', 'Path to a session JSONL transcript')
    .option(
      '--session <id>',
      'Session ID to report (defaults to latest session in the current project)',
    )
    .option('--out <file>', 'Write the report to a file')
    .action(async (options: TaskReportCommandOptions) => {
      const exit = deps.exit ?? process.exit
      try {
        const format = resolveTaskReportFormat(options)
        if (options.transcript && options.session) {
          throw new Error(
            'Pass either --transcript <file> or --session <id>, not both.',
          )
        }
        const taskReportHandler =
          deps.taskReportHandler ??
          (await import('../handlers/taskReport.js')).taskReportHandler
        await taskReportHandler({
          format,
          transcriptPath: options.transcript ?? null,
          sessionId: options.session ?? null,
          outFile: options.out ?? null,
          cwd: (deps.cwd ?? process.cwd)(),
        })
        exit(0)
      } catch (error) {
        const printTaskReportError =
          deps.printTaskReportError ??
          (await import('../handlers/taskReport.js')).printTaskReportError
        await printTaskReportError(error)
        exit(1)
      }
    })
}

export function resolveTaskReportFormat(
  options: Pick<TaskReportCommandOptions, 'json' | 'markdown'>,
): TaskReportFormat {
  if (options.json !== true && options.markdown !== true) {
    throw new Error('Pass either --json or --markdown for task report output.')
  }
  return options.json ? 'json' : 'markdown'
}
