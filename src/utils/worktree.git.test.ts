import { expect, mock, test, afterEach } from 'bun:test'
import { _test, _testDeps } from './worktree.js'

const originalDeps = { ..._testDeps }

afterEach(() => {
  mock.restore()
  Object.assign(_testDeps, originalDeps)
})

// ---------------------------------------------------------------------------
// autoConfigureLongPathsForWorktrees — setting gating
// ---------------------------------------------------------------------------

test('autoConfigureLongPaths applies core.longpaths on Windows when setting is unset (default on)', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  _testDeps.getPlatform = () => 'windows'
  _testDeps.getInitialSettings = () => ({})
  _testDeps.execFileNoThrowWithCwd = execMock

  await _test.autoConfigureLongPathsForWorktrees('/repo')

  expect(execMock).toHaveBeenCalledTimes(1)
  expect(execMock).toHaveBeenCalledWith(
    expect.any(String),
    ['config', '--local', 'core.longpaths', 'true'],
    expect.objectContaining({ cwd: '/repo' }),
  )
})

test('autoConfigureLongPaths skips core.longpaths on Windows when setting is false', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  _testDeps.getPlatform = () => 'windows'
  _testDeps.getInitialSettings = () => ({
    worktree: { autoConfigureLongPaths: false },
  })
  _testDeps.execFileNoThrowWithCwd = execMock

  await _test.autoConfigureLongPathsForWorktrees('/repo')
  expect(execMock).not.toHaveBeenCalled()
})

test('autoConfigureLongPaths skips core.longpaths on non-Windows', async () => {
  const execMock = mock(
    async (_exe: string, _args: string[], _opts?: object) => ({
      code: 0,
      stdout: '',
      stderr: '',
    }),
  )

  _testDeps.getPlatform = () => 'linux'
  _testDeps.getInitialSettings = () => ({})
  _testDeps.execFileNoThrowWithCwd = execMock

  await _test.autoConfigureLongPathsForWorktrees('/repo')
  expect(execMock).not.toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// getOrCreateWorktree — git invocation ordering and error recovery
// ---------------------------------------------------------------------------

const GIT_SHA = 'abc123def456abc123def456abc123def4567890\n'

test('getOrCreateWorktree calls core.longpaths before worktree add on Windows', async () => {
  const gitCalls: string[] = []
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      gitCalls.push(joined)
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  _testDeps.getPlatform = () => 'windows'
  _testDeps.getInitialSettings = () => ({})
  _testDeps.readWorktreeHeadSha = async () => null
  _testDeps.resolveGitDir = async () => '/repo/.git'
  _testDeps.resolveRef = async () => null
  _testDeps.getDefaultBranch = async () => 'main'
  _testDeps.mkdir = async () => undefined
  _testDeps.execFileNoThrowWithCwd = execMock

  await _test.getOrCreateWorktree('/repo', 'my-slug')

  const longpathsIdx = gitCalls.findIndex((c: string) =>
    c.includes('config --local core.longpaths'),
  )
  const addIdx = gitCalls.findIndex((c: string) =>
    c.includes('worktree add'),
  )

  expect(longpathsIdx).toBeGreaterThanOrEqual(0)
  expect(addIdx).toBeGreaterThanOrEqual(0)
  expect(longpathsIdx).toBeLessThan(addIdx)
})

test('getOrCreateWorktree cleans up with worktree remove --force on failure', async () => {
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      if (joined.includes('worktree add')) {
        return { code: 1, stdout: '', stderr: 'checkout failed' }
      }
      if (joined.includes('worktree remove')) {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  _testDeps.getPlatform = () => 'windows'
  _testDeps.getInitialSettings = () => ({})
  _testDeps.readWorktreeHeadSha = async () => null
  _testDeps.resolveGitDir = async () => '/repo/.git'
  _testDeps.resolveRef = async () => null
  _testDeps.getDefaultBranch = async () => 'main'
  _testDeps.mkdir = async () => undefined
  _testDeps.execFileNoThrowWithCwd = execMock

  await expect(_test.getOrCreateWorktree('/repo', 'my-slug')).rejects.toThrow(
    'Failed to create worktree',
  )

  const removeCall = execMock.mock.calls.find(
    (c: [_exe: string, args: string[], _opts?: object]) =>
      c[1].join(' ').includes('worktree remove'),
  )
  expect(removeCall).toBeDefined()
  expect(removeCall![1]).toContain('--force')
})

test('getOrCreateWorktree does not call core.longpaths on non-Windows', async () => {
  const gitCalls: string[] = []
  const execMock = mock(
    async (_exe: string, args: string[], _opts?: object) => {
      const joined = args.join(' ')
      gitCalls.push(joined)
      if (joined.includes('rev-parse')) {
        return { code: 0, stdout: GIT_SHA, stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    },
  )

  _testDeps.getPlatform = () => 'linux'
  _testDeps.getInitialSettings = () => ({})
  _testDeps.readWorktreeHeadSha = async () => null
  _testDeps.resolveGitDir = async () => '/repo/.git'
  _testDeps.resolveRef = async () => null
  _testDeps.getDefaultBranch = async () => 'main'
  _testDeps.mkdir = async () => undefined
  _testDeps.execFileNoThrowWithCwd = execMock

  await _test.getOrCreateWorktree('/repo', 'my-slug')

  const longpathsCalls = gitCalls.filter((c: string) =>
    c.includes('config --local core.longpaths'),
  )
  expect(longpathsCalls).toHaveLength(0)
})
