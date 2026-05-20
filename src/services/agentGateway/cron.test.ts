import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  computeNextRun,
  createCronJob,
  deleteCronJob,
  getCronJob,
  listCronJobs,
  parseSchedule,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
  updateCronJob,
} from './cron.js'

let previousStateDir: string | undefined
let configDir: string | undefined

beforeEach(async () => {
  previousStateDir = process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR
  configDir = await mkdtemp(join(tmpdir(), 'openclaude-agent-gateway-'))
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

describe('agent gateway cron schedules', () => {
  test('parses interval, cron, timestamp, and relative one-shot schedules', async () => {
    await expect(parseSchedule('every 2h')).resolves.toMatchObject({
      kind: 'interval',
      minutes: 120,
      display: 'every 120m',
    })
    await expect(parseSchedule('*/15 * * * *')).resolves.toMatchObject({
      kind: 'cron',
      expr: '*/15 * * * *',
    })
    await expect(parseSchedule('*/10 * * * * *')).resolves.toMatchObject({
      kind: 'cron',
      expr: '*/10 * * * * *',
    })
    await expect(parseSchedule('2030-01-02T03:04:05Z')).resolves.toMatchObject({
      kind: 'once',
      runAt: '2030-01-02T03:04:05.000Z',
    })
    await expect(parseSchedule('30m')).resolves.toMatchObject({
      kind: 'once',
      display: 'once in 30m',
    })
  })

  test('computes future runs for interval and cron schedules', async () => {
    const interval = await parseSchedule('every 30m')
    expect(computeNextRun(interval, '2030-01-02T03:00:00.000Z')).toBe(
      '2030-01-02T03:30:00.000Z',
    )

    const cron = await parseSchedule('*/20 * * * *')
    const next = computeNextRun(cron)
    expect(next).toBeTruthy()
    expect(new Date(next!).getMinutes() % 20).toBe(0)

    const secondsCron = await parseSchedule('*/10 * * * * *')
    const nextSecond = computeNextRun(secondsCron)
    expect(nextSecond).toBeTruthy()
    expect(new Date(nextSecond!).getSeconds() % 10).toBe(0)
  })
})

describe('agent gateway cron job storage', () => {
  test('creates, updates, pauses, resumes, triggers, and deletes jobs', async () => {
    const job = await createCronJob({
      name: 'daily status',
      prompt: 'Summarize repo status',
      cron: 'every 1h',
      timezone: 'Europe/Simferopol',
      deliver: 'telegram',
      origin: { platform: 'telegram', chatId: '42' },
    })

    expect(job.id).toHaveLength(12)
    expect(job.enabled).toBe(true)
    expect(job.deliver).toBe('telegram')
    expect(job.timezone).toBe('Europe/Simferopol')
    expect(job.origin).toEqual({ platform: 'telegram', chatId: '42' })
    expect(await listCronJobs(true)).toHaveLength(1)

    const updated = await updateCronJob(job.id, {
      name: 'updated',
      schedule: 'every 2h',
      repeat: 3,
    })
    expect(updated?.name).toBe('updated')
    expect(updated?.repeat?.times).toBe(3)
    expect(updated?.scheduleDisplay).toBe('every 120m')

    const paused = await pauseCronJob(job.id)
    expect(paused?.state).toBe('paused')
    expect(paused?.enabled).toBe(false)
    expect(await listCronJobs()).toHaveLength(0)

    const resumed = await resumeCronJob(job.id)
    expect(resumed?.state).toBe('scheduled')
    expect(resumed?.enabled).toBe(true)

    const triggered = await triggerCronJob(job.id)
    expect(triggered?.nextRunAt).toBeTruthy()
    expect(new Date(triggered!.nextRunAt!).getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    )

    expect(await getCronJob(job.id)).toBeTruthy()
    expect(await deleteCronJob(job.id)).toBe(true)
    expect(await getCronJob(job.id)).toBeUndefined()
  })
})
