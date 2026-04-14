/**
 * /proactive command — toggles proactive autonomous mode.
 *
 * Imported by commands.ts:68 when feature('PROACTIVE') || feature('KAIROS').
 */

import type { Command } from '../types/command.js'

const proactive = {
  type: 'local-jsx' as const,
  name: 'proactive',
  description: 'Toggle proactive autonomous mode',
  isEnabled: () => true,
  immediate: true,

  load: () =>
    Promise.resolve({
      async call(
        onDone: (result?: string, options?: { display?: string }) => void,
      ) {
        // Lazy import to avoid circular dependency at module scope
        const { isProactiveActive, activateProactive, deactivateProactive } =
          require('../proactive/index.js') as typeof import('../proactive/index.js')

        if (isProactiveActive()) {
          deactivateProactive()
          onDone('Proactive mode disabled', { display: 'system' })
        } else {
          activateProactive('command')
          onDone('Proactive mode enabled', { display: 'system' })
        }
        return null
      },
    }),
} satisfies Command

export default proactive
