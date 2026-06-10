import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearOversizedMarkdownSkipsForTesting,
  getOversizedMarkdownSkips,
  loadMarkdownFilesForSubdir,
} from './markdownConfigLoader.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

// Regression for #769 — large agent/skill/Obsidian dirs froze the REPL at
// startup because loadMarkdownFiles spawned one readFile per file via
// `Promise.all`, opening thousands of fds and burning the event loop on
// parseFrontmatter. The fix batches reads to 32 at a time and skips files
// over CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES (default 256 KiB) so that
// vault notes dragged in via symlink don't load multi-MB blobs into memory.

const SAVED_ENV = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_USE_NATIVE_FILE_SEARCH:
    process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH,
  CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES:
    process.env.CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES,
}

let tempDir: string

function restore(key: keyof typeof SAVED_ENV): void {
  const value = SAVED_ENV[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('markdownConfigLoader.scaling.test.ts')
  tempDir = await mkdtemp(join(tmpdir(), 'openclaude-md-scaling-'))
  process.env.CLAUDE_CONFIG_DIR = join(tempDir, '.openclaude')
  process.env.CLAUDE_CODE_USE_NATIVE_FILE_SEARCH = '1'
  delete process.env.CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES
  loadMarkdownFilesForSubdir.cache.clear?.()
  clearOversizedMarkdownSkipsForTesting()
})

afterEach(async () => {
  try {
    await rm(tempDir, { recursive: true, force: true })
    restore('CLAUDE_CONFIG_DIR')
    restore('CLAUDE_CODE_USE_NATIVE_FILE_SEARCH')
    restore('CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES')
    loadMarkdownFilesForSubdir.cache.clear?.()
    clearOversizedMarkdownSkipsForTesting()
  } finally {
    releaseSharedMutationLock()
  }
})

async function writeAgent(
  dir: string,
  name: string,
  body = `You are ${name}.`,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: "test"\n---\n\n${body}\n`,
  )
}

describe('loadMarkdownFilesForSubdir (#769 scaling)', () => {
  test('loads >batch-size agent files without losing any', async () => {
    const agentsDir = join(process.env.CLAUDE_CONFIG_DIR!, 'agents')
    const total = 80 // > MARKDOWN_LOAD_BATCH_SIZE (32) to exercise multiple batches
    for (let i = 0; i < total; i++) {
      await writeAgent(agentsDir, `agent-${String(i).padStart(3, '0')}`)
    }

    const files = await loadMarkdownFilesForSubdir('agents', tempDir)

    expect(files.length).toBe(total)
    const names = files.map(f => f.frontmatter['name']).sort()
    expect(names[0]).toBe('agent-000')
    expect(names[total - 1]).toBe(`agent-${String(total - 1).padStart(3, '0')}`)
  })

  test('skips files exceeding the max size and keeps small siblings', async () => {
    const agentsDir = join(process.env.CLAUDE_CONFIG_DIR!, 'agents')
    process.env.CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES = '1024'
    loadMarkdownFilesForSubdir.cache.clear?.()

    await writeAgent(agentsDir, 'tiny')
    // 2 KiB body to push the second file above the 1 KiB cap
    await writeAgent(agentsDir, 'huge', 'x'.repeat(2048))

    const files = await loadMarkdownFilesForSubdir('agents', tempDir)

    const loadedNames = files.map(f => f.frontmatter['name'])
    expect(loadedNames).toContain('tiny')
    expect(loadedNames).not.toContain('huge')
  })

  test('records skipped oversized files and emits one stderr warning', async () => {
    const agentsDir = join(process.env.CLAUDE_CONFIG_DIR!, 'agents')
    process.env.CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES = '1024'
    loadMarkdownFilesForSubdir.cache.clear?.()

    const captured: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    ;(process.stderr.write as unknown as (s: string) => boolean) = (
      s: string,
    ): boolean => {
      captured.push(s)
      return true
    }

    try {
      await writeAgent(agentsDir, 'huge-a', 'a'.repeat(2048))
      await writeAgent(agentsDir, 'huge-b', 'b'.repeat(2048))
      await loadMarkdownFilesForSubdir('agents', tempDir)

      const skips = getOversizedMarkdownSkips()
      expect(skips.length).toBe(2)
      expect(skips.every(s => s.maxBytes === 1024)).toBe(true)
      expect(skips.every(s => s.sizeBytes > 1024)).toBe(true)

      const warnings = captured.filter(line =>
        line.includes('skipping oversized markdown config file'),
      )
      expect(warnings.length).toBe(1)
      expect(warnings[0]).toContain(
        'CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES',
      )
    } finally {
      ;(process.stderr.write as unknown) = origWrite
    }
  })

  test('size cap is overridable via env var', async () => {
    const agentsDir = join(process.env.CLAUDE_CONFIG_DIR!, 'agents')
    process.env.CLAUDE_CODE_MAX_MARKDOWN_FILE_SIZE_BYTES = '65536'
    loadMarkdownFilesForSubdir.cache.clear?.()

    await writeAgent(agentsDir, 'roomy', 'y'.repeat(8 * 1024))

    const files = await loadMarkdownFilesForSubdir('agents', tempDir)

    expect(files.map(f => f.frontmatter['name'])).toContain('roomy')
  })
})
