import { expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// Regression for #2052 — sessions started in a non-git parent of multiple
// child repos must still be able to create agent worktrees when cwd points
// at a child repository.

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

const FIXTURE = join(import.meta.dir, 'worktree.multiRepoParent.fixture.ts')

// /tmp and the workspace tree both have ancestor .git directories on this
// machine; /var/tmp does not, so findGitRoot stops with null for the parent.
const SANDBOX_ROOT = '/var/tmp'

function runCreateAgentWorktree(
  cfgDir: string,
  targetCwd: string,
  name: string,
):
  | { ok: true; worktreePath: string; gitRoot: string | null }
  | { ok: false; error: string } {
  const stdout = execFileSync(
    process.execPath,
    ['run', FIXTURE, cfgDir, targetCwd, name],
    { encoding: 'utf8', timeout: 30_000 },
  )
  return JSON.parse(stdout) as
    | { ok: true; worktreePath: string; gitRoot: string | null }
    | { ok: false; error: string }
}

test(
  'createAgentWorktree fails for a non-git multi-repo parent, succeeds for a child repo cwd',
  () => {
    const root = mkdtempSync(join(SANDBOX_ROOT, 'openclaude-2052-'))
    const cfgDir = mkdtempSync(join(SANDBOX_ROOT, 'openclaude-2052-cfg-'))
    const parent = join(root, 'parent')
    const repoA = join(parent, 'repo-a')
    const repoB = join(parent, 'repo-b')

    try {
      mkdirSync(repoA, { recursive: true })
      mkdirSync(repoB, { recursive: true })

      for (const repo of [repoA, repoB]) {
        git(repo, 'init', '-b', 'main')
        writeFileSync(join(repo, 'README.md'), `${repo}\n`)
        git(repo, 'add', '.')
        git(repo, 'commit', '-m', 'init')
      }

      const parentResult = runCreateAgentWorktree(
        cfgDir,
        parent,
        'issue-2052-parent',
      )
      expect(parentResult.ok).toBe(false)
      if (!parentResult.ok) {
        expect(parentResult.error).toContain(
          'Cannot create agent worktree: not in a git repository',
        )
      }

      const childResult = runCreateAgentWorktree(
        cfgDir,
        repoA,
        'issue-2052-child',
      )
      expect(childResult.ok).toBe(true)
      if (childResult.ok) {
        expect(existsSync(childResult.worktreePath)).toBe(true)
        expect(childResult.gitRoot).toBe(repoA)
        expect(existsSync(join(childResult.worktreePath, 'README.md'))).toBe(
          true,
        )

        git(repoA, 'worktree', 'remove', '--force', childResult.worktreePath)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(cfgDir, { recursive: true, force: true })
    }
  },
  { timeout: 60_000 },
)
