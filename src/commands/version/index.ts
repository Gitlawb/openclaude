import type { Command } from '../../commands.js'

const version = {
  type: 'local' as const,
  name: 'version',
  description: 'Show openclaude and Foundation Router version',
  isHidden: false,
  isEnabled: true,
  supportsNonInteractive: true,
  load: () => import('./version.js'),
} satisfies Command

export default version
