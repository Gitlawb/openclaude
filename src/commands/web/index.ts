import type { Command } from '../../commands.js'

const web: Command = {
  type: 'local-jsx',
  name: 'web',
  description: 'Launch the magnificent OpenClaude Web Console',
  load: () => import('./web.js'),
}

export default web
