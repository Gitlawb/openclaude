import type { Command } from '../../commands.js'

const ctx: Command = {
  type: 'local',
  name: 'ctx',
  description: 'Show context window usage and token breakdown',
  aliases: ['ctx_viz', 'context-viz'],
  supportsNonInteractive: true,
  load: () => import('./ctx-noninteractive.js'),
}

export default ctx
