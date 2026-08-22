import type { Command } from '../../commands.js'

const steer = {
  type: 'local-jsx',
  name: 'steer',
  description: 'Answer pre-task clarification questions to guide the assistant',
  isEnabled: () => true,
  load: () => import('./steer.js'),
} satisfies Command

export default steer
