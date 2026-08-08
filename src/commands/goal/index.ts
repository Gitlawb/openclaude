import type { Command } from '../../commands.js'

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set and manage a session completion goal',
  argumentHint: '[condition|status|pause|resume|clear]',
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
