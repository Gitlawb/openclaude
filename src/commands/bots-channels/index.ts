import type { Command } from '../../commands.js'

const botsChannels: Command = {
  type: 'local',
  name: 'channels',
  description: 'Manage bot channels (list|add|remove|config)',
  argumentHint: '[list|add|remove|config|status]',
  supportsNonInteractive: true,
  load: () => import('./channels.js'),
}

export default botsChannels
