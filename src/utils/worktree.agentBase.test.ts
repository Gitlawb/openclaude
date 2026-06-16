import { afterEach, beforeEach, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAgentWorktree } from './worktree.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from './envUtils.js'

// Regression for #1586 — an agent worktree (isolation: "worktree") must be
// based on the parent session's current HEAD, not origin/<defaultBranch>.
// Otherwise the isolated agent sees an older tree and misses files that only
// exist on the active branch.
//
// The parent cwd is passed explicitly (createAgentWorktree's `cwd` option)
// rather than via the ambient getCwd(): bun runs test files concurrently in
// one process and a sibling test mutates the global cwd state, which would
// otherwise race this test.

let repoDir: string
let cfgDir: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), 'openclaude-wt-cfg-'))
  setClaudeConfigHomeDirForTesting(cfgDir)
  getClaudeConfigHomeDir.cache?.clear?.()

  repoDir = mkdtempSync(join(tmpdir(), 'openclaude-wt-repo-'))
  git(repoDir, 'init', '-b', 'main')
  writeFileSync(join(repoDir, 'base.txt'), 'base\n')
  git(repoDir, 'add', '.')
  git(repoDir, 'commit', '-m', 'base on main')
  const mainSha = git(repoDir, 'rev-parse', 'HEAD')

  // Fake an origin/main remote-tracking ref pinned to the OLD main commit, so
  // the pre-fix code path (which prefers origin/<defaultBranch>) would base the
  // worktree on a tree that lacks the feature file below.
  git(repoDir, 'update-ref', 'refs/remotes/origin/main', mainSha)

  // Move onto a feature branch and add a file that exists only there.
  git(repoDir, 'checkout', '-b', 'feature')
  writeFileSync(join(repoDir, 'feature-only.txt'), 'feature\n')
  git(repoDir, 'add', '.')
  git(repoDir, 'commit', '-m', 'add feature-only file')
})

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  getClaudeConfigHomeDir.cache?.clear?.()
  for (const dir of [repoDir, cfgDir]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

test('agent worktree is based on the parent session HEAD, not origin/main', async () => {
  const parentHead = git(repoDir, 'rev-parse', 'HEAD')

  const result = await createAgentWorktree('issue-1586-base', { cwd: repoDir })

  expect(result.worktreePath).toBeDefined()
  expect(existsSync(result.worktreePath)).toBe(true)

  // The worktree must carry the parent's committed state: the feature-only file
  // (absent from origin/main) is present, and HEAD matches the parent's commit.
  expect(existsSync(join(result.worktreePath, 'feature-only.txt'))).toBe(true)
  expect(git(result.worktreePath, 'rev-parse', 'HEAD')).toBe(parentHead)

  // Cleanup the worktree registration before the temp repo is removed.
  try {
    git(repoDir, 'worktree', 'remove', '--force', result.worktreePath)
  } catch {
    // ignore — afterEach rm handles the directory
  }
})
