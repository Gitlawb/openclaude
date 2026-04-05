import type { Command } from '../../commands.js'

const provider = {
  type: 'local-jsx',
  name: 'provider',
  description: 'Manage API provider profiles',
  load: () => import('./provider.js'),
} satisfies Command

export default provider
