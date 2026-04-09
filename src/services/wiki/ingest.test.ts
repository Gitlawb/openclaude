import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ingestLocalWikiSource } from './ingest.js'
import { getWikiPaths } from './paths.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-wiki-ingest-'))
  tempDirs.push(dir)
  return dir
}

test('ingestLocalWikiSource creates a source note and updates log/index', async () => {
  const cwd = await makeProjectDir()
  const sourcePath = join(cwd, 'notes.md')
  await writeFile(
    sourcePath,
    '# Design Notes\n\nThis subsystem coordinates provider routing and session state.\nIt should be documented for future contributors.\n',
    'utf8',
  )

  const result = await ingestLocalWikiSource(cwd, 'notes.md')
  const paths = getWikiPaths(cwd)

  expect(result.sourceFile).toBe('notes.md')
  expect(result.title).toBe('Design Notes')
  expect(result.sourceNote.startsWith('.forge/wiki/sources/')).toBe(true)

  const sourceNote = await readFile(join(cwd, result.sourceNote), 'utf8')
  expect(sourceNote).toContain('# Design Notes')
  expect(sourceNote).toContain('Path: `notes.md`')

  const log = await readFile(paths.logFile, 'utf8')
  expect(log).toContain('Ingested `notes.md`')

  const index = await readFile(paths.indexFile, 'utf8')
  expect(index).toContain('./sources/')
  expect(index).toContain(result.sourceNote.replace('.forge/wiki/', './'))
})
