import type { Command } from '../../commands.js'

const diagnostic = {
  type: 'local' as const,
  name: 'diagnostic',
  description: 'Full router state dump for debugging',
  isHidden: false,
  isEnabled: true,
  supportsNonInteractive: true,
  load: () => import('./diagnostic.js'),
} satisfies Command

export default diagnostic
