import type { Command } from '../../commands.js'

const fork: Command = {
  type: 'local-jsx',
  name: 'fork',
  description: 'Forked subagents are unavailable in this build.',
  isEnabled: () => false,
  async load() {
    throw new Error('Forked subagents are unavailable in this build.')
  },
}

export default fork
