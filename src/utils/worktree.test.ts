import { afterEach, expect, mock, test } from 'bun:test'

import {
  _resetGitWorktreeMutationLocksForTesting,
  buildRevParseFailureMessage,
  buildWorktreeCreationFailureMessage,
  withGitWorktreeMutationLock,
} from './worktree.js'

afterEach(() => {
  _resetGitWorktreeMutationLocksForTesting()
})

test('withGitWorktreeMutationLock serializes mutations for the same repo', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })

  const first = withGitWorktreeMutationLock('/repo', async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
  })

  const second = withGitWorktreeMutationLock('/repo', async () => {
    order.push('second:start')
    order.push('second:end')
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(order).toEqual(['first:start'])

  releaseFirst()
  await Promise.all([first, second])

  expect(order).toEqual([
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ])
})

test('withGitWorktreeMutationLock does not serialize different repos', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve
  })

  const first = withGitWorktreeMutationLock('/repo-a', async () => {
    order.push('a:start')
    await firstGate
    order.push('a:end')
  })

  const second = withGitWorktreeMutationLock('/repo-b', async () => {
    order.push('b:start')
    order.push('b:end')
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(order).toEqual(['a:start', 'b:start', 'b:end'])

  releaseFirst()
  await Promise.all([first, second])
})

test('buildRevParseFailureMessage surfaces git stderr for empty repos (#690)', () => {
  const msg = buildRevParseFailureMessage(
    'HEAD',
    "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n",
    128,
  )
  expect(msg).toContain('Failed to resolve base branch "HEAD"')
  expect(msg).toContain('unknown revision or path')
  expect(msg).toContain('HEAD has no resolvable commit')
})

test('buildRevParseFailureMessage falls back to exit code when stderr empty', () => {
  const msg = buildRevParseFailureMessage('origin/main', '', 1)
  expect(msg).toBe('Failed to resolve base branch "origin/main": exit code 1')
})

test('buildRevParseFailureMessage skips HEAD-specific hint for branch refs', () => {
  const msg = buildRevParseFailureMessage(
    'origin/main',
    'fatal: ambiguous argument',
    128,
  )
  expect(msg).not.toContain('HEAD has no resolvable commit')
  expect(msg).toContain('fatal: ambiguous argument')
})

test('buildRevParseFailureMessage trims trailing whitespace from stderr', () => {
  const msg = buildRevParseFailureMessage('HEAD', '  some error\n\n', 128)
  expect(msg).toContain(': some error (HEAD')
})

test('buildWorktreeCreationFailureMessage provides a Windows long-path recovery hint', () => {
  const msg = buildWorktreeCreationFailureMessage(
    'error: unable to create file src/components/example.tsx: Filename too long\n',
  )
  expect(msg).toContain('Failed to create worktree')
  expect(msg).toContain('Filename too long')

  if (process.platform === 'win32') {
    expect(msg).toContain('core.longpaths true')
  } else {
    expect(msg).not.toContain('core.longpaths true')
  }
})

async function importWorktreeFresh() {
  return await import(`./worktree.js?ts=${Date.now()}-${Math.random()}`)
}

