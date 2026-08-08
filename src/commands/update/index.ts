import type { Command } from '../../types/command.js'

const update = {
  type: 'local-jsx',
  name: 'update',
  description: 'Update OpenClaude to the latest version',
  argumentHint: '[latest|stable|<version>] [--force]',
  load: () => import('./update.js'),
} satisfies Command

export default update
