import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { open, readFile, unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import treeKill from 'tree-kill'
import { argsBeforeDelimiter } from '../utils/cliArgs.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import {
  assertBackgroundSessionNameAvailable,
  backgroundSessionLogExists,
  createBackgroundSession,
  ensureBackgroundSessionDirs,
  getBackgroundSessionLogPaths,
  listBackgroundSessions,
  markBackgroundSessionKilled,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
} from './bgRegistry.js'

export type ParsedBackgroundInvocation = {
  name?: string
  prompt?: string
  childArgs: string[]
}

export type ParsedLogsInvocation = {
  target?: string
  follow: boolean
  stream: 'stdout' | 'stderr'
}

export type BackgroundChildProcessConfig = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export type BuildBackgroundChildProcessConfigInput = {
  execPath: string
  execArgv: string[]
  entrypoint: string
  childArgs: string[]
  processEnv: NodeJS.ProcessEnv
  sessionName?: string
  stdoutLogPath: string
}

type PrResumeSelector = true | string

export type BuildBackgroundSessionLaunchDeps = {
  resolvePrResumeSessionId?: (
    selector: PrResumeSelector,
  ) => Promise<string | null | undefined>
}

const HEAP_RELAUNCHED_ENV = 'OPENCLAUDE_HEAP_RELAUNCHED'
const DEFAULT_TERM_GRACE_MS = 2_000
const DEFAULT_KILL_GRACE_MS = 2_000
const DEFAULT_KILL_POLL_INTERVAL_MS = 100

// This must stay in sync with value-consuming CLI flags in main.tsx and related
// handlers. If the CLI flag definitions become centralized, move this parser
// metadata there instead of maintaining a second hand-written list.
const REQUIRED_OPTION_VALUE_FLAGS = new Set([
  '--add-dir',
  '--agent',
  '--agents',
  '--allowed-tools',
  '--allowedTools',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--betas',
  '--debug-file',
  '--disallowed-tools',
  '--disallowedTools',
  '--effort',
  '--fallback-model',
  '--file',
  '--input-format',
  '--json-schema',
  '--max-budget-usd',
  '--max-turns',
  '--mcp-config',
  '--model',
  '--name',
  '--output-format',
  '--permission-mode',
  '--permission-prompt-tool',
  '--plugin-dir',
  '--prefill',
  '--provider',
  '--resume-session-at',
  '--rewind-files',
  '--session-id',
  '--setting-sources',
  '--settings',
  '--system-prompt',
  '--system-prompt-file',
  '--task-budget',
  '--tools',
  '--workload',
  '-n',
])

const INLINE_OPTIONAL_VALUE_FLAGS = new Set([
  '--debug',
  '-d',
])

const SPACE_OPTIONAL_VALUE_FLAGS = new Set([
  '--from-pr',
  '--resume',
  '-r',
])

function safeNodeExecArgvForBackground(execArgv: string[]): string[] {
  return execArgv.filter(
    arg =>
      arg === '--expose-gc' ||
      arg.startsWith('--max-old-space-size') ||
      arg.startsWith('--heapsnapshot-near-heap-limit'),
  )
}

export function buildBackgroundChildProcessConfig(
  input: BuildBackgroundChildProcessConfigInput,
): BackgroundChildProcessConfig {
  const env: NodeJS.ProcessEnv = {
    ...input.processEnv,
    CLAUDE_CODE_ENTRYPOINT: 'bg',
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_CODE_SESSION_LOG: input.stdoutLogPath,
    ...(input.sessionName
      ? { CLAUDE_CODE_SESSION_NAME: input.sessionName }
      : {}),
  }
  delete env[HEAP_RELAUNCHED_ENV]

  return {
    command: input.execPath,
    args: [
      ...safeNodeExecArgvForBackground(input.execArgv),
      input.entrypoint,
      ...input.childArgs,
    ],
    env,
  }
}

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function resolveSessionOrExit(target: string) {
  try {
    return await resolveBackgroundSession(target)
  } catch (error) {
    fail(errorMessage(error))
  }
}

