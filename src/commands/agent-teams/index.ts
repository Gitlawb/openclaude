import type { Command } from '../../commands.js'

const agentTeams = {
  type: 'local',
  name: 'agent-teams',
  description: 'Toggle agent teams on/off',
  argumentHint: '[on|off]',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./agent-teams.js'),
} satisfies Command

export default agentTeams
