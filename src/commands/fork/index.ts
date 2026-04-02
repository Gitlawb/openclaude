import type { Command } from '../../commands.js'

const forkCommand: Command = {
  name: 'fork',
  description: 'Fork into a subagent',
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      async call() {
        return {
          type: 'text',
          value: 'Fork subagents are unavailable in this source snapshot.',
        }
      },
    }
  },
}

export default forkCommand
