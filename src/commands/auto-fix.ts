import type { Command } from '../types/command.js'

const command: Command = {
  name: 'auto-fix',
  description: 'Configure auto-fix: run lint/test after AI edits',
  isEnabled: () => true,
  type: 'prompt',
  progressMessage: 'Configuring auto-fix...',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand() {
    return [
      {
        type: 'text',
        text:
          'The user wants to configure auto-fix settings. Auto-fix automatically runs lint and test commands after AI file edits, feeding errors back for self-repair.\n\n' +
          'Current settings location: `.nnc/settings.json` or `.nnc/settings.local.json`\n\n' +
          'Example configuration:\n```json\n{\n  "autoFix": {\n    "enabled": true,\n    "lint": "eslint . --fix",\n    "test": "bun test",\n    "maxRetries": 3,\n    "timeout": 30000\n  }\n}\n```\n\n' +
          'Ask the user what lint and test commands they use, then help them set up the configuration.',
      },
    ]
  },
}

export default command
