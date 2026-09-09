import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Compile the production module for the same Node runtime as the installed CLI
// matrix. These checks use real PowerShell/DPAPI and an isolated fake record.
describe('Windows DPAPI credential integration', { skip: process.platform !== 'win32' }, () => {
  const originalSpawnSync = childProcess.spawnSync
  const originalEnv = { ...process.env }
  const moduleUrl = pathToFileURL(resolve('.artifacts/windows-credentials/secure-storage.mjs')).href
  const initial = { verbooInstallationId: 'fixture-installation', mcpOAuth: { fixture: { accessToken: 'fixture-token', expiresAt: 123456789, serverName: 'fixture-ação-東京', serverUrl: 'https://example.invalid' } } }
  const updated = { ...initial, verbooInstallationId: 'refreshed-installation' }
  let storage
  let directory
  let powershellCalls = 0

  before(async () => {
    mkdirSync(resolve('.artifacts/pty'), { recursive: true })
    directory = mkdtempSync(resolve('.artifacts/pty/native-credentials-'))
    process.env.VERBOO_CONFIG_DIR = directory
    process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = '0'
    process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = '0'
    childProcess.spawnSync = (...args) => {
      if (String(args[0]).toLowerCase().endsWith('powershell.exe')) powershellCalls++
      return originalSpawnSync(...args)
    }
    syncBuiltinESMExports()
    storage = (await import(moduleUrl)).windowsCredentialStorage
  })

  after(() => {
    childProcess.spawnSync = originalSpawnSync
    syncBuiltinESMExports()
    for (const key of ['VERBOO_CONFIG_DIR', 'VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT', 'OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT']) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
    if (directory) writeFileSync(join(directory, 'native-checks.json'), JSON.stringify({ node: process.version, powershellCalls }, null, 2))
  })

  function mutateInAnotherProcess(operation, value) {
    const script = `import { readFileSync } from 'node:fs'; const { windowsCredentialStorage: storage } = await import(${JSON.stringify(moduleUrl)}); const result = ${operation === 'write' ? "storage.update(JSON.parse(readFileSync(0, 'utf8'))).success" : 'storage.delete()'}; if (!result) process.exit(1);`
    const result = originalSpawnSync(process.execPath, ['--input-type=module', '-e', script], { env: process.env, input: value ? JSON.stringify(value) : '', encoding: 'utf8', timeout: 20_000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  }

  test('missing credentials require no native process for 20 agents', async () => {
    assert.deepEqual(storage.readResult(), { kind: 'missing' })
    const records = await Promise.all(Array.from({ length: 20 }, () => storage.readAsync()))
    assert.deepEqual(records, Array(20).fill(null))
    assert.equal(powershellCalls, 0)
  })

  test('real encrypted credentials round-trip and decrypt once for 20 agents', async () => {
    assert.deepEqual(storage.update(initial), { success: true })
    const files = readdirSync(directory).filter(file => file.endsWith('.secure.dpapi'))
    assert.equal(files.length, 1)
    const encrypted = readFileSync(join(directory, files[0]), 'utf8')
    assert.match(encrypted, /^[A-Za-z\d+/]+={0,2}$/)
    assert.ok(!encrypted.includes('fixture-token'))
    const beforeReads = powershellCalls
    const records = await Promise.all(Array.from({ length: 20 }, () => storage.readAsync()))
    assert.deepEqual(records, Array(20).fill(initial))
    assert.equal(powershellCalls - beforeReads, 1)
  })

  test('classified reads bypass the decrypted cache', () => {
    const beforeRead = powershellCalls
    assert.deepEqual(storage.readResult(), { kind: 'ok', data: initial })
    assert.equal(powershellCalls - beforeRead, 1)
    assert.deepEqual(storage.read(), initial)
  })

  test('another process can refresh and remove credentials without stale reads', () => {
    mutateInAnotherProcess('write', updated)
    const beforeRead = powershellCalls
    assert.deepEqual(storage.read(), updated)
    assert.equal(powershellCalls - beforeRead, 1)
    mutateInAnotherProcess('delete')
    assert.equal(storage.read(), null)
    assert.deepEqual(storage.readResult(), { kind: 'missing' })
    assert.equal(powershellCalls - beforeRead, 1)
  })

  test('corrupt encrypted data remains an error and does not reuse the cache', () => {
    assert.deepEqual(storage.update(initial), { success: true })
    assert.deepEqual(storage.read(), initial)
    const file = readdirSync(directory).find(file => file.endsWith('.secure.dpapi'))
    writeFileSync(join(directory, file), 'invalid encrypted data')
    assert.equal(storage.readResult().kind, 'error')
    assert.equal(storage.read(), null)
    assert.equal(storage.delete(), true)
  })
})
