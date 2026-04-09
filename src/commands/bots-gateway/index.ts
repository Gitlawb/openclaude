import type { Command } from '../../commands.js'

const botsGateway: Command = {
  type: 'local',
  name: 'bots',
  description: 'Manage Discord/Telegram bot gateway',
  argumentHint: '[start|stop|status]',
  aliases: ['gateway'],
  supportsNonInteractive: true,
  load: () => import('./bots.js'),
}

export default botsGateway
