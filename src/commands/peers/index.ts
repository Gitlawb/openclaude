import type { Command } from '../../commands.js'

const peers: Command = {
  type: 'local-jsx',
  name: 'peers',
  description: 'Peer sessions are unavailable in this build.',
  isEnabled: () => false,
  async load() {
    throw new Error('Peer sessions are unavailable in this build.')
  },
}

export default peers
