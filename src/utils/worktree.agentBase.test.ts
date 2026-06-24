import { expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Regression for #1586 — an agent worktree (isolation: "worktree") must be
// based on the parent session's current HEAD, not origin/<defaultBranch>.
// Otherwise the isolated agent sees an older tree and misses files that only
// exist on the active branch.
//
// createAgentWorktree shells out to git via execFileNoThrow.js. That module is
// mocked process-globally by several other suites, and Bun's `mock.module`
// cannot be reliably reverted once leaked, so importing worktree.ts into this
// shared test process makes the test hostage to suite ordering (it would fail
// with "not in a git repository" when a sibling's stub leaks in). Instead we
// run the actual createAgentWorktree call in a clean child process
// (worktree.agentBase.fixture.ts), which loads only the real modules. The git
// repo setup and all assertions use real git directly here, which no mock can
// touch.

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

const FIXTURE = join(import.meta.dir, 'worktree.agentBase.fixture.ts')

function runCreateAgentWorktree(
  cfgDir: string,
  repoDir: string,
  name: string,
): { worktreePath: string } {
  const stdout = execFileSync(
    process.execPath,
    ['run', FIXTURE, cfgDir, repoDir, name],
    { encoding: 'utf8' },
  )
  return JSON.parse(stdout) as { worktreePath: string }
}

test(
  'agent worktree is based on the parent session HEAD, not origin/main',
  () => {
    const cfgDir = mkdtempSync(join(tmpdir(), 'openclaude-wt-cfg-'))
    const repoDir = mkdtempSync(join(tmpdir(), 'openclaude-wt-repo-'))

    try {
      git(repoDir, 'init', '-b', 'main')
      writeFileSync(join(repoDir, 'base.txt'), 'base\n')
      git(repoDir, 'add', '.')
      git(repoDir, 'commit', '-m', 'base on main')
      const mainSha = git(repoDir, 'rev-parse', 'HEAD')

      // Fake an origin/main remote-tracking ref pinned to the OLD main commit,
      // so the pre-fix code path (which prefers origin/<defaultBranch>) would
      // base the worktree on a tree that lacks the feature file below.
      git(repoDir, 'update-ref', 'refs/remotes/origin/main', mainSha)

      // Move onto a feature branch and add a file that exists only there.
      git(repoDir, 'checkout', '-b', 'feature')
      writeFileSync(join(repoDir, 'feature-only.txt'), 'feature\n')
      git(repoDir, 'add', '.')
      git(repoDir, 'commit', '-m', 'add feature-only file')

      const parentHead = git(repoDir, 'rev-parse', 'HEAD')

      const result = runCreateAgentWorktree(cfgDir, repoDir, 'issue-1586-base')

      expect(result.worktreePath).toBeDefined()
      expect(existsSync(result.worktreePath)).toBe(true)

      // The worktree must carry the parent's committed state: the feature-only
      // file (absent from origin/main) is present, and HEAD matches the
      // parent's commit.
      expect(existsSync(join(result.worktreePath, 'feature-only.txt'))).toBe(
        true,
      )
      expect(git(result.worktreePath, 'rev-parse', 'HEAD')).toBe(parentHead)

      // Cleanup the worktree registration before the temp repo is removed.
      try {
        git(repoDir, 'worktree', 'remove', '--force', result.worktreePath)
      } catch {
        // ignore — the rm below handles the directory
      }
    } finally {
      for (const dir of [repoDir, cfgDir]) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best-effort cleanup
        }
      }
    }
  },
  15_000,
)
