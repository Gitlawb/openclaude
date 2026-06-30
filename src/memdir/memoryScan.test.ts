import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { __test, scanMemoryFiles } from './memoryScan.ts'

let tempDir: string | undefined

type TestDirent = {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

type FakeFile = {
  content?: string
  mtimeMs?: number
  error?: unknown
}

type FakeReadCall = {
  filePath: string
  offset: number
  maxLines?: number
  maxBytes?: number
  truncateOnByteLimit?: boolean
}

function file(name: string): TestDirent {
  return {
    name,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  }
}

function dir(name: string): TestDirent {
  return {
    name,
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
  }
}

function symlink(name: string): TestDirent {
  return {
    name,
    isFile: () => false,
    isDirectory: () => false,
    isSymbolicLink: () => true,
  }
}

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
} {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 250
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error(message)
}

function createFakeDeps({
  tree,
  files = {},
  onRead,
  throwAfterRead = true,
}: {
  tree: Record<string, TestDirent[]>
  files?: Record<string, FakeFile>
  onRead?: (filePath: string, signal: AbortSignal) => Promise<void> | void
  throwAfterRead?: boolean
}) {
  const openedDirs: string[] = []
  const readPaths: string[] = []
  const readCalls: FakeReadCall[] = []

  return {
    openedDirs,
    readCalls,
    readPaths,
    deps: {
      readdir: async (dirPath: string) => {
        openedDirs.push(dirPath)
        const entries = tree[dirPath]
        if (!entries) {
          throw Object.assign(new Error(`ENOENT: ${dirPath}`), {
            code: 'ENOENT',
          })
        }
        return entries
      },
      readFileInRange: async (
        filePath: string,
        _offset = 0,
        _maxLines?: number,
        _maxBytes?: number,
        signal?: AbortSignal,
        options?: { truncateOnByteLimit?: boolean },
      ) => {
        readCalls.push({
          filePath,
          offset: _offset,
          maxLines: _maxLines,
          maxBytes: _maxBytes,
          truncateOnByteLimit: options?.truncateOnByteLimit,
        })
        readPaths.push(filePath)
        signal?.throwIfAborted()
        await onRead?.(filePath, signal ?? new AbortController().signal)
        if (throwAfterRead) {
          signal?.throwIfAborted()
        }

        const fakeFile = files[filePath]
        if (fakeFile?.error) throw fakeFile.error

        return {
          content:
            fakeFile?.content ??
            '---\ndescription: fake memory\ntype: user\n---\nBody',
          lineCount: 4,
          totalLines: 4,
          totalBytes: 0,
          readBytes: 0,
          mtimeMs: fakeFile?.mtimeMs ?? 0,
        }
      },
    },
  }
}

async function writeMemoryFile(path: string): Promise<void> {
  await writeFile(path, '---\ndescription: test\ntype: user\n---\nContent')
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

test('scanMemoryFiles returns markdown files within the current allowed depth', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'memoryScan-'))
  await mkdir(join(tempDir, 'one', 'two', 'three'), { recursive: true })
  await writeMemoryFile(join(tempDir, 'root.md'))
  await writeMemoryFile(join(tempDir, 'one', 'one.md'))
  await writeMemoryFile(join(tempDir, 'one', 'two', 'two.md'))
  await writeMemoryFile(join(tempDir, 'one', 'two', 'three', 'three.md'))

  const result = await scanMemoryFiles(tempDir, new AbortController().signal)

  const filenames = result.map(r => r.filename).sort()
  expect(filenames).toEqual([
    join('one', 'one.md'),
    join('one', 'two', 'two.md'),
    'root.md',
  ])
})

