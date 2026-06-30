import type { Command } from '../../commands.js'

export default {
  type: 'local',
  name: 'clear-context-window',
  description: 'Clear session-scoped context window overrides',
  argumentHint: '[model]',
  supportsNonInteractive: true,
  load: () => import('./clear-context-window.js'),
} satisfies Command
