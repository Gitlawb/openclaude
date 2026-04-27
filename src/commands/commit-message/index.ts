import type { Command } from '../../commands.js'

const command = {
  type: 'local',
  name: 'commit-message',
  description: 'Configure commit attribution text',
  argumentHint: '[status|off|default|set <text>|co-author <name> <email>]',
  supportsNonInteractive: true,
  load: () => import('./commit-message.js'),
} satisfies Command

export default command
