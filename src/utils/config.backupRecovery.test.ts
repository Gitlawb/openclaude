import { afterEach, describe, expect, test } from 'bun:test'
import type * as ConfigModule from './config.js'
import {
  NodeFsOperations,
  setFsImplementation,
  setOriginalFsImplementation,
  type FsOperations,
} from './fsOperations.js'

// These cases drive the #1807 recovery path through the injected filesystem
// without touching the real ~/.openclaude.json. They cover three layers:
//   - recoverConfigFromBackup (the backup-selection helper) directly,
//   - the production getConfig recovery branch via _getConfigForTesting (getConfig
//     is module-private but runs its real body under NODE_ENV=test), and
//   - selectBackupsToPrune, the pure decision that must not prune while the live
//     config is corrupt.
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

  test('recovers an older healthy backup when the newest one is corrupt', async () => {
    const { recoverConfigFromBackup } = await freshConfig()
    const NEWER = `${BASE}.backup.20260630130000`
    const OLDER = `${BASE}.backup.20260630120000`
    installFs({
      readdirStringSync: (dir: string) =>
        dir.endsWith('backups') ? [OLDER, NEWER] : [],
      readFileSync: (path: string) => {
        const p = String(path)
        if (p.endsWith(NEWER)) {
          return '{ not valid json ,,,'
        }
        if (p.endsWith(OLDER)) {
          return '{"theme":"solarized","customField":3}'
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

    // The corrupt newest backup is skipped; the older healthy one is used.
    expect(recovered).toEqual({
      theme: 'solarized',
      customField: 3,
      keptDefault: true,
    })
  })
})

describe('getConfig recovery (production path)', () => {
  afterEach(() => {
    setOriginalFsImplementation()
  })

  test('getConfig recovers a healthy backup when the live config is corrupt', async () => {
    const { _getConfigForTesting } = await freshConfig()
    installFs({
      readdirStringSync: (dir: string) =>
        dir.endsWith('backups') ? [BACKUP_NAME] : [],
      readFileSync: (path: string) => {
        const p = String(path)
        if (p.endsWith(BACKUP_NAME)) {
          return '{"theme":"dark","customField":7}'
        }
        if (p === FILE) {
          return '{ corrupt live config ,,,'
        }
        throw enoent()
      },
      statSync: () => {
        throw enoent()
      },
    })

    // Drives the real getConfig ConfigParseError -> recoverConfigFromBackup
    // branch, not just the helper in isolation.
    const recovered = _getConfigForTesting(FILE, () => ({
      theme: 'light',
      customField: 0,
      keptDefault: true,
    }))

    expect(recovered).toEqual({
      theme: 'dark',
      customField: 7,
      keptDefault: true,
    })
  })

  test('getConfig recovers an older healthy backup when the newest is corrupt', async () => {
    const { _getConfigForTesting } = await freshConfig()
    const NEWER = `${BASE}.backup.20260630130000`
    const OLDER = `${BASE}.backup.20260630120000`
    installFs({
      readdirStringSync: (dir: string) =>
        dir.endsWith('backups') ? [OLDER, NEWER] : [],
      readFileSync: (path: string) => {
        const p = String(path)
        if (p.endsWith(NEWER)) {
          return '{ not valid json ,,,'
        }
        if (p.endsWith(OLDER)) {
          return '{"theme":"solarized"}'
        }
        if (p === FILE) {
          return '{ corrupt live config ,,,'
        }
        throw enoent()
      },
      statSync: () => {
        throw enoent()
      },
    })

    const recovered = _getConfigForTesting(FILE, () => ({
      theme: 'light',
      keptDefault: true,
    }))

    expect(recovered).toEqual({
      theme: 'solarized',
      keptDefault: true,
    })
  })
})

describe('selectBackupsToPrune', () => {
  test('prunes nothing while the live config is corrupt', async () => {
    const { selectBackupsToPrune } = await freshConfig()
    const backups = Array.from(
      { length: 7 },
      (_, i) => `${BASE}.backup.2026063012000${i}`,
    )
    // A corrupt live config means an older healthy backup may be the only
    // recovery source, so nothing may be unlinked.
    expect(selectBackupsToPrune(backups, 5, false)).toEqual([])
  })

  test('keeps the newest maxBackups and prunes the rest when healthy', async () => {
    const { selectBackupsToPrune } = await freshConfig()
    const oldest = `${BASE}.backup.20260630120000`
    // Deliberately unsorted input: the helper sorts newest-first itself.
    const backups = [
      `${BASE}.backup.20260630120003`,
      oldest,
      `${BASE}.backup.20260630120005`,
      `${BASE}.backup.20260630120002`,
      `${BASE}.backup.20260630120004`,
      `${BASE}.backup.20260630120001`,
    ]
    // 6 backups, keep newest 5 -> only the oldest is pruned.
    expect(selectBackupsToPrune(backups, 5, true)).toEqual([oldest])
  })
})
