import type { Command } from '../../commands.js'

const steer = {
  type: 'local-jsx',
  name: 'steer',
  description: 'Re-align an off-track task by answering steering questions',
  isEnabled: () => true,
  load: () => import('./steer.js'),
} satisfies Command

export default steer