function stripBackgroundFlag(args: string[]): string[] {
  const delimiterIndex = args.indexOf('--')
  const head = delimiterIndex === -1 ? args : args.slice(0, delimiterIndex)
  const tail = delimiterIndex === -1 ? [] : args.slice(delimiterIndex)
  return [
    ...head.filter(arg => arg !== '--bg' && arg !== '--background'),
    ...tail,
  ]
}

function findPromptIndex(args: string[]): number {
  const dashDash = args.indexOf('--')
  if (dashDash !== -1) {
    return dashDash + 1 < args.length ? dashDash + 1 : -1
  }

  const consumedValues = new Set<number>()
  for (let i = 0; i < args.length - 1; i++) {
    const arg = args[i]
    if (REQUIRED_OPTION_VALUE_FLAGS.has(arg)) {
      consumedValues.add(i + 1)
      i++
      continue
    }
    if (SPACE_OPTIONAL_VALUE_FLAGS.has(arg)) {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        consumedValues.add(i + 1)
        i++
      }
      continue
    }
    if (INLINE_OPTIONAL_VALUE_FLAGS.has(arg)) {
      // Keep debug filters inline-only here so `--debug "prompt"` remains a
      // background prompt instead of being consumed as a logging filter.
      continue
    }
  }

  for (let i = args.length - 1; i >= 0; i--) {
    if (consumedValues.has(i)) continue
    const arg = args[i]
    if (arg === '--') continue
    if (!arg.startsWith('-')) return i
  }
  return -1
}

function findFlagValue(args: string[], flag: string): string | undefined {
  const inlinePrefix = `${flag}=`
  const searchable = argsBeforeDelimiter(args)
  for (let i = 0; i < searchable.length; i++) {
    const arg = searchable[i]
    if (arg.startsWith(inlinePrefix)) return arg.slice(inlinePrefix.length)
    if (
      arg === flag &&
      i + 1 < searchable.length &&
      !searchable[i + 1]?.startsWith('-')
    ) {
      return searchable[i + 1]
    }
  }
  return undefined
}

function findSessionName(args: string[]): string | undefined {
  return findFlagValue(args, '--name') ?? findFlagValue(args, '-n')
}

function hasPrintMode(args: string[]): boolean {
  const searchable = argsBeforeDelimiter(args)
  return searchable.includes('--print') || searchable.includes('-p')
}

function insertBeforePrompt(args: string[], values: string[]): string[] {
  const next = [...args]
  const delimiterIndex = next.indexOf('--')
  const insertionIndex =
    delimiterIndex === -1
      ? findPromptIndex(next)
      : delimiterIndex
  next.splice(insertionIndex === -1 ? next.length : insertionIndex, 0, ...values)
  return next
}

function withGeneratedSessionId(args: string[], sessionId: string): string[] {
  if (findFlagValue(args, '--session-id')) return args
  return insertBeforePrompt(args, ['--session-id', sessionId])
}

function hasForkSession(args: string[]): boolean {
  return argsBeforeDelimiter(args).includes('--fork-session')
}

function findFromPrSelector(args: string[]): PrResumeSelector | undefined {
  const searchable = argsBeforeDelimiter(args)
  const inlinePrefix = '--from-pr='
  for (let i = 0; i < searchable.length; i++) {
    const arg = searchable[i]
    if (arg.startsWith(inlinePrefix)) {
      return arg.slice(inlinePrefix.length) || true
    }
    if (arg === '--from-pr') {
      const next = searchable[i + 1]
      return next && !next.startsWith('-') ? next : true
    }
  }
  return undefined
}

function hasResumeSource(args: string[]): boolean {
  return Boolean(
    findFlagValue(args, '--resume') ??
      findFlagValue(args, '-r') ??
      findFromPrSelector(args),
  )
}

async function resolvePrResumeSessionId(
  selector: PrResumeSelector,
  deps: BuildBackgroundSessionLaunchDeps,
): Promise<string | null | undefined> {
  if (deps.resolvePrResumeSessionId) {
    return deps.resolvePrResumeSessionId(selector)
  }
  const { findResumeSessionIdByPrSelector } = await import(
    '../utils/conversationRecovery.js'
  )
  return findResumeSessionIdByPrSelector(selector)
}

