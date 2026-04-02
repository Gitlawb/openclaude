import type { Command } from '../../commands.js'

const peersCommand: Command = {
  name: 'peers',
  description: 'Manage peers',
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      async call() {
        return {
          type: 'text',
          value: 'Peers are unavailable in this source snapshot.',
        }
      },
    }
  },
}

export default peersCommand
