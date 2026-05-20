import type { Command } from '../../commands.js'

const workflows: Command = {
  type: 'local-jsx',
  name: 'workflows',
  description: 'Workflow scripts are unavailable in this build.',
  isEnabled: () => false,
  async load() {
    throw new Error('Workflow scripts are unavailable in this build.')
  },
}

export default workflows
