import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AgentGatewayConfig } from './config.js'
import { getAgentGatewayStateDir } from './config.js'
import { runOpenClaudeAgent } from './agentRunner.js'

export type CronSchedule =
  | { kind: 'once'; runAt: string; display: string }
  | { kind: 'interval'; minutes: number; display: string }
  | { kind: 'cron'; expr: string; display: string }

export type CronJob = {
  id: string
  name: string
  prompt: string
  schedule: CronSchedule
  scheduleDisplay: string
  timezone?: string
  repeat?: { times?: number; completed: number }
  enabled: boolean
  state: 'scheduled' | 'paused' | 'completed'
  deliver: 'local' | 'telegram' | 'origin'
  origin?: {
    platform: string
    chatId: string
  }
  createdAt: string
  nextRunAt: string | null
  lastRunAt?: string
  lastStatus?: 'ok' | 'error'
  lastError?: string
  lastOutputFile?: string
}

type JobsFile = {
  jobs: CronJob[]
  updatedAt: string
}

export type CronSchedulerHandle = {
  stop: () => void
  tick: () => Promise<number>
}

export type CronDelivery = (content: string, job: CronJob) => Promise<void>

const SILENT_MARKER = '[SILENT]'

function jobsPath(): string {
  return join(getAgentGatewayStateDir(), 'cron-jobs.json')
}

export function getCronJobsPath(): string {
  return jobsPath()
}

function outputDir(): string {
  return join(getAgentGatewayStateDir(), 'cron-output')
}

