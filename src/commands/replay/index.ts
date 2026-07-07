import type { Command } from '../../commands.js'

const replay: Command = {
  type: 'local-jsx',
  name: 'replay',
  description: 'Replay a session showing tool execution timeline',
  argumentHint: '[session id or search term]',
  load: () => import('./replay.js'),
}

export default replay
