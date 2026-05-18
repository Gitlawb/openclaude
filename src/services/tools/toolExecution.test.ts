import { describe, expect, test } from 'bun:test'

import { SkillTool } from '../../tools/SkillTool/SkillTool.js'
import { AskUserQuestionTool } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import {
  getSchemaValidationErrorOverride,
  getSchemaValidationToolUseResult,
  normalizeToolInputForValidation,
} from './toolExecution.js'

describe('getSchemaValidationErrorOverride', () => {
  test('returns actionable missing-skill error for SkillTool', () => {
    expect(getSchemaValidationErrorOverride(SkillTool, {})).toBe(
      'Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
    )
  })

  test('does not override unrelated tool schema failures', () => {
    expect(getSchemaValidationErrorOverride({ name: 'Read' } as never, {})).toBe(
      null,
    )
  })

  test('does not override SkillTool when skill is present', () => {
    expect(
      getSchemaValidationErrorOverride(SkillTool, { skill: 'commit' }),
    ).toBe(null)
  })

  test('uses the actionable override for structured toolUseResult too', () => {
    expect(getSchemaValidationToolUseResult(SkillTool, {} as never)).toBe(
      'InputValidationError: Missing skill name. Pass the slash command name as the skill parameter (e.g., skill: "commit" for /commit, skill: "review-pr" for /review-pr).',
    )
  })
})

describe('normalizeToolInputForValidation', () => {
  test('wraps Gemini-style single AskUserQuestion payloads', () => {
    const normalized = normalizeToolInputForValidation(AskUserQuestionTool, {
      header: 'Location',
      question: 'Where should we create the app?',
      options: [
        {
          label: '../todo-app (Recommended)',
          description: 'Create the app next to the current project',
        },
        {
          label: 'Custom path',
          description: 'Provide another folder',
        },
      ],
      multiSelect: false,
    })

    expect(AskUserQuestionTool.inputSchema.safeParse(normalized).success).toBe(true)
    expect(normalized).toEqual({
      questions: [
        {
          header: 'Location',
          question: 'Where should we create the app?',
          options: [
            {
              label: '../todo-app (Recommended)',
              description: 'Create the app next to the current project',
            },
            {
              label: 'Custom path',
              description: 'Provide another folder',
            },
          ],
          multiSelect: false,
        },
      ],
    })
  })

  test('leaves already valid AskUserQuestion payloads unchanged', () => {
    const input = {
      questions: [
        {
          header: 'Location',
          question: 'Where should we create the app?',
          options: [
            { label: '../todo-app', description: 'Use the default folder' },
            { label: 'Custom', description: 'Provide another folder' },
          ],
          multiSelect: false,
        },
      ],
    }

    expect(normalizeToolInputForValidation(AskUserQuestionTool, input)).toBe(input)
  })

  test('does not normalize unrelated tool inputs', () => {
    const input = {
      header: 'Location',
      question: 'Where should we create the app?',
      options: [],
    }

    expect(normalizeToolInputForValidation({ name: 'Read' } as never, input)).toBe(input)
  })
})