export async function buildBackgroundSessionLaunch(
  childArgs: string[],
  generatedSessionId: string,
  deps: BuildBackgroundSessionLaunchDeps = {},
): Promise<{ childArgs: string[]; sessionId: string }> {
  const explicitSessionId = findFlagValue(childArgs, '--session-id')
  if (explicitSessionId) {
    return { childArgs, sessionId: explicitSessionId }
  }

  const resumeSessionId =
    findFlagValue(childArgs, '--resume') ?? findFlagValue(childArgs, '-r')
  if (resumeSessionId && !hasForkSession(childArgs)) {
    return { childArgs, sessionId: resumeSessionId }
  }

  const fromPrSelector = findFromPrSelector(childArgs)
  if (fromPrSelector !== undefined && !hasForkSession(childArgs)) {
    const sessionId = await resolvePrResumeSessionId(fromPrSelector, deps)
    if (!sessionId) {
      const description =
        fromPrSelector === true ? 'any PR' : `PR selector: ${fromPrSelector}`
      throw new Error(`No conversation found linked to ${description}`)
    }
    return { childArgs, sessionId }
  }

  return {
    childArgs: withGeneratedSessionId(childArgs, generatedSessionId),
    sessionId: generatedSessionId,
  }
}

export function parseBackgroundInvocation(
  args: string[],
): ParsedBackgroundInvocation {
  let childArgs = stripBackgroundFlag(args)
  const name = findSessionName(childArgs)?.trim() || undefined
  const promptIndex = findPromptIndex(childArgs)
  const prompt = promptIndex === -1 ? undefined : childArgs[promptIndex]

  if (!hasPrintMode(childArgs)) {
    childArgs = insertBeforePrompt(childArgs, ['--print'])
  }

  return {
    ...(name ? { name } : {}),
    ...(prompt ? { prompt } : {}),
    childArgs,
  }
}

export function parseLogsInvocation(args: string[]): ParsedLogsInvocation {
  let follow = false
  let stream: ParsedLogsInvocation['stream'] = 'stdout'
  let target: string | undefined

  for (const arg of args) {
    if (arg === '-f' || arg === '--follow') {
      follow = true
      continue
    }
    if (arg === '--stderr') {
      stream = 'stderr'
      continue
    }
    if (arg === '--stdout') {
      stream = 'stdout'
      continue
    }
    target ??= arg
  }

  return { target, follow, stream }
}

function backgroundSessionId(): string {
  return `bg-${randomUUID().slice(0, 8)}`
}

function formatCommand(command: string[]): string {
  return command
    .map(part => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(' ')
}

function printSessionTable(
  sessions: Awaited<ReturnType<typeof listBackgroundSessions>>,
): void {
  if (sessions.length === 0) {
    console.log('No background sessions.')
    return
  }

  const rows = [
    ['ID', 'STATUS', 'PID', 'NAME', 'STARTED', 'CWD'],
    ...sessions.map(session => [
      session.id,
      session.status,
      String(session.pid),
      session.name ?? '-',
      session.startedAt,
      session.cwd,
    ]),
  ]
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map(row => row[col].length)),
  )

  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '))
  }
}

async function printExistingLog(path: string): Promise<number> {
  try {
    const contents = await readFile(path)
    if (contents.length > 0) process.stdout.write(contents)
    return contents.length
  } catch {
    return 0
  }
}

async function followLogFile(path: string, offset: number): Promise<void> {
  let position = offset
  let reading = false

  await new Promise<void>(resolve => {
    const cleanup = () => {
      clearInterval(timer)
      process.off('SIGINT', cleanup)
      process.off('SIGTERM', cleanup)
      resolve()
    }

    const timer = setInterval(() => {
      if (reading) return
      reading = true
      void (async () => {
        try {
          const handle = await open(path, 'r')
          try {
            const { size } = await handle.stat()
            if (size < position) position = 0
            if (size > position) {
              const buffer = Buffer.alloc(size - position)
              await handle.read(buffer, 0, buffer.length, position)
              position = size
              process.stdout.write(buffer)
            }
          } finally {
            await handle.close()
          }
        } catch {
          // Keep following; the child may create or rotate the file later.
        } finally {
          reading = false
        }
      })()
    }, 500)

    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  })
}

