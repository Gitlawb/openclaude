import { describe, expect, test } from 'bun:test'

import { SkillTool } from './SkillTool.js'

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
