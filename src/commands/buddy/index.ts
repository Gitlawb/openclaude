import type { Command } from '../../commands.js'

const buddyCommand: Command = {
  name: 'buddy',
  description: 'Interact with buddy mode',
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      async call() {
        return {
          type: 'text',
          value: 'Buddy mode is unavailable in this source snapshot.',
        }
      },
    }
  },
}

export default buddyCommand