test('scanMemoryFiles does not open directories beyond the current allowed depth', async () => {
  const root = '/memory'
  const one = join(root, 'one')
  const two = join(one, 'two')
  const tooDeep = join(two, 'three')
  const { deps, openedDirs } = createFakeDeps({
    tree: {
      [root]: [dir('one')],
      [one]: [dir('two')],
      [two]: [dir('three'), file('two.md')],
      [tooDeep]: [file('three.md')],
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result.map(r => r.filename)).toEqual([join('one', 'two', 'two.md')])
  expect(openedDirs).toEqual([root, one, two])
})

test('scanMemoryFiles does not follow symlinked directories', async () => {
  const root = '/memory'
  const linked = join(root, 'linked')
  const { deps, openedDirs } = createFakeDeps({
    tree: {
      [root]: [symlink('linked'), file('root.md')],
      [linked]: [file('linked.md')],
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result.map(r => r.filename)).toEqual(['root.md'])
  expect(openedDirs).toEqual([root])
})

test('scanMemoryFiles keeps symlinked markdown file candidates', async () => {
  const root = '/memory'
  const { deps, openedDirs } = createFakeDeps({
    tree: {
      [root]: [symlink('linked.md')],
    },
    files: {
      [join(root, 'linked.md')]: { mtimeMs: 1 },
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result.map(r => r.filename)).toEqual(['linked.md'])
  expect(openedDirs).toEqual([root])
})

test('scanMemoryFiles returns the newest 200 markdown files', async () => {
  const root = '/memory'
  const tree = {
    [root]: Array.from({ length: 205 }, (_, i) => file(`file-${i}.md`)),
  }
  const files = Object.fromEntries(
    Array.from({ length: 205 }, (_, i) => [
      join(root, `file-${i}.md`),
      { mtimeMs: i },
    ]),
  )

  const { deps } = createFakeDeps({ tree, files })
  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result).toHaveLength(200)
  expect(result[0].filename).toBe('file-204.md')
  expect(result.at(-1)?.filename).toBe('file-5.md')
  expect(result.some(r => r.filename === 'file-4.md')).toBe(false)
})

test('scanMemoryFiles never exceeds header read concurrency', async () => {
  const root = '/memory'
  const gate = deferred()
  let activeReads = 0
  let maxActiveReads = 0
  const { deps } = createFakeDeps({
    tree: {
      [root]: Array.from(
        { length: __test.HEADER_READ_CONCURRENCY * 3 },
        (_, i) => file(`file-${i}.md`),
      ),
    },
    onRead: async () => {
      activeReads++
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      await gate.promise
      activeReads--
    },
  })

  const promise = __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  await waitFor(
    () => activeReads === __test.HEADER_READ_CONCURRENCY,
    'expected the first read batch to start',
  )
  expect(maxActiveReads).toBe(__test.HEADER_READ_CONCURRENCY)

  gate.resolve()
  await promise
  expect(maxActiveReads).toBeLessThanOrEqual(__test.HEADER_READ_CONCURRENCY)
})

test('scanMemoryFiles does not schedule every file in a broad directory at once', async () => {
  const root = '/memory'
  const gate = deferred()
  let readsStarted = 0
  const { deps } = createFakeDeps({
    tree: {
      [root]: Array.from({ length: 500 }, (_, i) => file(`file-${i}.md`)),
    },
    onRead: async () => {
      readsStarted++
      await gate.promise
    },
  })

  const promise = __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  await waitFor(
    () => readsStarted >= __test.HEADER_READ_CONCURRENCY,
    'expected bounded reads to start',
  )
  expect(readsStarted).toBe(__test.HEADER_READ_CONCURRENCY)

  gate.resolve()
  await promise
})

test('scanMemoryFiles bounds header reads by lines and bytes', async () => {
  const root = '/memory'
  const { deps, readCalls } = createFakeDeps({
    tree: {
      [root]: [file('note.md')],
    },
  })

  await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(readCalls).toEqual([
    {
      filePath: join(root, 'note.md'),
      offset: 0,
      maxLines: __test.FRONTMATTER_MAX_LINES,
      maxBytes: __test.FRONTMATTER_MAX_BYTES,
      truncateOnByteLimit: true,
    },
  ])
})

test('scanMemoryFiles excludes MEMORY.md with the current case-sensitive basename rule', async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'memoryScan-'))
  await writeFile(join(tempDir, 'MEMORY.md'), '# index')
  await writeMemoryFile(join(tempDir, 'user_role.md'))

  const result = await scanMemoryFiles(tempDir, new AbortController().signal)

  expect(result.map(r => r.filename)).toEqual(['user_role.md'])
})

test('scanMemoryFiles preserves case-sensitive MEMORY.md exclusion semantics', async () => {
  const root = '/memory'
  const { deps, readPaths } = createFakeDeps({
    tree: {
      [root]: [file('MEMORY.md'), file('memory.md'), file('user_role.md')],
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result.map(r => r.filename).sort()).toEqual([
    'memory.md',
    'user_role.md',
  ])
  expect(readPaths).not.toContain(join(root, 'MEMORY.md'))
})

test('scanMemoryFiles treats non-string descriptions as absent', async () => {
  const root = '/memory'
  const { deps } = createFakeDeps({
    tree: {
      [root]: [file('number-description.md')],
    },
    files: {
      [join(root, 'number-description.md')]: {
        content: '---\ndescription: 123\ntype: user\n---\nBody',
      },
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result).toHaveLength(1)
  expect(result[0]?.description).toBeNull()
})

test('scanMemoryFiles skips unreadable files without discarding valid siblings', async () => {
  const root = '/memory'
  const { deps } = createFakeDeps({
    tree: {
      [root]: [file('good-a.md'), file('bad.md'), file('good-b.md')],
    },
    files: {
      [join(root, 'good-a.md')]: { mtimeMs: 3 },
      [join(root, 'bad.md')]: { error: new Error('unreadable') },
      [join(root, 'good-b.md')]: { mtimeMs: 2 },
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    new AbortController().signal,
    deps,
  )

  expect(result.map(r => r.filename)).toEqual(['good-a.md', 'good-b.md'])
})

test('scanMemoryFiles returns promptly when the signal is already aborted', async () => {
  const root = '/memory'
  const { deps, openedDirs, readPaths } = createFakeDeps({
    tree: {
      [root]: [file('note.md')],
    },
  })
  const controller = new AbortController()
  controller.abort()

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    controller.signal,
    deps,
  )

  expect(result).toEqual([])
  expect(openedDirs).toEqual([])
  expect(readPaths).toEqual([])
})

test('scanMemoryFiles drops headers when the signal aborts after a read', async () => {
  const root = '/memory'
  const controller = new AbortController()
  const { deps, readPaths } = createFakeDeps({
    tree: {
      [root]: [file('late-abort.md')],
    },
    onRead: () => {
      controller.abort()
    },
    throwAfterRead: false,
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    controller.signal,
    deps,
  )

  expect(readPaths).toEqual([join(root, 'late-abort.md')])
  expect(result).toEqual([])
})

test('scanMemoryFiles stops scheduling additional reads after abort', async () => {
  const root = '/memory'
  const controller = new AbortController()
  let readsStarted = 0
  const { deps } = createFakeDeps({
    tree: {
      [root]: Array.from({ length: 50 }, (_, i) => file(`file-${i}.md`)),
    },
    onRead: () => {
      readsStarted++
      controller.abort()
    },
  })

  const result = await __test.scanMemoryFilesWithDependencies(
    root,
    controller.signal,
    deps,
  )

  expect(result).toEqual([])
  expect(readsStarted).toBeGreaterThan(0)
  expect(readsStarted).toBeLessThanOrEqual(__test.HEADER_READ_CONCURRENCY)
})
