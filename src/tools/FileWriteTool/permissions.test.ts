import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'

import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import {
  makeAppStateWithPermissionContext,
  makePermissionContext,
  makeToolUseContext,
} from '../../test/permissionTestHelpers.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { FileWriteTool } from './FileWriteTool.js'

describe('FileWriteTool permissions', () => {
  let originalCwd: string
  let workspace: string

  beforeAll(async () => {
    await acquireSharedMutationLock('tools/FileWriteTool/permissions.test.ts')
  })

  afterAll(() => {
    releaseSharedMutationLock()
  })

  beforeEach(() => {
    originalCwd = getOriginalCwd()
    workspace = mkdtempSync(join(tmpdir(), 'openclaude-file-write-'))
    setOriginalCwd(workspace)
  })

  afterEach(() => {
    setOriginalCwd(originalCwd)
    rmSync(workspace, { recursive: true, force: true })
  })

  test('allows normal working-directory updates in acceptEdits mode', async () => {
    const filePath = join(workspace, 'package.json')
    writeFileSync(filePath, '{}\n')

    const result = await FileWriteTool.checkPermissions(
      {
        file_path: filePath,
        content: '{"private": true}\n',
      },
      makeToolUseContext(
        makeAppStateWithPermissionContext(
          makePermissionContext({ mode: 'acceptEdits' }),
        ),
        [FileWriteTool],
      ),
    )

    expect(result.behavior).toBe('allow')
  })

  test('allows normal working-directory creates in acceptEdits mode', async () => {
    const filePath = join(workspace, 'new-file.ts')

    const result = await FileWriteTool.checkPermissions(
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makeToolUseContext(
        makeAppStateWithPermissionContext(
          makePermissionContext({ mode: 'acceptEdits' }),
        ),
        [FileWriteTool],
      ),
    )

    expect(result.behavior).toBe('allow')
  })

  test('asks for normal working-directory writes in default mode', async () => {
    const filePath = join(workspace, 'default-mode.ts')

    const result = await FileWriteTool.checkPermissions(
      {
        file_path: filePath,
        content: 'export const value = 1\n',
      },
      makeToolUseContext(
        makeAppStateWithPermissionContext(
          makePermissionContext({ mode: 'default' }),
        ),
        [FileWriteTool],
      ),
    )

    expect(result.behavior).toBe('ask')
  })
})
