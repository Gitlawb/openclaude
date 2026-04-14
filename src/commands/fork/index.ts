/**
 * /fork <directive> — fork a background worker with full context inheritance.
 *
 * Delegates to the Agent tool's implicit fork path (forkSubagent.ts).
 * The worker inherits the parent's conversation context, system prompt,
 * and tool pool for prompt cache optimization.
 */

import type { Command } from '../../types/command.js'

const fork = {
  type: 'prompt' as const,
  name: 'fork',
  description: 'Fork a background worker with a directive',
  isEnabled: () => true,
  isHidden: false,
  progressMessage: 'Forking worker...',
  argDescription: '<directive>',
  getPromptForCommand: (args: string) => [
    {
      type: 'text' as const,
      text: `Use the Agent tool to spawn a background worker with this directive: ${args}. Do NOT specify subagent_type — let the system auto-fork with full context inheritance.`,
    },
  ],
  userFacingName: () => 'fork',
} satisfies Command

export default fork
