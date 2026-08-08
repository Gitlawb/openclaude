import { afterEach, describe, expect, test } from 'bun:test'

import type { Command } from '../../types/command.js'
import {
  formatCommandsWithinBudget,
  getCharBudget,
  MAX_CHAR_BUDGET,
} from './prompt.js'

const originalBudgetOverride = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET

afterEach(() => {
  if (originalBudgetOverride === undefined) {
    delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
  } else {
    process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = originalBudgetOverride
  }
})

function createSkill(name: string, description: string): Command {
  return {
    type: 'prompt',
    name,
    description,
    progressMessage: `${name} progress`,
    contentLength: 0,
    source: 'plugin',
    loadedFrom: 'plugin',
    async getPromptForCommand() {
      return []
    },
  }
}

describe('SkillTool listing budget', () => {
  test('caps provider-derived budget for very large context windows', () => {
    expect(getCharBudget(2_000_000)).toBe(MAX_CHAR_BUDGET)
  })

  test('keeps smaller context windows below the hard cap proportional', () => {
    expect(getCharBudget(50_000)).toBe(2_000)
  })

  test('preserves explicit budget override for local testing', () => {
    process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '12000'

    expect(getCharBudget(2_000_000)).toBe(12_000)
  })

  test('does not allow huge context windows to keep every long description', () => {
    const longDescription = 'x'.repeat(220)
    const skills = Array.from({ length: 60 }, (_, i) =>
      createSkill(`skill-${i}`, longDescription),
    )

    const content = formatCommandsWithinBudget(skills, 2_000_000)

    expect(content).toContain('- skill-0')
    expect(content).not.toContain(longDescription)
  })

  test('supports lower listing caps while preserving skill names', () => {
    const skills = Array.from({ length: 24 }, (_, i) =>
      createSkill(`worker-skill-${i}`, `worker details ${'x'.repeat(120)}`),
    )

    const defaultContent = formatCommandsWithinBudget(skills, 200_000)
    const compactContent = formatCommandsWithinBudget(skills, 200_000, {
      maxCharBudget: 1_000,
    })

    expect(compactContent.length).toBeLessThan(defaultContent.length)
    expect(compactContent).toContain('- worker-skill-0')
    expect(compactContent).toContain('- worker-skill-23')
  })
})