function normalizeArgs(args: string[] | string | undefined): string[] {
  if (Array.isArray(args)) return args
  return args ? [args] : []
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function treeKillAsync(pid: number, signal: string | number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    treeKill(pid, signal, error => {
      if (error && isProcessRunning(pid)) {
        reject(error)
        return
      }
      // The process may exit naturally after the liveness check but before
      // tree-kill reaches it; that race is already the requested outcome.
      resolve()
    })
  })
}

async function waitForProcessExit(
  pid: number,
  options: {
    isProcessAlive: (pid: number) => boolean
    sleep: (ms: number) => Promise<void>
    graceMs: number
    pollIntervalMs: number
  },
): Promise<boolean> {
  const attempts = Math.max(
    1,
    Math.ceil(options.graceMs / options.pollIntervalMs),
  )
  for (let i = 0; i < attempts; i++) {
    if (!options.isProcessAlive(pid)) return true
    await options.sleep(options.pollIntervalMs)
  }
  return !options.isProcessAlive(pid)
}

export async function terminateBackgroundProcessTree(
  pid: number,
  options?: {
    isProcessAlive?: (pid: number) => boolean
    killTree?: (pid: number, signal: string | number) => Promise<void>
    sleep?: (ms: number) => Promise<void>
    termGraceMs?: number
    killGraceMs?: number
    pollIntervalMs?: number
  },
): Promise<void> {
  const isProcessAlive = options?.isProcessAlive ?? isProcessRunning
  const killTree = options?.killTree ?? treeKillAsync
  const sleepFn = options?.sleep ?? sleep
  const pollIntervalMs =
    options?.pollIntervalMs ?? DEFAULT_KILL_POLL_INTERVAL_MS

  if (!isProcessAlive(pid)) return
  await killTree(pid, 'SIGTERM')
  if (
    await waitForProcessExit(pid, {
      isProcessAlive,
      sleep: sleepFn,
      graceMs: options?.termGraceMs ?? DEFAULT_TERM_GRACE_MS,
      pollIntervalMs,
    })
  ) {
    return
  }

  await killTree(pid, 'SIGKILL')
  if (
    await waitForProcessExit(pid, {
      isProcessAlive,
      sleep: sleepFn,
      graceMs: options?.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      pollIntervalMs,
    })
  ) {
    return
  }

  throw new Error(`Process ${pid} did not exit after SIGKILL`)
}

export async function psHandler(_args: string[]): Promise<void> {
  const sessions = await refreshBackgroundSessionStatuses()
  printSessionTable(sessions)
}

export async function logsHandler(
  args: string[] | string | undefined,
): Promise<void> {
  const parsed = parseLogsInvocation(normalizeArgs(args))
  if (!parsed.target) fail('Usage: openclaude logs <id-or-name> [-f]')

  await refreshBackgroundSessionStatuses()
  const session = await resolveSessionOrExit(parsed.target)
  const logPath =
    parsed.stream === 'stderr' ? session.stderrLogPath : session.stdoutLogPath

  if (!(await backgroundSessionLogExists(logPath))) {
    fail(`Log file does not exist: ${logPath}`)
  }

  const offset = await printExistingLog(logPath)
  if (parsed.follow) {
    await followLogFile(logPath, offset)
  }
}

export async function attachHandler(
  args: string[] | string | undefined,
): Promise<void> {
  const target = normalizeArgs(args)[0]
  if (!target) fail('Usage: openclaude attach <id-or-name>')

  await refreshBackgroundSessionStatuses()
  const session = await resolveSessionOrExit(target)
  console.error(
    `Attach is not implemented for local background sessions yet. Use \`openclaude logs ${session.id} -f\` to follow output.`,
  )
  process.exitCode = 1
}

