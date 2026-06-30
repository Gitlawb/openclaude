import { afterEach, describe, expect, test } from 'bun:test'
import type * as ConfigModule from './config.js'
import {
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
  type FsOperations,
} from './fsOperations.js'

// recoverConfigFromBackup reads through the injected filesystem, so these
// cases drive the #1807 recovery path deterministically without touching the
// real ~/.openclaude.json. getConfig (its only production caller) is
// module-private and short-circuits to the in-memory config under
// NODE_ENV=test, so the helper is exercised directly here.
//
// Load config through a query-suffixed specifier so a leaked
// mock.module('./config.js') from another file in the same process can never
// turn these assertions into no-ops (the deferredWrite.test.ts trap).

const FILE = '/virtual/.openclaude.json'
const BASE = '.openclaude.json'
const BACKUP_NAME = `${BASE}.backup.20260630120000`

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

function installFs(over: Partial<FsOperations>): void {
  setFsImplementation({ ...NodeFsOperations, ...over } as FsOperations)
}

async function freshConfig(): Promise<typeof ConfigModule> {
  return (await import(
    `./config.js?backupRecoveryTest=${Date.now()}-${Math.random()}`
  )) as typeof ConfigModule
}

describe('recoverConfigFromBackup', () => {
  afterEach(() => {
    setOriginalFsImplementation()
  })

  test('recovers the most recent healthy backup, merged over defaults', async () => {
    const { recoverConfigFromBackup } = await freshConfig()
    installFs({
      readdirStringSync: (dir: string) =>
        dir.endsWith('backups') ? [BACKUP_NAME] : [],
      readFileSync: (path: string) => {
        if (String(path).endsWith(BACKUP_NAME)) {
          return '{"theme":"dark","customField":7}'
        }
        throw enoent()
      },
      statSync: () => {
        throw enoent()
      },
    })

    const recovered = recoverConfigFromBackup(FILE, () => ({
      theme: 'light',
      customField: 0,
      keptDefault: true,
    }))

    // Backup values win; fields absent from the backup keep their defaults.
    expect(recovered).toEqual({
      theme: 'dark',
      customField: 7,
      keptDefault: true,
    })
  })

  test('returns undefined when no backup exists', async () => {
    const { recoverConfigFromBackup } = await freshConfig()
    installFs({
      readdirStringSync: () => [],
      statSync: () => {
        throw enoent()
      },
    })

    expect(
      recoverConfigFromBackup(FILE, () => ({ theme: 'light' })),
    ).toBeUndefined()
  })

  test('returns undefined when the backup itself is corrupt', async () => {
    const { recoverConfigFromBackup } = await freshConfig()
    installFs({
      readdirStringSync: (dir: string) =>
        dir.endsWith('backups') ? [BACKUP_NAME] : [],
      readFileSync: (path: string) => {
        if (String(path).endsWith(BACKUP_NAME)) {
          return '{ not valid json ,,,'
        }
        throw enoent()
      },
      statSync: () => {
        throw enoent()
      },
    })

    expect(
      recoverConfigFromBackup(FILE, () => ({ theme: 'light' })),
    ).toBeUndefined()
  })
})