test('getOrCreateWorktree enables core.longpaths before worktree add on Windows', async () => {
  const execCalls: Array<{ args: string[] }> = []

  const execMock = mock(async (file: string, args: string[], options?: any) => {
    execCalls.push({ args })
    if (args[0] === 'rev-parse') {
      return { code: 0, stdout: 'mock-sha-123\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })

  mock.module('./execFileNoThrow.js', () => ({
    execFileNoThrow: execMock,
    execFileNoThrowWithCwd: execMock,
  }))

  mock.module('./platform.js', () => ({
    getPlatform: () => 'windows',
  }))

  mock.module('fs/promises', () => ({
    mkdir: async () => {},
    utimes: async () => {},
    copyFile: async () => {},
    readdir: async () => [],
    readFile: async () => '',
    stat: async () => ({ isDirectory: () => true }),
    symlink: async () => {},
  }))

  mock.module('./git/gitFilesystem.js', () => ({
    getCommonDir: () => '/fake-repo/.git',
    readWorktreeHeadSha: async () => null,
    resolveGitDir: async () => '/fake-repo/.git',
    resolveRef: async () => null,
  }))

  mock.module('./settings/settings.js', () => ({
    getInitialSettings: () => ({
      worktree: {
        sparsePaths: [],
      },
    }),
  }))

  mock.module('./hooks.js', () => ({
    hasWorktreeCreateHook: () => false,
    executeWorktreeCreateHook: async () => ({ worktreePath: '' }),
    executeWorktreeRemoveHook: async () => {},
  }))

  mock.module('./cwd.js', () => ({
    getCwd: () => '/fake-repo',
  }))

  mock.module('./git.js', () => ({
    findCanonicalGitRoot: () => '/fake-repo',
    findGitRoot: () => '/fake-repo',
    getDefaultBranch: async () => 'main',
    gitExe: () => 'git',
  }))

  const { createAgentWorktree } = await importWorktreeFresh()
  await createAgentWorktree('test-slug')

  // Verify core.longpaths config set ran
  expect(execCalls[0]?.args).toEqual(['config', '--local', 'core.longpaths', 'true'])

  // Verify worktree add happened after that config call
  const addIndex = execCalls.findIndex(c => c.args[0] === 'worktree' && c.args[1] === 'add')
  expect(addIndex).toBeGreaterThan(0)
})

test('getOrCreateWorktree performs cleanup if worktree add fails', async () => {
  const execCalls: Array<{ args: string[] }> = []

  const execMock = mock(async (file: string, args: string[], options?: any) => {
    execCalls.push({ args })
    if (args[0] === 'rev-parse') {
      return { code: 0, stdout: 'mock-sha-123\n', stderr: '' }
    }
    if (args[0] === 'worktree' && args[1] === 'add') {
      return { code: 1, stdout: '', stderr: 'fatal: some add error' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })

  mock.module('./execFileNoThrow.js', () => ({
    execFileNoThrow: execMock,
    execFileNoThrowWithCwd: execMock,
  }))

  mock.module('./platform.js', () => ({
    getPlatform: () => 'windows',
  }))

  mock.module('fs/promises', () => ({
    mkdir: async () => {},
    utimes: async () => {},
    copyFile: async () => {},
    readdir: async () => [],
    readFile: async () => '',
    stat: async () => ({ isDirectory: () => true }),
    symlink: async () => {},
  }))

  mock.module('./git/gitFilesystem.js', () => ({
    getCommonDir: () => '/fake-repo/.git',
    readWorktreeHeadSha: async () => null,
    resolveGitDir: async () => '/fake-repo/.git',
    resolveRef: async () => null,
  }))

  mock.module('./settings/settings.js', () => ({
    getInitialSettings: () => ({
      worktree: {
        sparsePaths: [],
      },
    }),
  }))

  mock.module('./hooks.js', () => ({
    hasWorktreeCreateHook: () => false,
    executeWorktreeCreateHook: async () => ({ worktreePath: '' }),
    executeWorktreeRemoveHook: async () => {},
  }))

  mock.module('./cwd.js', () => ({
    getCwd: () => '/fake-repo',
  }))

  mock.module('./git.js', () => ({
    findCanonicalGitRoot: () => '/fake-repo',
    findGitRoot: () => '/fake-repo',
    getDefaultBranch: async () => 'main',
    gitExe: () => 'git',
  }))

  const { createAgentWorktree } = await importWorktreeFresh()

  await expect(createAgentWorktree('test-slug')).rejects.toThrow(/some add error/)

  // Verify that the worktree remove command was run to clean up
  const removeCall = execCalls.find(c => c.args[0] === 'worktree' && c.args[1] === 'remove')
  expect(removeCall).toBeDefined()
  expect(removeCall?.args).toContain('--force')
})
