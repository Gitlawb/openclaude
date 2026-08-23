import type { Command } from '../../types/command.js'

const tools = {
  type: 'local-jsx',
  name: 'tools',
  description: 'Manage per-tool modes (always/ask/auto/off)',
  supportsNonInteractive: false,
  load: () => import('./tools.js'),
} satisfies Command

export default tools
