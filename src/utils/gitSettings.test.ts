import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { shouldIncludeGitInstructions } from './gitSettings.js'

let originalCwd: string
let originalEnv: string | undefined
let tempRoot: string

beforeEach(() => {
  originalCwd = process.cwd()
  originalEnv = process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  delete process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  tempRoot = mkdtempSync(join(tmpdir(), 'gitsettings-test-'))
})

afterEach(() => {
  process.chdir(originalCwd)
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS
  } else {
    process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = originalEnv
  }
  rmSync(tempRoot, { recursive: true, force: true })
})

test('omits git instructions outside a git repository', () => {
  const plainDir = join(tempRoot, 'plain')
  mkdirSync(plainDir)
  process.chdir(plainDir)
  expect(shouldIncludeGitInstructions()).toBe(false)
})

test('includes git instructions inside a git repository', () => {
  const repoDir = join(tempRoot, 'repo')
  mkdirSync(join(repoDir, '.git'), { recursive: true })
  process.chdir(repoDir)
  expect(shouldIncludeGitInstructions()).toBe(true)
})

test('includes git instructions in a subdirectory of a git repository', () => {
  const repoDir = join(tempRoot, 'repo2')
  mkdirSync(join(repoDir, '.git'), { recursive: true })
  const subDir = join(repoDir, 'src', 'nested')
  mkdirSync(subDir, { recursive: true })
  process.chdir(subDir)
  expect(shouldIncludeGitInstructions()).toBe(true)
})

test('re-evaluates per cwd after process.chdir (worktree/daemon safety)', () => {
  const plainDir = join(tempRoot, 'plain-then-repo')
  mkdirSync(plainDir)
  const repoDir = join(tempRoot, 'repo3')
  mkdirSync(join(repoDir, '.git'), { recursive: true })

  process.chdir(plainDir)
  expect(shouldIncludeGitInstructions()).toBe(false)
  process.chdir(repoDir)
  expect(shouldIncludeGitInstructions()).toBe(true)
})

test('env kill switch wins even inside a git repository', () => {
  const repoDir = join(tempRoot, 'repo4')
  mkdirSync(join(repoDir, '.git'), { recursive: true })
  process.chdir(repoDir)
  process.env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = '1'
  expect(shouldIncludeGitInstructions()).toBe(false)
})
