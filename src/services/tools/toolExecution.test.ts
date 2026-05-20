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
  test('treats blank Read.pages as omitted', () => {
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        offset: 1,
        limit: 20,
        pages: '',
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
      offset: 1,
      limit: 20,
    })

    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        pages: '   ',
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
    })
  })

  test('treats null Read.pages as omitted', () => {
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, {
        file_path: '/tmp/example.txt',
        pages: null,
      }),
    ).toEqual({
      file_path: '/tmp/example.txt',
    })
  })

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

    // Tool name not AskUserQuestion → only null-stripping applies; no nulls → identity
    const result = normalizeToolInputForValidation({ name: 'Read' } as never, input)
    expect(result).toEqual(input)
  })

  // Regression for #1264 — Codex strict schema mode widens optional fields to
  // `type: [<orig>, 'null']`. The model emits `null` to indicate "not set",
  // but tool Zod schemas type optional fields as `T | undefined`, not
  // `T | null`. Strip top-level nulls so the field reaches the tool as
  // missing (matches what the model intended).
  test('strips top-level null values from tool input (#1264)', () => {
    const input = {
      file_path: '/tmp/foo.txt',
      limit: 20,
      offset: 1,
      pages: null,
    }
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, input),
    ).toEqual({
      file_path: '/tmp/foo.txt',
      limit: 20,
      offset: 1,
    })
  })

  test('keeps non-null falsy values (0, empty string, false)', () => {
    const input = {
      offset: 0,
      label: '',
      enabled: false,
    }
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, input),
    ).toEqual(input)
  })

  test('does not recurse into nested objects (top-level only)', () => {
    const input = {
      file_path: '/tmp/foo.txt',
      meta: { nested: null },
    }
    expect(
      normalizeToolInputForValidation({ name: 'Read' } as never, input),
    ).toEqual({
      file_path: '/tmp/foo.txt',
      meta: { nested: null },
    })
  })
})
