import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { initializeWiki } from './init.js'
import { getWikiPaths } from './paths.js'
import { getWikiStatus } from './status.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeProjectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-wiki-status-'))
  tempDirs.push(dir)
  return dir
}

test('getWikiStatus reports uninitialized wiki state', async () => {
  const cwd = await makeProjectDir()
  const status = await getWikiStatus(cwd)

  expect(status.initialized).toBe(false)
  expect(status.pageCount).toBe(0)
  expect(status.sourceCount).toBe(0)
  expect(status.lastUpdatedAt).toBeNull()
})

test('getWikiStatus counts pages and sources for initialized wiki', async () => {
  const cwd = await makeProjectDir()
  await initializeWiki(cwd)
  const paths = getWikiPaths(cwd)

  await writeFile(join(paths.pagesDir, 'commands.md'), '# Commands\n', 'utf8')
  await mkdir(join(paths.sourcesDir, 'external'), { recursive: true })
  await writeFile(
    join(paths.sourcesDir, 'external', 'spec.md'),
    '# Spec\n',
    'utf8',
  )

  const status = await getWikiStatus(cwd)

  expect(status.initialized).toBe(true)
  expect(status.pageCount).toBe(2)
  expect(status.sourceCount).toBe(1)
  expect(status.hasSchema).toBe(true)
  expect(status.hasIndex).toBe(true)
  expect(status.hasLog).toBe(true)
  expect(status.lastUpdatedAt).not.toBeNull()
})
