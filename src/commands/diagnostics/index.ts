import type { Command } from '../../commands.js'

const diagnostics = {
  type: 'local',
  name: 'diagnostics',
  description: 'Show available LSP diagnostics already captured for this session',
  supportsNonInteractive: true,
  load: () => import('./diagnostics.js'),
} satisfies Command

export default diagnostics
