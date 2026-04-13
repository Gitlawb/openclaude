/**
 * /assistant command — configure and toggle assistant mode.
 *
 * Imported by commands.ts:75 when feature('KAIROS').
 */

import React from 'react'
import type { Command } from '../../types/command.js'

/**
 * Stub exports consumed by dialogLaunchers.tsx:74-77 via dynamic import.
 * In the Anthropic-internal build, these provide a daemon install wizard
 * for remote bridge environments. In the open build, assistant mode runs
 * locally — the install wizard is not needed. These stubs prevent a
 * runtime crash when the discovery path reaches sessions.length === 0.
 */
export function NewInstallWizard(props: {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  // Immediately signal cancellation — no install wizard in open build
  React.useEffect(() => { props.onCancel() }, [])
  return null
}

export async function computeDefaultInstallDir(): Promise<string> {
  return process.cwd()
}

const assistant = {
  type: 'local-jsx' as const,
  name: 'assistant',
  description: 'Toggle assistant mode',
  isEnabled: () => true,
  immediate: true,

  load: () =>
    Promise.resolve({
      async call(
        onDone: (result?: string, options?: { display?: string }) => void,
      ) {
        const { isAssistantMode } = require('../../assistant/index.js') as typeof import('../../assistant/index.js')
        const active = isAssistantMode()

        if (active) {
          onDone(
            'Assistant mode is active. To disable, remove "assistant": true from .claude/settings.json and restart.',
            { display: 'system' },
          )
        } else {
          onDone(
            'Assistant mode is inactive. To enable, add "assistant": true to .claude/settings.json and restart.',
            { display: 'system' },
          )
        }
        return null
      },
    }),
} satisfies Command

export default assistant
