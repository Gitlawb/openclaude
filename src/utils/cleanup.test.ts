import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { cleanupOldSessionFilesInProjectsDir } from './cleanup.js'
import { NodeFsOperations } from './fsOperations.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('cleanupOldSessionFiles', () => {
  test('removes old replay sidecars while preserving non-session files', async () => {
    const projectsDir = join(
      tmpdir(),
      `openclaude-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      'projects',
    )
    tempDirs.push(projectsDir)

    const projectDir = join(projectsDir, 'project')
    await mkdir(projectDir, { recursive: true })

    const replayPath = join(projectDir, 'session.replay.json')
    const keepPath = join(projectDir, 'session.notes.json')
    await writeFile(replayPath, '{}', 'utf-8')
    await writeFile(keepPath, '{}', 'utf-8')

    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await utimes(replayPath, oldDate, oldDate)
    await utimes(keepPath, oldDate, oldDate)

    const result = await cleanupOldSessionFilesInProjectsDir(
      projectsDir,
      new Date(),
      NodeFsOperations,
    )

    expect(result.messages).toBe(1)
    await expect(stat(replayPath)).rejects.toThrow()
    expect((await stat(keepPath)).isFile()).toBe(true)
  })
})
