import type { Command } from '../../commands.js'

const docs = {
  type: 'local' as const,
  name: 'docs',
  description: 'Manage doc cache: /docs, /docs list, /docs clear, /docs stack',
  isHidden: false,
  isEnabled: true,
  supportsNonInteractive: true,
  argumentHint: '[list|clear|stack|<lib>]',
  load: () => import('./docs.js'),
} satisfies Command

export default docs

