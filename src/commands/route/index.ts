import type { Command } from '../../commands.js'

const route = {
  type: 'local',
  name: 'route',
  description:
    'Show autonomy routing: last decisions, task tiers, provider health',
  supportsNonInteractive: true,
  load: () => import('./route.js'),
} satisfies Command

export default route
