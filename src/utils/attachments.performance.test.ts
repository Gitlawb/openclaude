import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../Tool.js'
import { __test } from './attachments.js'
import { createFileStateCacheWithSizeLimit } from './fileStateCache.js'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(res => {
    resolve = res
  })
  return { promise, resolve }
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(message)
}

describe('attachment perf contracts', () => {
  test('maybe returns [] when signal aborts even if producer hangs', async () => {
    const controller = new AbortController()
    const resultPromise = __test.maybe(
      'hanging_attachment',
      () => new Promise<unknown[]>(() => {}),
      controller.signal,
    )

    controller.abort()

    await expect(resultPromise).resolves.toEqual([])
  })

  test('maybe does not invoke producer when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let started = false

    await expect(
      __test.maybe(
        'pre_aborted_attachment',
        async () => {
          started = true
          return []
        },
        controller.signal,
      ),
    ).resolves.toEqual([])
    expect(started).toBe(false)
  })

  test('processAtMentionedFiles bounds scheduled file work', async () => {
    const gate = deferred()
    let activeStats = 0
    let maxActiveStats = 0

    const cwd = process.cwd()
    const files = Array.from(
      { length: __test.ATTACHMENT_FILE_IO_CONCURRENCY * 3 },
      (_, i) => `${cwd}/mentioned-${i}.ts`,
    )

    const resultPromise = __test.processAtMentionedFilesWithDependencies(
      files.map(file => `@${file}`).join(' '),
      {
        abortController: new AbortController(),
        getAppState: () => ({
          toolPermissionContext: getEmptyToolPermissionContext(),
        }),
      },
      {
        stat: async () => {
          activeStats++
          maxActiveStats = Math.max(maxActiveStats, activeStats)
          await gate.promise
          activeStats--
          return { isDirectory: () => false }
        },
        readdir: async () => [],
        generateFileAttachment: async filename => ({
          type: 'file',
          filename,
          content: {} as never,
          displayPath: filename,
        }),
      },
    )

    await waitFor(
      () => activeStats >= __test.ATTACHMENT_FILE_IO_CONCURRENCY,
      'expected first bounded stat batch to start',
    )
    expect(maxActiveStats).toBeLessThanOrEqual(
      __test.ATTACHMENT_FILE_IO_CONCURRENCY,
    )

    gate.resolve()
    await expect(resultPromise).resolves.toHaveLength(files.length)
  })

  test('processAtMentionedFiles keeps in-flight file work when attachment timeout aborts', async () => {
    const gate = deferred()
    const abortController = new AbortController()
    let activeStats = 0

    const cwd = process.cwd()
    const files = Array.from(
      { length: __test.ATTACHMENT_FILE_IO_CONCURRENCY * 2 },
      (_, i) => `${cwd}/slow-mentioned-${i}.ts`,
    )

    const resultPromise = __test.processAtMentionedFilesWithDependencies(
      files.map(file => `@${file}`).join(' '),
      {
        abortController,
        getAppState: () => ({
          toolPermissionContext: getEmptyToolPermissionContext(),
        }),
      },
      {
        stat: async () => {
          activeStats++
          await gate.promise
          activeStats--
          return { isDirectory: () => false }
        },
        readdir: async () => [],
        generateFileAttachment: async filename => ({
          type: 'file',
          filename,
          content: {} as never,
          displayPath: filename,
        }),
      },
    )

    await waitFor(
      () => activeStats >= __test.ATTACHMENT_FILE_IO_CONCURRENCY,
      'expected first bounded stat batch to start',
    )

    abortController.abort()
    gate.resolve()

    await expect(resultPromise).resolves.toHaveLength(files.length)
  })

  test('getChangedFiles bounds scheduled file reads', async () => {
    const gate = deferred()
    let activeReads = 0
    let maxActiveReads = 0

    const readFileState = createFileStateCacheWithSizeLimit(100)
    const cwd = process.cwd()
    const files = Array.from(
      { length: __test.ATTACHMENT_FILE_IO_CONCURRENCY * 3 },
      (_, i) => `${cwd}/changed-${i}.ts`,
    )
    for (const file of files) {
      readFileState.set(file, {
        content: 'before\n',
        timestamp: 0,
        offset: undefined,
        limit: undefined,
      })
    }

    const resultPromise = __test.getChangedFilesWithDependencies(
      {
        abortController: new AbortController(),
        readFileState,
        getAppState: () => ({
          toolPermissionContext: getEmptyToolPermissionContext(),
        }),
      } as ToolUseContext,
      {
        getFileModificationTime: async () => 1,
        validateFileReadInput: async () => ({ result: true }),
        readFile: async input => {
          activeReads++
          maxActiveReads = Math.max(maxActiveReads, activeReads)
          await gate.promise
          activeReads--
          return {
            data: {
              type: 'text',
              file: {
                filePath: input.file_path,
                content: 'before\nafter\n',
                numLines: 2,
                startLine: 1,
                totalLines: 2,
              },
            },
          }
        },
        readEditedImageAttachment: async () => null,
      },
    )

    await waitFor(
      () => activeReads >= __test.ATTACHMENT_FILE_IO_CONCURRENCY,
      'expected first bounded read batch to start',
    )
    expect(maxActiveReads).toBeLessThanOrEqual(
      __test.ATTACHMENT_FILE_IO_CONCURRENCY,
    )

    gate.resolve()
    await expect(resultPromise).resolves.toHaveLength(files.length)
  })
})
