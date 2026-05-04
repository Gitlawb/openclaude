import type { Command } from '../../commands.js'
const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about OpenClaude`,
  argumentHint: '[report]',
  isEnabled: () => false,
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
