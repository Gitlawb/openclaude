import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'

const ctx_viz: Command = {
  type: 'local-jsx',
  name: 'ctx',
  description: 'Show context window usage and token breakdown',
  aliases: ['ctx_viz', 'context-viz'],
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./ctx_viz.js'),
}

export const ctxNonInteractive: Command = {
  type: 'local',
  name: 'ctx',
  supportsNonInteractive: true,
  description: 'Show context window usage and token breakdown',
  aliases: ['ctx_viz', 'context-viz'],
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  load: () => import('./ctx-noninteractive.js'),
}

export default ctx_viz
