/**
 * /update slash command — triggers the CLI self-update flow.
 * Delegates to the existing `openclaude update` CLI subcommand via child process.
 */
import { spawn } from 'child_process'
import type {
  Command,
  LocalCommandCall,
  LocalCommandResult,
} from '../../types/command.js'
import { isInBundledMode } from '../../utils/bundledMode.js'

const update = {
  type: 'local',
  name: 'update',
  description: 'Check for updates and install the latest version',
  aliases: ['self-update'],
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call: call as LocalCommandCall }),
} satisfies Command

export function resolveUpdateCommand(): { command: string; args: string[] } {
  if (isInBundledMode() || !process.argv[1]) {
    return { command: process.execPath || 'openclaude', args: ['update'] }
  }

  return { command: process.execPath, args: [process.argv[1], 'update'] }
}

async function call(
  _args: string,
  _context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  return new Promise((resolve) => {
    const { command, args } = resolveUpdateCommand()
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
    })

    child.on('close', (code) => {
      resolve(
        code === 0
          ? { type: 'skip' }
          : { type: 'text', value: `Update exited with code ${code}.` },
      )
    })

    child.on('error', (err) => {
      resolve({ type: 'text', value: `Failed to run update: ${err.message}` })
    })
  })
}

export default update