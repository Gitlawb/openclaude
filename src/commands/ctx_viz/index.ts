import type { Command } from '../../commands.js'

const ctx_viz: Command = {
  type: 'local-jsx',
  name: 'ctx',
  description: 'Show context window usage and token breakdown',
  aliases: ['ctx_viz', 'context-viz'],
  load: () => import('./ctx_viz.js'),
}

export default ctx_viz
