// @ts-nocheck
import { BASE_CHROME_PROMPT } from '../../utils/claudeInChrome/prompt.js'
import { shouldAutoEnableClaudeInChrome } from '../../utils/claudeInChrome/setup.js'
import { registerBundledSkill } from '../bundledSkills.js'

function getClaudeInChromeMcpTools(): string[] {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { BROWSER_TOOLS } = require('@ant/claude-for-chrome-mcp')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return Array.isArray(BROWSER_TOOLS)
      ? BROWSER_TOOLS.map(tool => `mcp__claude-in-chrome__${tool.name}`)
      : []
  } catch {
    return []
  }
}
const SKILL_ACTIVATION_MESSAGE = `
Now that this skill is invoked, you have access to Chrome browser automation tools. You can now use the mcp__claude-in-chrome__* tools to interact with web pages.

IMPORTANT: Start by calling mcp__claude-in-chrome__tabs_context_mcp to get information about the user's current browser tabs.
`

export function registerClaudeInChromeSkill(): void {
  const allowedTools = getClaudeInChromeMcpTools()
  registerBundledSkill({
    name: 'claude-in-chrome',
    description:
      'Automates your Chrome browser to interact with web pages - clicking elements, filling forms, capturing screenshots, reading console logs, and navigating sites. Opens pages in new tabs within your existing Chrome session. Requires site-level permissions before executing (configured in the extension).',
    whenToUse:
      'When the user wants to interact with web pages, automate browser tasks, capture screenshots, read console logs, or perform any browser-based actions. Always invoke BEFORE attempting to use any mcp__claude-in-chrome__* tools.',
    allowedTools,
    userInvocable: true,
    isEnabled: () =>
      shouldAutoEnableClaudeInChrome() && allowedTools.length > 0,
    async getPromptForCommand(args) {
      let prompt = `${BASE_CHROME_PROMPT}\n${SKILL_ACTIVATION_MESSAGE}`
      if (args) {
        prompt += `\n## Task\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
