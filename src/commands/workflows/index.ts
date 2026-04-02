import type { Command } from '../../commands.js'

const workflowsCommand: Command = {
  name: 'workflows',
  description: 'Manage workflows',
  type: 'local',
  supportsNonInteractive: false,
  async load() {
    return {
      async call() {
        return {
          type: 'text',
          value: 'Workflow scripts are unavailable in this source snapshot.',
        }
      },
    }
  },
}

export default workflowsCommand
