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
  persistPermissionUpdates,
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

  test('batch persistence identifies session updates separately from rejected writes', () => {
    const settingsPath = getSettingsFilePathForSource('userSettings')!
    let result: ReturnType<typeof persistPermissionUpdates> | undefined

    withSettingsFileLockSync(settingsPath, () => {
      result = persistPermissionUpdates([
        {
          type: 'addDirectories',
          directories: ['/session-workspace'],
          destination: 'session',
        },
        {
          type: 'addDirectories',
          directories: ['/persisted-workspace'],
          destination: 'userSettings',
        },
      ])
    })

    expect(result?.appliedUpdates.map(update => update.destination)).toEqual([
      'session',
    ])
    expect(result?.failedUpdates.map(update => update.destination)).toEqual([
      'userSettings',
    ])
    expect(result?.allApplied).toBe(false)
  })
})
