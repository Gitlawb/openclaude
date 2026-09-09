import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