export async function parseSchedule(schedule: string): Promise<CronSchedule> {
  const value = schedule.trim()
  const lower = value.toLowerCase()
  if (!value) throw new Error('Schedule is required')

  if (lower.startsWith('every ')) {
    const minutes = parseDurationMinutes(value.slice(6).trim())
    return { kind: 'interval', minutes, display: `every ${minutes}m` }
  }

  const parts = value.split(/\s+/)
  if ((parts.length === 5 || parts.length === 6) && parts.every(isCronField)) {
    return { kind: 'cron', expr: value, display: value }
  }

  if (value.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp: ${value}`)
    }
    return {
      kind: 'once',
      runAt: date.toISOString(),
      display: `once at ${date.toISOString()}`,
    }
  }

  const minutes = parseDurationMinutes(value)
  const runAt = new Date(Date.now() + minutes * 60_000).toISOString()
  return { kind: 'once', runAt, display: `once in ${value}` }
}

function parseDurationMinutes(value: string): number {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/)
  if (!match) {
    throw new Error(`Invalid duration: ${value}`)
  }
  const amount = Number(match[1])
  const unit = match[2]![0]
  if (unit === 'm') return amount
  if (unit === 'h') return amount * 60
  return amount * 1440
}

function isCronField(field: string): boolean {
  return /^[\d*,-/]+$/.test(field)
}

export async function loadCronJobs(): Promise<CronJob[]> {
  try {
    const raw = await readFile(jobsPath(), 'utf8')
    const parsed = JSON.parse(raw) as JobsFile
    return Array.isArray(parsed.jobs) ? parsed.jobs : []
  } catch {
    return []
  }
}

async function saveCronJobs(jobs: CronJob[]): Promise<void> {
  await mkdir(getAgentGatewayStateDir(), { recursive: true })
  const path = jobsPath()
  const tmpPath = `${path}.${randomUUID()}.tmp`
  await writeFile(
    tmpPath,
    `${JSON.stringify({ jobs, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  await rename(tmpPath, path)
}

export async function createCronJob(
  input: Record<string, unknown>,
): Promise<CronJob> {
  const prompt = String(input.prompt || '').trim()
  const scheduleText = String(input.schedule || input.cron || '').trim()
  if (!prompt) throw new Error('prompt is required')
  if (!scheduleText) throw new Error('schedule is required')

  const schedule = await parseSchedule(scheduleText)
  const repeatValue = Number(input.repeat)
  const repeatTimes =
    Number.isFinite(repeatValue) && repeatValue > 0 ? repeatValue : undefined
  const job: CronJob = {
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    name: String(input.name || prompt.slice(0, 50) || 'cron job').trim(),
    prompt,
    schedule,
    scheduleDisplay: schedule.display,
    timezone: String(input.timezone || '').trim() || undefined,
    repeat: {
      times: schedule.kind === 'once' ? repeatTimes ?? 1 : repeatTimes,
      completed: 0,
    },
    enabled: true,
    state: 'scheduled',
    deliver:
      input.deliver === 'telegram' || input.deliver === 'origin'
        ? input.deliver
        : 'local',
    origin: normalizeOrigin(input.origin),
    createdAt: new Date().toISOString(),
    nextRunAt: computeNextRun(schedule, undefined, String(input.timezone || '').trim() || undefined),
  }

  const jobs = await loadCronJobs()
  jobs.push(job)
  await saveCronJobs(jobs)
  return job
}

export async function listCronJobs(includeDisabled = false): Promise<CronJob[]> {
  const jobs = await loadCronJobs()
  return includeDisabled ? jobs : jobs.filter(job => job.enabled)
}

export async function getCronJob(jobId: string): Promise<CronJob | undefined> {
  return (await loadCronJobs()).find(job => job.id === jobId)
}

export async function updateCronJob(
  jobId: string,
  updates: Record<string, unknown>,
): Promise<CronJob | undefined> {
  const jobs = await loadCronJobs()
  const index = jobs.findIndex(job => job.id === jobId)
  if (index === -1) return undefined

  const current = jobs[index]!
  const next: CronJob = { ...current }
  if (typeof updates.name === 'string') next.name = updates.name.trim()
  if (typeof updates.prompt === 'string') next.prompt = updates.prompt
  if (typeof updates.timezone === 'string') {
    next.timezone = updates.timezone.trim() || undefined
  }
  if (updates.enabled !== undefined) next.enabled = Boolean(updates.enabled)
  if (updates.deliver === 'local' || updates.deliver === 'telegram' || updates.deliver === 'origin') {
    next.deliver = updates.deliver
  }
  if (typeof updates.schedule === 'string' || typeof updates.cron === 'string') {
    next.schedule = await parseSchedule(String(updates.schedule || updates.cron))
    next.scheduleDisplay = next.schedule.display
    next.nextRunAt = computeNextRun(next.schedule, next.lastRunAt, next.timezone)
  }
  if (updates.repeat !== undefined) {
    const repeatValue = Number(updates.repeat)
    next.repeat = {
      times: Number.isFinite(repeatValue) && repeatValue > 0 ? repeatValue : undefined,
      completed: next.repeat?.completed ?? 0,
    }
  }

  if (!next.enabled && next.state !== 'completed') {
    next.state = 'paused'
  } else if (next.enabled && next.state === 'paused') {
    next.state = 'scheduled'
    next.nextRunAt = computeNextRun(next.schedule, next.lastRunAt, next.timezone)
  }

  jobs[index] = next
  await saveCronJobs(jobs)
  return next
}

export async function pauseCronJob(jobId: string): Promise<CronJob | undefined> {
  return updateCronJob(jobId, { enabled: false })
}

export async function resumeCronJob(jobId: string): Promise<CronJob | undefined> {
  return updateCronJob(jobId, { enabled: true })
}

export async function triggerCronJob(jobId: string): Promise<CronJob | undefined> {
  const jobs = await loadCronJobs()
  const index = jobs.findIndex(job => job.id === jobId)
  if (index === -1) return undefined
  jobs[index] = {
    ...jobs[index]!,
    enabled: true,
    state: 'scheduled',
    nextRunAt: new Date().toISOString(),
  }
  await saveCronJobs(jobs)
  return jobs[index]
}

export async function runCronJobNow(
  jobId: string,
  config: AgentGatewayConfig,
  deliver?: CronDelivery,
): Promise<CronJob | undefined> {
  const job = await getCronJob(jobId)
  if (!job) return undefined
  await runCronJob(
    {
      ...job,
      enabled: true,
      state: job.state === 'completed' ? 'scheduled' : job.state,
    },
    config,
    deliver,
  )
  return getCronJob(jobId)
}

export async function deleteCronJob(jobId: string): Promise<boolean> {
  const jobs = await loadCronJobs()
  const next = jobs.filter(job => job.id !== jobId)
  if (next.length === jobs.length) return false
  await saveCronJobs(next)
  return true
}

function normalizeOrigin(value: unknown): CronJob['origin'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const platform = String(record.platform || '').trim()
  const chatId = String(record.chatId || record.chat_id || '').trim()
  if (!platform || !chatId) return undefined
  return { platform, chatId }
}

export function computeNextRun(
  schedule: CronSchedule,
  lastRunAt?: string,
  timezone?: string,
): string | null {
  const now = new Date()

  if (schedule.kind === 'once') {
    return lastRunAt ? null : schedule.runAt
  }

  if (schedule.kind === 'interval') {
    const base = lastRunAt ? new Date(lastRunAt) : now
    return new Date(base.getTime() + schedule.minutes * 60_000).toISOString()
  }

  return nextCronRun(schedule.expr, now, timezone)?.toISOString() ?? null
}

function nextCronRun(
  expr: string,
  from: Date,
  timezone?: string,
): Date | null {
  const parts = expr.split(/\s+/)
  if (parts.length !== 5 && parts.length !== 6) return null
  const hasSeconds = parts.length === 6
  const [second, minute, hour, dayOfMonth, month, dayOfWeek] = hasSeconds
    ? parts
    : ['0', ...parts]
  const candidate = new Date(from)
  candidate.setMilliseconds(0)
  candidate.setSeconds(candidate.getSeconds() + 1)

  const maxIterations = hasSeconds ? 366 * 24 * 60 * 60 : 366 * 24 * 60
  for (let i = 0; i < maxIterations; i += 1) {
    const partsForCandidate = getCronDateParts(candidate, timezone)
    if (
      cronFieldMatches(second!, partsForCandidate.second, 0, 59) &&
      cronFieldMatches(minute!, partsForCandidate.minute, 0, 59) &&
      cronFieldMatches(hour!, partsForCandidate.hour, 0, 23) &&
      cronFieldMatches(dayOfMonth!, partsForCandidate.dayOfMonth, 1, 31) &&
      cronFieldMatches(month!, partsForCandidate.month, 1, 12) &&
      cronFieldMatches(dayOfWeek!, partsForCandidate.dayOfWeek, 0, 6)
    ) {
      return candidate
    }
    if (hasSeconds) {
      candidate.setSeconds(candidate.getSeconds() + 1)
    } else {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
    }
  }

  return null
}

function getCronDateParts(
  date: Date,
  timezone: string | undefined,
): {
  second: number
  minute: number
  hour: number
  dayOfMonth: number
  month: number
  dayOfWeek: number
} {
  if (!timezone) {
    return {
      second: date.getSeconds(),
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    }
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      second: '2-digit',
      minute: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      day: '2-digit',
      month: '2-digit',
      weekday: 'short',
    }).formatToParts(date)
    const value = (type: string): string =>
      parts.find(part => part.type === type)?.value || '0'
    return {
      second: Number(value('second')),
      minute: Number(value('minute')),
      hour: Number(value('hour')),
      dayOfMonth: Number(value('day')),
      month: Number(value('month')),
      dayOfWeek: weekdayToNumber(value('weekday')),
    }
  } catch {
    return getCronDateParts(date, undefined)
  }
}

function weekdayToNumber(value: string): number {
  switch (value.toLowerCase().slice(0, 3)) {
    case 'sun':
      return 0
    case 'mon':
      return 1
    case 'tue':
      return 2
    case 'wed':
      return 3
    case 'thu':
      return 4
    case 'fri':
      return 5
    case 'sat':
      return 6
    default:
      return 0
  }
}

function cronFieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  return field.split(',').some(part => {
    if (part === '*') return true
    if (part.startsWith('*/')) {
      const step = Number(part.slice(2))
      return Number.isInteger(step) && step > 0 && (value - min) % step === 0
    }
    if (part.includes('-')) {
      const [rawStart, rawEnd] = part.split('-')
      const start = Number(rawStart)
      const end = Number(rawEnd)
      return value >= start && value <= end
    }
    const numeric = Number(part)
    return numeric >= min && numeric <= max && value === numeric
  })
}

async function getDueJobs(): Promise<CronJob[]> {
  const now = Date.now()
  const jobs = await loadCronJobs()
  return jobs.filter(job => {
    if (!job.enabled || !job.nextRunAt) return false
    return new Date(job.nextRunAt).getTime() <= now
  })
}

async function markJobRun(
  jobId: string,
  result: {
    success: boolean
    error?: string
    outputFile?: string
  },
): Promise<void> {
  const jobs = await loadCronJobs()
  const index = jobs.findIndex(job => job.id === jobId)
  if (index === -1) return

  const job = jobs[index]!
  const now = new Date().toISOString()
  const completed = (job.repeat?.completed ?? 0) + 1
  const times = job.repeat?.times

  if (times !== undefined && completed >= times) {
    jobs[index] = {
      ...job,
      enabled: false,
      state: 'completed',
      repeat: { times, completed },
      nextRunAt: null,
      lastRunAt: now,
      lastStatus: result.success ? 'ok' : 'error',
      lastError: result.success ? undefined : result.error,
      lastOutputFile: result.outputFile,
    }
  } else {
    jobs[index] = {
      ...job,
      repeat: { times, completed },
      nextRunAt: computeNextRun(job.schedule, now, job.timezone),
      lastRunAt: now,
      lastStatus: result.success ? 'ok' : 'error',
      lastError: result.success ? undefined : result.error,
      lastOutputFile: result.outputFile,
    }
  }

  await saveCronJobs(jobs)
}

async function saveJobOutput(job: CronJob, output: string): Promise<string> {
  const dir = join(outputDir(), job.id)
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}.md`)
  await writeFile(file, output, 'utf8')
  return file
}

async function runCronJob(
  job: CronJob,
  config: AgentGatewayConfig,
  deliver?: CronDelivery,
): Promise<void> {
  const prompt = [
    '[SYSTEM: You are running as a scheduled OpenClaude cron job. Your final response is saved locally. If you have nothing new or noteworthy to report, respond with exactly "[SILENT]" (optionally followed by a brief internal note). This suppresses delivery to Telegram while still saving output locally. Only use [SILENT] when there are genuinely no changes worth reporting.]',
    '',
    'Note: The agent cannot see Telegram delivery metadata and therefore cannot respond to it.',
    '',
    job.prompt,
  ].join('\n')

  const result = await runOpenClaudeAgent({
    prompt,
    config,
  })
  const success = result.exitCode === 0
  const finalText = success ? result.text : result.stderr || 'Agent run failed'
  const output = [
    `# Cron Job: ${job.name}`,
    '',
    `**Job ID:** ${job.id}`,
    `**Run Time:** ${new Date().toISOString()}`,
    `**Schedule:** ${job.scheduleDisplay}`,
    ...(job.timezone ? [`**Timezone:** ${job.timezone}`] : []),
    '',
    '## Prompt',
    '',
    job.prompt,
    '',
    success ? '## Response' : '## Error',
    '',
    finalText || '(No response generated)',
    '',
  ].join('\n')
  const outputFile = await saveJobOutput(job, output)

  if (
    success &&
    finalText.trim() &&
    !isSilentCronResponse(finalText) &&
    (job.deliver === 'telegram' || job.deliver === 'origin')
  ) {
    await deliver?.(finalText, job)
  }

  await markJobRun(job.id, {
    success,
    error: success ? undefined : finalText,
    outputFile,
  })
}

function isSilentCronResponse(text: string): boolean {
  return text.trim().toUpperCase().startsWith(SILENT_MARKER)
}

export function startCronScheduler(
  config: AgentGatewayConfig,
  deliver?: CronDelivery,
): CronSchedulerHandle {
  let running = false
  let stopped = false

  const tick = async (): Promise<number> => {
    if (running || stopped) return 0
    running = true
    try {
      const due = await getDueJobs()
      for (const job of due) {
        await runCronJob(job, config, deliver)
      }
      return due.length
    } finally {
      running = false
    }
  }

  const timer = setInterval(
    () => void tick(),
    Math.max(1, config.cron.tickIntervalSeconds) * 1000,
  )
  void tick()

  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
    tick,
  }
}
