import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { FileEditTool } from './FileEditTool.js'

describe('FileEditTool permissions', () => {
  let originalCwd: string
  let workspace: string

  beforeAll(async () => {
    await acquireSharedMutationLock('tools/FileEditTool/permissions.test.ts')
  })

  afterAll(() => {
    releaseSharedMutationLock()
  })

  beforeEach(() => {
    originalCwd = getOriginalCwd()
    workspace = mkdtempSync(join(tmpdir(), 'openclaude-file-edit-'))
    setOriginalCwd(workspace)
  })

  afterEach(() => {
    setOriginalCwd(originalCwd)
    rmSync(workspace, { recursive: true, force: true })
  })

  test('allows normal working-directory edits in acceptEdits mode', async () => {
    const filePath = join(workspace, 'src', 'index.ts')
    mkdirSync(join(workspace, 'src'))
    writeFileSync(filePath, 'const value = 1\n')

    const result = await FileEditTool.checkPermissions(
      {
        file_path: filePath,
        old_string: '1',
        new_string: '2',
      },
      makeToolUseContext(
        makeAppStateWithPermissionContext(
          makePermissionContext({ mode: 'acceptEdits' }),
        ),
        [FileEditTool],
      ),
    )

    expect(result.behavior).toBe('allow')
  })

  test('asks for normal working-directory edits in default mode', async () => {
    const filePath = join(workspace, 'src', 'default.ts')
    mkdirSync(join(workspace, 'src'))
    writeFileSync(filePath, 'const value = 1\n')

    const result = await FileEditTool.checkPermissions(
      {
        file_path: filePath,
        old_string: '1',
        new_string: '2',
      },
      makeToolUseContext(
        makeAppStateWithPermissionContext(
          makePermissionContext({ mode: 'default' }),
        ),
        [FileEditTool],
      ),
    )

    expect(result.behavior).toBe('ask')
  })
})
