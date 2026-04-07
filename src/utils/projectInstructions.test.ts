import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  FALLBACK_PROJECT_INSTRUCTION_FILE,
  getProjectInstructionFilePath,
  getProjectInstructionFilePaths,
  hasProjectInstructionFile,
  isProjectInstructionFileName,
  PRIMARY_PROJECT_INSTRUCTION_FILE,
} from './projectInstructions.js'

describe('projectInstructions', () => {
  test('prefers AGENTS.md over CLAUDE.md for root project instructions', () => {
    const dir = '/repo'
    const existingPaths = new Set([
      join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])

    const filePath = getProjectInstructionFilePath(
      dir,
      path => existingPaths.has(path),
    )

    expect(filePath).toBe(join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE))
  })

  test('falls back to CLAUDE.md when AGENTS.md is absent', () => {
    const dir = '/repo'
    const existingPaths = new Set([join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE)])

    const filePath = getProjectInstructionFilePath(
      dir,
      path => existingPaths.has(path),
    )

    expect(filePath).toBe(join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE))
  })

  test('returns both candidate root instruction paths', () => {
    const dir = '/repo'

    expect(getProjectInstructionFilePaths(dir)).toEqual([
      join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])
  })

  test('detects whether a repo instruction file exists', () => {
    const dir = '/repo'
    const existingPaths = new Set([join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE)])

    expect(hasProjectInstructionFile(dir, path => existingPaths.has(path))).toBe(
      true,
    )
    expect(hasProjectInstructionFile(dir, () => false)).toBe(false)
  })

  test('recognizes AGENTS.md as a root instruction filename', () => {
    expect(isProjectInstructionFileName(PRIMARY_PROJECT_INSTRUCTION_FILE)).toBe(
      true,
    )
    expect(isProjectInstructionFileName(FALLBACK_PROJECT_INSTRUCTION_FILE)).toBe(
      true,
    )
    expect(isProjectInstructionFileName('README.md')).toBe(false)
  })
})
