import type { Command } from '../../commands.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'

export const requestSize = {
  type: 'local-jsx',
  name: 'request-size',
  description: 'Show estimated request context load and top contributors',
  isEnabled: () => !getIsNonInteractiveSession(),
  load: () => import('./request-size.js'),
} satisfies Command

export const requestSizeNonInteractive = {
  type: 'local',
  name: 'request-size',
  description: 'Show estimated request context load and top contributors',
  supportsNonInteractive: true,
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled: () => getIsNonInteractiveSession(),
  load: () => import('./request-size-noninteractive.js'),
} satisfies Command

export default requestSize
