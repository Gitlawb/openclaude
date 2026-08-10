import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { setClaudeConfigHomeDirForTesting } from '../envUtils.js'
import {
  getSettingsFilePathForSource,
} from '../settings/settings.js'
import { withSettingsFileLockSync } from '../settings/settingsFileLock.js'
import {
  applyPermissionUpdate,
  persistPermissionUpdate,
} from './PermissionUpdate.js'

describe('applyPermissionUpdate', () => {
  test('removeRules normalizes stored rules before matching removals', () => {
    const updated = applyPermissionUpdate(
      {
        ...getEmptyToolPermissionContext(),
        alwaysAllowRules: {
          userSettings: ['Bash(*)', 'Bash(npm run:*)'],
        },
      },
      {
        type: 'removeRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'userSettings',
      },
    )

    expect(updated.alwaysAllowRules.userSettings).toEqual(['Bash(npm run:*)'])
  })
})

describe('persistPermissionUpdate', () => {
  let configDir: string

  beforeEach(async () => {
    await acquireSharedMutationLock('utils/permissions/PermissionUpdate.test.ts')
    configDir = mkdtempSync(join(tmpdir(), 'openclaude-permission-update-'))
    setClaudeConfigHomeDirForTesting(configDir)
  })

  afterEach(() => {
    try {
      setClaudeConfigHomeDirForTesting(undefined)
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('returns false when a required settings write is rejected', () => {
    const settingsPath = getSettingsFilePathForSource('userSettings')!
    let persisted: boolean | undefined

    withSettingsFileLockSync(settingsPath, () => {
      persisted = persistPermissionUpdate({
          type: 'addDirectories',
          directories: ['/workspace'],
          destination: 'userSettings',
      })
    })

    expect(persisted).toBe(false)
  })
})
