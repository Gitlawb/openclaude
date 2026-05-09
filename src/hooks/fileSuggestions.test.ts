import { afterEach, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import * as path from 'node:path'

type FakeChildProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
}

type LoadModuleOptions = {
  spawnScenario?: (child: FakeChildProcess, signal?: AbortSignal) => void
  ripGrepStreamImpl?: (
    args: string[],
    target: string,
    abortSignal: AbortSignal,
    onLines: (lines: string[]) => void,
  ) => Promise<void>
}

afterEach(() => {
  mock.restore()
})

function createAbortError(message = 'aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function createIgnoreModuleMock() {
  return {
    default: () => {
      const patterns: string[] = []
      const api = {
        add(input: string) {
          patterns.push(
            ...input
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(line => line.length > 0 && !line.startsWith('#')),
          )
          return api
        },
        ignores(filePath: string) {
          const normalized = filePath.replaceAll('\\', '/')
          if (normalized.split('/').includes('..')) {
            throw new Error('path should be a `path.relative()`d string')
          }
          return patterns.some(pattern => {
            const normalizedPattern = pattern.replaceAll('\\', '/')
            if (normalizedPattern.endsWith('/')) {
              return normalized.startsWith(normalizedPattern)
            }
            return normalized === normalizedPattern
          })
        },
      }
      return api
    },
  }
}

function installFileSuggestionsDependencyMocks(options: LoadModuleOptions = {}): void {
  mock.module('cross-spawn', () => ({
    spawn: (
      _command: string,
      _args: string[],
      spawnOptions: { signal?: AbortSignal },
    ) => {
      const child = createFakeChildProcess()
      options.spawnScenario?.(child, spawnOptions.signal)
      return child
    },
  }))

  mock.module('ignore', createIgnoreModuleMock)
  mock.module('src/utils/markdownConfigLoader.js', () => ({
    CLAUDE_CONFIG_DIRECTORIES: [],
    loadMarkdownFilesForSubdir: async () => [],
  }))
  mock.module('../native-ts/file-index/index.js', () => ({
    CHUNK_MS: 4,
    FileIndex: class FileIndex {
      loadFromFileListAsync(): { done: Promise<void> } {
        return { done: Promise.resolve() }
      }

      search(): Array<{ path: string; score: number }> {
        return []
      }
    },
    yieldToEventLoop: async () => {},
  }))
  mock.module('../services/analytics/index.js', () => ({
    logEvent: () => {},
  }))
  mock.module('../utils/config.js', () => ({
    getGlobalConfig: () => ({}),
  }))
  mock.module('../utils/cwd.js', () => ({
    getCwd: () => process.cwd(),
  }))
  mock.module('../utils/debug.js', () => ({
    logForDebugging: () => {},
  }))
  mock.module('../utils/errors.js', () => ({
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
  }))
  mock.module('../utils/fsOperations.js', () => ({
    getFsImplementation: () => ({
      readFile: async () => {
        throw new Error('ENOENT')
      },
    }),
  }))
  mock.module('../utils/git.js', () => ({
    findGitRoot: () => process.cwd(),
    gitExe: () => 'git',
  }))
  mock.module('../utils/hooks.js', () => ({
    createBaseHookInput: () => ({}),
    executeFileSuggestionCommand: async () => undefined,
  }))
  mock.module('../utils/log.js', () => ({
    logError: () => {},
  }))
  mock.module('../utils/path.js', () => ({
    expandPath: (input: string) => input,
  }))
  mock.module('../utils/ripgrep.js', () => ({
    ripGrepStream:
      options.ripGrepStreamImpl ??
      (async () => {
        return undefined
      }),
  }))
  mock.module('../utils/settings/settings.js', () => ({
    getInitialSettings: () => ({}),
  }))
  mock.module('../utils/signal.js', () => ({
    createSignal: () => ({
      subscribe: () => () => {},
      emit: () => {},
      clear: () => {},
    }),
  }))
}

