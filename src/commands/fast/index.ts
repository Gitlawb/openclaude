import type { Command } from '../../commands.js'
import { isFastModeToggleEnabled } from '../../utils/providerFastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return 'Toggle fast mode'
  },
  availability: ['claude-ai', 'console'],
  isEnabled: () => isFastModeToggleEnabled(),
  get isHidden() {
    return !isFastModeToggleEnabled()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
