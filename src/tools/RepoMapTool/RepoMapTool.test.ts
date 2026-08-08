import { beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { cpSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { initParser } from '../../context/repoMap/parser.js'
import { invalidateCache } from '../../context/repoMap/index.js'
import { getRepoFiles } from '../../context/repoMap/gitFiles.js'
import { getCwd, pwd, runWithCwdOverride } from '../../utils/cwd.js'
import { isAbortError } from '../../utils/errors.js'
import { runWithSdkContext, setCwdState } from '../../bootstrap/state.js'
import type { SessionId } from '../../types/ids.js'
import { RepoMapTool } from './RepoMapTool.js'
import { getToolUseSummary } from './UI.js'

const FIXTURE_ROOT = join(
  import.meta.dir,
  '..',
  '..',
  'context',
  'repoMap',
  '__fixtures__',
  'mini-repo',
)
const FIXTURE_FILES = [
  'fileA.ts',
  'fileB.ts',
  'fileC.ts',
  'fileD.ts',
  'fileE.ts',
]

beforeAll(async () => {
  await initParser()
})

function populateFixtureRepo(tempDir: string): void {
  for (const f of FIXTURE_FILES) {
    cpSync(join(FIXTURE_ROOT, f), join(tempDir, f))
  }
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  execFileSync('git', ['init'], { cwd: tempDir, env, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: tempDir, env, stdio: 'ignore' })
}

async function callRepoMapToolInCwd(
  cwd: string,
  input: Parameters<typeof RepoMapTool.call>[0],
) {
  const previousCwd = getCwd()
  return await runWithSdkContext({
    sessionId: 'repomap-tool-test' as SessionId,
    sessionProjectDir: null,
    cwd,
    originalCwd: cwd,
  }, () => runWithCwdOverride(cwd, async () => {
    setCwdState(cwd)
    expect(pwd()).toBe(cwd)
    try {
      return await RepoMapTool.call(
        input,
        { abortController: new AbortController() } as Parameters<typeof RepoMapTool.call>[1],
      )
    } finally {
      setCwdState(previousCwd)
    }
  }))
}

describe('RepoMapTool schema', () => {
  test('validates a minimal input {}', () => {
    const schema = RepoMapTool.inputSchema
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
  })

  test('rejects max_tokens below 256', () => {
    const schema = RepoMapTool.inputSchema
    const result = schema.safeParse({ max_tokens: 100 })
    expect(result.success).toBe(false)
  })

  test('rejects max_tokens above 16384', () => {
    const schema = RepoMapTool.inputSchema
    const result = schema.safeParse({ max_tokens: 20000 })
    expect(result.success).toBe(false)
  })

  test('accepts focus_files as string[]', () => {
    const schema = RepoMapTool.inputSchema
    const result = schema.safeParse({
      focus_files: ['src/tools/', 'src/context.ts'],
    })
    expect(result.success).toBe(true)
  })
})

describe('RepoMapTool call', () => {
  test('call returns the declared output shape', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-'))
    try {
      populateFixtureRepo(tempDir)
      expect(await getRepoFiles(tempDir)).toEqual(FIXTURE_FILES)

      const result = await callRepoMapToolInCwd(tempDir, { max_tokens: 256 })

      expect(typeof result.data.rendered).toBe('string')
      expect(typeof result.data.token_count).toBe('number')
      expect(typeof result.data.file_count).toBe('number')
      expect(typeof result.data.total_file_count).toBe('number')
      expect(typeof result.data.cache_hit).toBe('boolean')
      expect(typeof result.data.build_time_ms).toBe('number')
      expect(result.data.total_file_count).toBe(FIXTURE_FILES.length)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('returns a rendered map for a directory', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-'))
    try {
      populateFixtureRepo(tempDir)

      const { buildRepoMap } = await import(
        '../../context/repoMap/index.js'
      )
      const result = await buildRepoMap({
        root: tempDir,
        maxTokens: 1024,
      })

      expect(result.map.length).toBeGreaterThan(0)
      expect(result.fileCount).toBeGreaterThan(0)
      expect(result.totalFileCount).toBe(5)
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.tokenCount).toBeLessThanOrEqual(1024)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('respects max_tokens parameter', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-'))
    try {
      populateFixtureRepo(tempDir)

      const { buildRepoMap } = await import(
        '../../context/repoMap/index.js'
      )

      const small = await buildRepoMap({ root: tempDir, maxTokens: 256 })
      const large = await buildRepoMap({ root: tempDir, maxTokens: 4096 })

      expect(small.tokenCount).toBeLessThanOrEqual(256)
      // Large budget should include more or equal content
      expect(large.map.length).toBeGreaterThanOrEqual(small.map.length)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('focus_files boosts specified files in the ranking', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-'))
    try {
      populateFixtureRepo(tempDir)

      const { buildRepoMap } = await import(
        '../../context/repoMap/index.js'
      )

      // Without focus, fileE is ranked last (isolated)
      const noFocus = await buildRepoMap({ root: tempDir, maxTokens: 2048 })
      const lines = noFocus.map.split('\n')
      const fileEPos = lines.findIndex(l => l === 'fileE.ts:')

      // With focus on fileE
      invalidateCache(tempDir)
      const withFocus = await buildRepoMap({
        root: tempDir,
        maxTokens: 2048,
        focusFiles: ['fileE.ts'],
      })
      const focusLines = withFocus.map.split('\n')
      const fileEFocusPos = focusLines.findIndex(l => l === 'fileE.ts:')

      // fileE should rank higher (earlier position) with focus
      expect(fileEFocusPos).toBeLessThan(fileEPos)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('focus_symbols resolves matching files through the public tool call', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-'))
    try {
      populateFixtureRepo(tempDir)

      const result = await callRepoMapToolInCwd(tempDir, {
        max_tokens: 2048,
        focus_symbols: ['ConsoleLogger'],
      })

      expect(result.data.rendered).toContain('fileE.ts:')
      expect(result.data.rendered).toContain(
        'export class ConsoleLogger implements Logger',
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })

  test('does not build a repository map when already aborted', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-tool-abort-'))
    try {
      populateFixtureRepo(tempDir)
      const abortController = new AbortController()
      abortController.abort('test-abort')

      let error: unknown
      try {
        await runWithSdkContext({
          sessionId: 'repomap-tool-abort-test' as SessionId,
          sessionProjectDir: null,
          cwd: tempDir,
          originalCwd: tempDir,
        }, () => runWithCwdOverride(tempDir, () =>
          RepoMapTool.call(
            { max_tokens: 256 },
            { abortController } as Parameters<typeof RepoMapTool.call>[1],
          ),
        ))
      } catch (err) {
        error = err
      }

      expect(isAbortError(error)).toBe(true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      invalidateCache(tempDir)
    }
  })
})

describe('RepoMapTool properties', () => {
  test('is marked read-only and concurrency-safe', () => {
    expect(RepoMapTool.isReadOnly()).toBe(true)
    expect(RepoMapTool.isConcurrencySafe()).toBe(true)
  })

  test('exposes a path hook for read permission grants', () => {
    expect(typeof RepoMapTool.getPath).toBe('function')
    expect(RepoMapTool.getPath?.()).toBe(pwd())
  })
})

describe('RepoMapTool result mapping', () => {
  test('maps output to a tool result block without a duplicate output type', () => {
    const block = RepoMapTool.mapToolResultToToolResultBlockParam(
      {
        rendered: 'file.ts:\n  export const value = 1',
        token_count: 10,
        file_count: 1,
        total_file_count: 1,
        cache_hit: false,
        build_time_ms: 12,
      },
      'toolu_123',
    )

    expect(block.tool_use_id).toBe('toolu_123')
    expect(block.type).toBe('tool_result')
    expect(block.content).toContain('Repository map: 1 files ranked')
    expect(block.content).toContain('file.ts:')
  })
})

describe('RepoMapTool UI', () => {
  test('getToolUseSummary returns descriptive string including focus', () => {
    expect(getToolUseSummary(undefined)).toBe('Repository map')
    expect(getToolUseSummary({})).toBe('Repository map')
    expect(getToolUseSummary({ focus_files: ['src/tools/'] })).toContain(
      'focus:',
    )
    expect(getToolUseSummary({ focus_files: ['src/tools/'] })).toContain(
      'src/tools/',
    )
    expect(
      getToolUseSummary({ focus_symbols: ['buildTool'] }),
    ).toContain('buildTool')
  })
})
