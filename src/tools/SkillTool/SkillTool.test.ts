import { describe, expect, test } from 'bun:test'

import type { Command } from '../../commands.js'
import { SkillTool } from './SkillTool.js'
import { renderToolUseMessage } from './UI.js'

function createPromptCommand(
  name: string,
  options: {
    source?: 'builtin' | 'plugin' | 'mcp' | 'bundled'
    loadedFrom?: Command['loadedFrom']
  } = {},
): Command {
  return {
    type: 'prompt',
    name,
    description: `${name} description`,
    progressMessage: `${name} progress`,
    contentLength: 0,
    source: options.source ?? 'builtin',
    loadedFrom: options.loadedFrom,
    async getPromptForCommand() {
      return []
    },
  }
}

describe('SkillTool missing parameter handling', () => {
  test('missing skill stays required at the schema level', async () => {
    const parsed = SkillTool.inputSchema.safeParse({})

    expect(parsed.success).toBe(false)
  })

  test('validateInput still returns an actionable error when called with missing skill', async () => {
    const result = await SkillTool.validateInput?.({} as never, {
      options: { tools: [] },
      messages: [],
    } as never)

    expect(result).toEqual({
      result: false,
      message:
        'Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
      errorCode: 1,
    })
  })

  test('valid skill input still parses and validates', async () => {
    const parsed = SkillTool.inputSchema.safeParse({ skill: 'commit' })

    expect(parsed.success).toBe(true)
  })
})

describe('SkillTool renderToolUseMessage', () => {
  test('plugin skills render correctly without plugin command metadata', () => {
    const pluginSkillName = 'plugin:review-pr'

    expect(
      renderToolUseMessage(
        { skill: pluginSkillName },
        {
          commands: [],
        },
      ),
    ).toBe(pluginSkillName)

    expect(
      renderToolUseMessage(
        { skill: pluginSkillName },
        {
          commands: [
            createPromptCommand(pluginSkillName, {
              source: 'plugin',
              loadedFrom: 'plugin',
            }),
          ],
        },
      ),
    ).toBe(pluginSkillName)
  })

  test('legacy commands still render with a slash prefix when metadata is present', () => {
    expect(
      renderToolUseMessage(
        { skill: 'legacy-command' },
        {
          commands: [
            createPromptCommand('legacy-command', {
              loadedFrom: 'commands_DEPRECATED',
            }),
          ],
        },
      ),
    ).toBe('/legacy-command')
  })
})
