import type { Command } from '../../commands.js'

const lsp = {
  type: 'local',
  name: 'lsp',
  description: 'Inspect and set up Language Server Protocol code intelligence',
  argumentHint:
    'status | recommend [path] | install <plugin-id> | uninstall <plugin-id> | restart',
  supportsNonInteractive: false,
  load: () => import('./lsp.js'),
} satisfies Command

export default lsp
