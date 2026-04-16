import type { Command } from '../../commands.js'

const god = {
  type: 'local',
  name: 'god',
  description:
    'Enable god mode: bypass all permission prompts and persist in .openclaude/settings.local.json',
  aliases: ['yolo'],
  supportsNonInteractive: false,
  load: () => import('./god.js'),
} satisfies Command

export default god