export async function killHandler(
  args: string[] | string | undefined,
): Promise<void> {
  const target = normalizeArgs(args)[0]
  if (!target) fail('Usage: openclaude kill <id-or-name>')

  await refreshBackgroundSessionStatuses()
  const session = await resolveSessionOrExit(target)
  if (session.status === 'unknown' && isProcessRunning(session.pid)) {
    fail(
      `Cannot safely kill background session ${session.id}: process identity could not be verified`,
    )
  }
  if (session.status === 'running' && isProcessRunning(session.pid)) {
    await terminateBackgroundProcessTree(session.pid).catch(error => {
      fail(
        `Failed to kill background session ${session.id}: ${errorMessage(error)}`,
      )
    })
  }

  const killed = await markBackgroundSessionKilled(session.id)
  console.log(`Killed background session ${killed.id}.`)
}

export async function handleBgFlag(args: string[]): Promise<void> {
  const parsed = parseBackgroundInvocation(args)
  if (!parsed.prompt && !hasResumeSource(parsed.childArgs)) {
    fail('Usage: openclaude --bg [--name <name>] "<prompt>"')
  }

  try {
    await assertBackgroundSessionNameAvailable(parsed.name)
  } catch (error) {
    fail(errorMessage(error))
  }

  const id = backgroundSessionId()
  const { childArgs, sessionId } = await buildBackgroundSessionLaunch(
    parsed.childArgs,
    randomUUID(),
  ).catch(error => {
    fail(errorMessage(error))
  })
  const logPaths = getBackgroundSessionLogPaths(id)
  await ensureBackgroundSessionDirs()
  const entrypoint = process.argv[1]
  if (!entrypoint) {
    fail('Cannot determine OpenClaude entrypoint for background session')
  }
  const childConfig = buildBackgroundChildProcessConfig({
    execPath: process.execPath,
    execArgv: process.execArgv,
    entrypoint,
    childArgs,
    processEnv: process.env,
    sessionName: parsed.name,
    stdoutLogPath: logPaths.stdoutLogPath,
  })

  let stdoutFd: number | undefined
  let stderrFd: number | undefined
  let createdStdoutLog = false
  let createdStderrLog = false
  const cleanupCreatedLogs = async () => {
    if (createdStdoutLog) await unlink(logPaths.stdoutLogPath).catch(() => {})
    if (createdStderrLog) await unlink(logPaths.stderrLogPath).catch(() => {})
  }
  let child
  try {
    stdoutFd = openSync(logPaths.stdoutLogPath, 'wx')
    createdStdoutLog = true
    stderrFd = openSync(logPaths.stderrLogPath, 'wx')
    createdStderrLog = true
    child = spawn(childConfig.command, childConfig.args, {
      cwd: process.cwd(),
      detached: true,
      env: childConfig.env,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
    child.unref()
  } catch (error) {
    if (stdoutFd !== undefined) {
      closeSync(stdoutFd)
      stdoutFd = undefined
    }
    if (stderrFd !== undefined) {
      closeSync(stderrFd)
      stderrFd = undefined
    }
    await cleanupCreatedLogs()
    fail(`Failed to start background session: ${errorMessage(error)}`)
  } finally {
    if (stdoutFd !== undefined) closeSync(stdoutFd)
    if (stderrFd !== undefined) closeSync(stderrFd)
  }

  if (!child.pid) {
    await cleanupCreatedLogs()
    fail('Failed to start background session')
  }

  const command = [childConfig.command, ...childConfig.args]
  const session = await createBackgroundSession({
    id,
    name: parsed.name,
    pid: child.pid,
    cwd: process.cwd(),
    command,
    provider: findFlagValue(childArgs, '--provider'),
    model: findFlagValue(childArgs, '--model'),
    sessionId,
    stdoutLogPath: logPaths.stdoutLogPath,
    stderrLogPath: logPaths.stderrLogPath,
    logFilesPrecreated: true,
  }).catch(async error => {
    await terminateBackgroundProcessTree(child.pid!).catch(() => {})
    await cleanupCreatedLogs()
    fail(errorMessage(error))
  })

  console.log(`Started background session ${session.id}.`)
  if (session.name) console.log(`Name: ${session.name}`)
  console.log(`PID: ${session.pid}`)
  console.log(`Logs: ${session.stdoutLogPath}`)
  console.log(`Follow: openclaude logs ${session.id} -f`)
  console.log(
    `Command: ${formatCommand([basename(childConfig.command), ...childConfig.args])}`,
  )
}