async function loadFileSuggestionsModule(options: LoadModuleOptions = {}) {
  installFileSuggestionsDependencyMocks(options)
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./fileSuggestions.ts?ts=${nonce}`)
}

test('normalizeFileSuggestionPath strips leading current-directory prefixes', async () => {
  const fileSuggestions = await loadFileSuggestionsModule()

  expect(fileSuggestions.normalizeFileSuggestionPath('./src/index.ts')).toBe(
    'src/index.ts',
  )
  expect(fileSuggestions.normalizeFileSuggestionPath('.\\src\\index.ts')).toBe(
    'src\\index.ts',
  )
  expect(fileSuggestions.normalizeFileSuggestionPath('src/index.ts')).toBe(
    'src/index.ts',
  )
})

test('shouldExcludeFileSuggestionPath excludes common generated directories', async () => {
  const fileSuggestions = await loadFileSuggestionsModule()

  expect(
    fileSuggestions.shouldExcludeFileSuggestionPath(
      'node_modules/react/index.js',
    ),
  ).toBe(true)
  expect(
    fileSuggestions.shouldExcludeFileSuggestionPath('wandb/run-1/output.log'),
  ).toBe(true)
  expect(
    fileSuggestions.shouldExcludeFileSuggestionPath(
      'src/node_modules-helper.ts',
    ),
  ).toBe(false)
  expect(
    fileSuggestions.shouldExcludeFileSuggestionPath('src/components/'),
  ).toBe(false)
})

test('filterCandidatePathsForSuggestions filters generated directories and caps file count', async () => {
  const fileSuggestions = await loadFileSuggestionsModule()

  const result = fileSuggestions.filterCandidatePathsForSuggestions(
    [
      './src/index.ts',
      'node_modules/pkg/index.js',
      'wandb/latest-run.log',
      'src/app.ts',
      'src/extra.ts',
    ],
    2,
  )

  expect(result.files).toEqual(['src/index.ts', 'src/app.ts'])
  expect(result.truncated).toBe(true)
})

test('filterCandidatePathsForSuggestions keeps parent-relative paths when matcher throws on ..', async () => {
  const fileSuggestions = await loadFileSuggestionsModule()

  const result = fileSuggestions.filterCandidatePathsForSuggestions(
    ['../bar.ts'],
    10,
    {
      ignores(filePath: string) {
        if (filePath.includes('..')) {
          throw new Error('path should be a `path.relative()`d string')
        }
        return filePath.startsWith('foo/')
      },
    },
  )

  expect(result.files).toEqual(['../bar.ts'])
  expect(result.truncated).toBe(false)
})

test('createFileSuggestionIgnoreMatcher scopes ignore patterns to their roots for subdirectory cwd', async () => {
  const fileSuggestions = await loadFileSuggestionsModule()
  const repoRoot = path.resolve('virtual-repo')
  const cwd = path.join(repoRoot, 'packages', 'app')
  const matcher = fileSuggestions.createFileSuggestionIgnoreMatcher(cwd, [
    {
      root: repoRoot,
      patterns: ['top-level.ts', 'shared-ignore/'].join('\n'),
    },
    {
      root: cwd,
      patterns: ['local-ignore.ts', 'local-generated/'].join('\n'),
    },
  ])

  const result = fileSuggestions.filterCandidatePathsForSuggestions(
    [
      '../sibling.ts',
      '../../top-level.ts',
      '../../shared-ignore/file.ts',
      'local-ignore.ts',
      'local-generated/file.ts',
      'keep.ts',
    ],
    10,
    matcher,
  )

  expect(result.files).toEqual(['../sibling.ts', 'keep.ts'])
  expect(result.truncated).toBe(false)
})

test('collectGitPaths reports external abort before output as non-success', async () => {
  const fileSuggestions = await loadFileSuggestionsModule({
    spawnScenario: (child, signal) => {
      signal?.addEventListener(
        'abort',
        () => {
          queueMicrotask(() => {
            child.emit('error', createAbortError())
            child.emit('close', 1)
          })
        },
        { once: true },
      )
    },
  })

  const controller = new AbortController()
  const promise = fileSuggestions.collectGitPathsForTesting(['ls-files'], {
    repoRoot: process.cwd(),
    cwd: process.cwd(),
    abortSignal: controller.signal,
    maxFiles: 10,
  })
  controller.abort()

  await expect(promise).resolves.toMatchObject({
    files: [],
    truncated: false,
    code: 1,
  })
})

test('collectGitPaths reports external abort after partial output as non-success', async () => {
  const fileSuggestions = await loadFileSuggestionsModule({
    spawnScenario: (child, signal) => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('tracked/a.ts\n'))
      })
      signal?.addEventListener(
        'abort',
        () => {
          queueMicrotask(() => {
            child.emit('error', createAbortError())
            child.emit('close', 1)
          })
        },
        { once: true },
      )
    },
  })

  const controller = new AbortController()
  const promise = fileSuggestions.collectGitPathsForTesting(['ls-files'], {
    repoRoot: process.cwd(),
    cwd: process.cwd(),
    abortSignal: controller.signal,
    maxFiles: 10,
  })
  await Promise.resolve()
  controller.abort()

  await expect(promise).resolves.toMatchObject({
    files: ['tracked/a.ts'],
    truncated: false,
    code: 1,
  })
})

test('collectRipgrepPaths rejects external abort before output', async () => {
  const fileSuggestions = await loadFileSuggestionsModule({
    ripGrepStreamImpl: async (_args, _target, abortSignal) => {
      await new Promise((_, reject) => {
        abortSignal.addEventListener(
          'abort',
          () => reject(createAbortError()),
          { once: true },
        )
      })
    },
  })

  const controller = new AbortController()
  const promise = fileSuggestions.collectRipgrepPathsForTesting(
    ['--files'],
    '.',
    controller.signal,
    10,
  )
  controller.abort()

  await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
})

test('collectRipgrepPaths rejects external abort after partial output', async () => {
  const fileSuggestions = await loadFileSuggestionsModule({
    ripGrepStreamImpl: async (_args, _target, abortSignal, onLines) => {
      onLines(['partial.ts'])
      await new Promise((_, reject) => {
        abortSignal.addEventListener(
          'abort',
          () => reject(createAbortError()),
          { once: true },
        )
      })
    },
  })

  const controller = new AbortController()
  const promise = fileSuggestions.collectRipgrepPathsForTesting(
    ['--files'],
    '.',
    controller.signal,
    10,
  )
  await Promise.resolve()
  controller.abort()

  await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
})
