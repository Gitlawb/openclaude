import type { Command } from '../../commands.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'

const agentTeams = {
  type: 'local',
  name: 'agent-teams',
  description: 'Toggle agent teams on/off',
  argumentHint: '[on|off]',
  isEnabled: () => true,
  load: () => import('./agent-teams.js'),
} satisfies Command

export default agentTeams
