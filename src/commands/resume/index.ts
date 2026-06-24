import type { Command } from '../../commands.js'

const resume: Command = {
  type: 'local-jsx',
  name: 'resume',
  description: 'Resume a previous conversation',
  argumentHint: '[conversation id or search term]',
  load: () => import('./resume.js'),
}

export const continueCommand: Command = {
  type: 'local-jsx',
  name: 'continue',
  description: 'Continue the current task',
  argumentHint: '[optional instruction]',
  load: async () => {
    const mod = await import('./resume.js')
    return { call: mod.continueCall }
  },
}

export default resume
