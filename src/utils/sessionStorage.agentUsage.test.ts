import { expect, spyOn, test } from 'bun:test'
import * as fsPromises from 'fs/promises'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSessionId, getSessionProjectDir, switchSession } from '../bootstrap/state.js'
import { asAgentId } from '../types/ids.js'
import { emptyAgentUsage } from './agentUsage.js'
import { readAgentMetadata, writeAgentMetadata, writeAgentUsageMetadata } from './sessionStorage.js'

test('metadata keeps legacy fields and rejects late writes from a replaced execution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-metadata-'))
  const session = getSessionId()
  const projectDir = getSessionProjectDir()
  const id = asAgentId('metadata-fixture')
  const usage = { ...emptyAgentUsage(), state: 'reported' as const, inputTokens: 120, outputTokens: 24, confirmed: 144 }
  try {
    switchSession(session, dir)
    await writeAgentMetadata(id, { agentType: 'explore', description: 'legacy session' })
    expect(await readAgentMetadata(id)).toEqual({ agentType: 'explore', description: 'legacy session' })
    await Promise.all([
      writeAgentMetadata(id, { agentType: 'explore', executionId: 'old', description: 'old' }),
      writeAgentMetadata(id, { agentType: 'general-purpose', executionId: 'new', description: 'resumed' }),
      writeAgentUsageMetadata(id, 'old', usage),
    ])
    expect(await readAgentMetadata(id)).toEqual({ agentType: 'general-purpose', executionId: 'new', description: 'resumed' })
    await writeAgentUsageMetadata(id, 'new', usage)
    expect(await readAgentMetadata(id)).toMatchObject({ executionId: 'new', description: 'resumed', tokenUsage: usage })
    await writeAgentUsageMetadata(id, 'old', emptyAgentUsage())
    expect((await readAgentMetadata(id))?.tokenUsage).toEqual(usage)
  } finally { switchSession(session, projectDir); await rm(dir, { recursive: true, force: true }) }
})

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`Windows metadata replacement recovers from a temporary ${code} lock`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-metadata-lock-'))
    const session = getSessionId()
    const projectDir = getSessionProjectDir()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const id = asAgentId(`metadata-lock-${code}`)
    const usage = { ...emptyAgentUsage(), state: 'reported' as const, confirmed: 144 }
    const originalRename = fsPromises.rename
    let attempts = 0
    let renameSpy: ReturnType<typeof spyOn> | undefined
    try {
      switchSession(session, dir)
      await writeAgentMetadata(id, { agentType: 'explore', executionId: 'current' })
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
      renameSpy = spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
        attempts++
        // A reader continues seeing the previous complete record during retry.
        if (attempts <= 2) {
          expect(await readAgentMetadata(id)).toEqual({ agentType: 'explore', executionId: 'current' })
          throw Object.assign(new Error('fixture sharing violation'), { code })
        }
        return originalRename(from, to)
      })
      await writeAgentUsageMetadata(id, 'current', usage)
      expect(attempts).toBe(3)
      expect((await readAgentMetadata(id))?.tokenUsage).toEqual(usage)
      expect((await readdir(dir, { recursive: true })).some(file => file.endsWith('.tmp'))).toBe(false)
    } finally {
      renameSpy?.mockRestore()
      Object.defineProperty(process, 'platform', platform)
      switchSession(session, projectDir)
      await rm(dir, { recursive: true, force: true })
    }
  })
}

for (const [platformName, code, expectedAttempts] of [['win32', 'EPERM', 7], ['win32', 'ENOSPC', 1], ['linux', 'EPERM', 1]] as const) {
  test(`metadata failure is bounded and preserves the old file for ${platformName}/${code}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-metadata-error-'))
    const session = getSessionId()
    const projectDir = getSessionProjectDir()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    const id = asAgentId('metadata-error')
    const original = { agentType: 'explore', executionId: 'old' }
    let renameSpy: ReturnType<typeof spyOn> | undefined
    try {
      switchSession(session, dir)
      await writeAgentMetadata(id, original)
      Object.defineProperty(process, 'platform', { ...platform, value: platformName })
      const error = Object.assign(new Error('fixture persistent error'), { code })
      renameSpy = spyOn(fsPromises, 'rename').mockRejectedValue(error)
      await expect(writeAgentMetadata(id, { agentType: 'general-purpose', executionId: 'new' })).rejects.toBe(error)
      expect(renameSpy).toHaveBeenCalledTimes(expectedAttempts)
      expect(await readAgentMetadata(id)).toEqual(original)
      expect((await readdir(dir, { recursive: true })).some(file => file.endsWith('.tmp'))).toBe(false)
      renameSpy.mockRestore()
      renameSpy = undefined
      await writeAgentMetadata(id, { agentType: 'general-purpose', executionId: 'new' })
      expect((await readAgentMetadata(id))?.executionId).toBe('new')
    } finally {
      renameSpy?.mockRestore()
      Object.defineProperty(process, 'platform', platform)
      switchSession(session, projectDir)
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('a resumed execution stays newer than a usage write retried under a Windows lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-metadata-resume-lock-'))
  const session = getSessionId()
  const projectDir = getSessionProjectDir()
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const id = asAgentId('metadata-resume-lock')
  let renameSpy: ReturnType<typeof spyOn> | undefined
  try {
    switchSession(session, dir)
    await writeAgentMetadata(id, { agentType: 'explore', executionId: 'old' })
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    const originalRename = fsPromises.rename
    renameSpy = spyOn(fsPromises, 'rename').mockImplementation(originalRename)
      .mockRejectedValueOnce(Object.assign(new Error('fixture reader lock'), { code: 'EPERM' }))
    await Promise.all([
      writeAgentUsageMetadata(id, 'old', { ...emptyAgentUsage(), confirmed: 144 }),
      writeAgentMetadata(id, { agentType: 'general-purpose', executionId: 'new', description: 'resumed' }),
      writeAgentUsageMetadata(id, 'old', emptyAgentUsage()),
    ])
    expect(renameSpy).toHaveBeenCalledTimes(3)
    expect(await readAgentMetadata(id)).toEqual({ agentType: 'general-purpose', executionId: 'new', description: 'resumed' })
  } finally {
    renameSpy?.mockRestore()
    Object.defineProperty(process, 'platform', platform)
    switchSession(session, projectDir)
    await rm(dir, { recursive: true, force: true })
  }
})
