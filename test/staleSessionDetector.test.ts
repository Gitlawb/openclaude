import { describe, expect, test } from 'bun:test'
import { analyzeSessionStaleness } from '../src/utils/staleSessionDetector'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('staleSessionDetector', () => {
  test('detecta session stale e grande', async () => {
    const tmpFile = join(tmpdir(), `test-session-${Date.now()}.jsonl`)

    // Cria arquivo grande (6MB)
    const largeContent = 'x'.repeat(6 * 1024 * 1024)
    await writeFile(tmpFile, largeContent)

    // Simula arquivo antigo modificando mtime
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 dias atrás
    const { utimes } = await import('fs/promises')
    await utimes(tmpFile, oldDate, oldDate)

    const result = await analyzeSessionStaleness(tmpFile)

    expect(result.isStale).toBe(true)
    expect(result.isLarge).toBe(true)
    expect(result.shouldOfferSummarization).toBe(true)
    expect(result.ageInDays).toBeGreaterThan(7)
    expect(result.sizeInBytes).toBeGreaterThan(5 * 1024 * 1024)

    await unlink(tmpFile)
  })

  test('não oferece summarização para session pequena', async () => {
    const tmpFile = join(tmpdir(), `test-session-small-${Date.now()}.jsonl`)

    // Cria arquivo pequeno (1KB)
    await writeFile(tmpFile, 'x'.repeat(1024))

    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    const { utimes } = await import('fs/promises')
    await utimes(tmpFile, oldDate, oldDate)

    const result = await analyzeSessionStaleness(tmpFile)

    expect(result.isStale).toBe(true)
    expect(result.isLarge).toBe(false)
    expect(result.shouldOfferSummarization).toBe(false)

    await unlink(tmpFile)
  })

  test('não oferece summarização para session recente', async () => {
    const tmpFile = join(tmpdir(), `test-session-recent-${Date.now()}.jsonl`)

    // Cria arquivo grande mas recente
    const largeContent = 'x'.repeat(6 * 1024 * 1024)
    await writeFile(tmpFile, largeContent)

    const result = await analyzeSessionStaleness(tmpFile)

    expect(result.isStale).toBe(false)
    expect(result.isLarge).toBe(true)
    expect(result.shouldOfferSummarization).toBe(false)

    await unlink(tmpFile)
  })
})
