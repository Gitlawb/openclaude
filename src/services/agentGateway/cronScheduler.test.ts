import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const runOpenClaudeAgent = mock(async () => ({
  text: 'scheduler ok',
  stderr: '',
  exitCode: 0,
  timedOut: false,
}))

mock.module('./agentRunner.js', () => ({
  addAgentRunObserver: () => () => {},
  buildPromptFromChatMessages: () => ({ prompt: '', systemPrompt: undefined }),
  normalizeMessageContent: (content: unknown) =>
    typeof content === 'string' ? content : String(content ?? ''),
  runOpenClaudeAgent,
}))

let previousStateDir: string | undefined
let configDir: string | undefined

beforeEach(async () => {
  runOpenClaudeAgent.mockClear()
  previousStateDir = process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR
  configDir = await mkdtemp(join(tmpdir(), 'openclaude-agent-cron-'))
  process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR = configDir
})

afterEach(async () => {
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR
  } else {
    process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR = previousStateDir
  }

  if (configDir) {
    await rm(configDir, { recursive: true, force: true })
  }
})

describe('agent gateway cron scheduler runtime', () => {
  test('executes due jobs, saves output, and delivers non-silent responses', async () => {
    const { getDefaultAgentGatewayConfig } = await import('./config.js')
    const { createCronJob, getCronJob, startCronScheduler } = await import('./cron.js')
    const config = getDefaultAgentGatewayConfig()
    config.cron.enabled = true
    config.cron.tickIntervalSeconds = 1
    const delivered: string[] = []

    const job = await createCronJob({
      name: 'scheduler smoke',
      prompt: 'Report scheduler status',
      schedule: new Date(Date.now() - 1000).toISOString(),
      deliver: 'telegram',
    })

    const scheduler = startCronScheduler(config, async content => {
      delivered.push(content)
    })
    try {
      await waitFor(async () => {
        const current = await getCronJob(job.id)
        return current?.state === 'completed'
      })
    } finally {
      scheduler.stop()
    }

    const completed = await getCronJob(job.id)
    expect(runOpenClaudeAgent).toHaveBeenCalledTimes(1)
    expect(completed?.lastStatus).toBe('ok')
    expect(completed?.lastOutputFile).toBeTruthy()
    expect(delivered).toEqual(['scheduler ok'])

    const output = await readFile(completed!.lastOutputFile!, 'utf8')
    expect(output).toContain('# Cron Job: scheduler smoke')
    expect(output).toContain('Report scheduler status')
    expect(output).toContain('scheduler ok')
  })
})

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for cron scheduler')
}
