import type { Command } from '../../commands.js'

const agentGateway = {
  type: 'local-jsx',
  name: 'agent-gateway',
  aliases: ['gateway'],
  description: 'Configure provider, Telegram, OpenAI-compatible agent API, Open WebUI, cron, and Ouroboros',
  load: () => import('./agent-gateway.js'),
} satisfies Command

export default agentGateway
