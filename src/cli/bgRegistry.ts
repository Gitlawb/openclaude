import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  getProcessCommand,
  isProcessRunning,
} from '../utils/genericProcessUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

export type BackgroundSessionStatus =
  | 'running'
  | 'unknown'
  | 'exited'
  | 'failed'
  | 'stale'
  | 'killed'

export type BackgroundSession = {
  id: string
  name?: string
  pid: number
  cwd: string
  status: BackgroundSessionStatus
  provider?: string
  model?: string
  sessionId: string
  startedAt: string
  updatedAt: string
  command: string[]
  stdoutLogPath: string
  stderrLogPath: string
}

export type CreateBackgroundSessionInput = {
  id: string
  name?: string
  pid: number
  cwd: string
  command: string[]
  provider?: string
  model?: string
  sessionId: string
  now?: Date
  stdoutLogPath?: string
  stderrLogPath?: string
  logFilesPrecreated?: boolean
}

type BackgroundSessionNameReservation = {
  name: string
  id: string
  creatorPid?: number
  createdAt?: string
}

const TERMINAL_STATUSES = new Set<BackgroundSessionStatus>([
  'exited',
  'failed',
  'stale',
  'killed',
])
const ALL_STATUSES = new Set<BackgroundSessionStatus>([
  'running',
  'unknown',
  ...TERMINAL_STATUSES,
])
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/
let backgroundSessionsRootForTesting: string | undefined

export function _setBackgroundSessionsRootForTesting(
  root: string | undefined,
): void {
  backgroundSessionsRootForTesting = root?.normalize('NFC')
}

function getBackgroundSessionsRoot(): string {
  if (backgroundSessionsRootForTesting) {
    return backgroundSessionsRootForTesting
  }
  return join(getClaudeConfigHomeDir(), 'bg-sessions')
}

function getBackgroundSessionMetadataDir(): string {
  return join(getBackgroundSessionsRoot(), 'sessions')
}

function getBackgroundSessionLogsDir(): string {
  return join(getBackgroundSessionsRoot(), 'logs')
}

function getBackgroundSessionNamesDir(): string {
  return join(getBackgroundSessionsRoot(), 'names')
}

function metadataPathForId(id: string): string {
  assertSafeId(id)
  return join(getBackgroundSessionMetadataDir(), `${id}.json`)
}

function nameReservationPathForName(name: string): string {
  const digest = createHash('sha256').update(name).digest('hex')
  return join(getBackgroundSessionNamesDir(), `${digest}.json`)
}

function assertSafeId(id: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid background session id: ${id}`)
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  )
}

function iso(now: Date | undefined): string {
  return (now ?? new Date()).toISOString()
}

export function getBackgroundSessionLogPaths(id: string): {
  stdoutLogPath: string
  stderrLogPath: string
} {
  assertSafeId(id)
  const logsDir = getBackgroundSessionLogsDir()
  return {
    stdoutLogPath: join(logsDir, `${id}.out.log`),
    stderrLogPath: join(logsDir, `${id}.err.log`),
  }
}

export async function ensureBackgroundSessionDirs(): Promise<void> {
  await mkdir(getBackgroundSessionMetadataDir(), {
    recursive: true,
    mode: 0o700,
  })
  await mkdir(getBackgroundSessionLogsDir(), { recursive: true, mode: 0o700 })
  await mkdir(getBackgroundSessionNamesDir(), { recursive: true, mode: 0o700 })
}

async function writeSession(session: BackgroundSession): Promise<void> {
  await ensureBackgroundSessionDirs()
  const target = metadataPathForId(session.id)
  const tmp = join(
    getBackgroundSessionMetadataDir(),
    `${session.id}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(tmp, jsonStringify(session), { flag: 'wx' })
    await rename(tmp, target)
    if (session.name && isTerminalBackgroundSession(session)) {
      await releaseNameReservation(session.name, session.id)
    }
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

async function writeNewSession(session: BackgroundSession): Promise<void> {
  await ensureBackgroundSessionDirs()
  try {
    await writeFile(metadataPathForId(session.id), jsonStringify(session), {
      flag: 'wx',
    })
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      throw new Error(`Background session id "${session.id}" already exists`)
    }
    throw error
  }
}

async function readSessionFile(path: string): Promise<BackgroundSession | null> {
  try {
    const parsed = jsonParse(await readFile(path, 'utf8'))
    return isBackgroundSession(parsed, basename(path, '.json')) ? parsed : null
  } catch {
    return null
  }
}

async function readNameReservation(
  path: string,
): Promise<BackgroundSessionNameReservation | null> {
  try {
    const parsed = jsonParse(await readFile(path, 'utf8'))
    const candidate = parsed as Partial<BackgroundSessionNameReservation>
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof candidate.name === 'string' &&
      typeof candidate.id === 'string' &&
      SAFE_ID_RE.test(candidate.id) &&
      (candidate.creatorPid === undefined ||
        (typeof candidate.creatorPid === 'number' &&
          Number.isInteger(candidate.creatorPid) &&
          candidate.creatorPid > 1)) &&
      (candidate.createdAt === undefined ||
        typeof candidate.createdAt === 'string')
    ) {
      return parsed as BackgroundSessionNameReservation
    }
  } catch {
    // Malformed reservations are treated as recoverable orphans below.
  }
  return null
}

async function releaseNameReservation(
  name: string,
  id: string,
): Promise<void> {
  const path = nameReservationPathForName(name)
  const existing = await readNameReservation(path)
  if (existing?.id !== id) return
  await unlink(path).catch(() => {})
}

async function unlinkStaleNameReservation(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
}

async function releaseStaleNameReservation(
  name: string,
  id: string,
): Promise<void> {
  const path = nameReservationPathForName(name)
  const existing = await readNameReservation(path)
  if (existing?.id !== id) return
  await unlinkStaleNameReservation(path)
}

async function isLiveNameReservation(
  name: string,
  reservation: BackgroundSessionNameReservation | null,
): Promise<boolean> {
  if (!reservation) return false
  if (reservation.name !== name) return false

  const owner = await readSessionFile(metadataPathForId(reservation.id))
  if (owner) {
    return owner.name === name && !isTerminalBackgroundSession(owner)
  }

  return (
    typeof reservation.creatorPid === 'number' &&
    isProcessRunning(reservation.creatorPid)
  )
}

async function reserveBackgroundSessionName(
  name: string,
  id: string,
): Promise<() => Promise<void>> {
  const path = nameReservationPathForName(name)
  const reservation = jsonStringify({
    name,
    id,
    creatorPid: process.pid,
    createdAt: iso(undefined),
  })

  while (true) {
    try {
      await writeFile(path, reservation, { flag: 'wx' })
      return () => releaseNameReservation(name, id)
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error

      const existing = await readNameReservation(path)
      if (!(await isLiveNameReservation(name, existing))) {
        if (existing) {
          await releaseStaleNameReservation(name, existing.id)
        } else {
          await unlinkStaleNameReservation(path)
        }
        continue
      }

      const suffix =
        existing && existing.name === name ? ` (${existing.id})` : ''
      throw new Error(
        `Background session name "${name}" already exists${suffix}`,
      )
    }
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isBackgroundSession(
  value: unknown,
  expectedId: string,
): value is BackgroundSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BackgroundSession>

  return (
    typeof candidate.id === 'string' &&
    SAFE_ID_RE.test(candidate.id) &&
    candidate.id === expectedId &&
    typeof candidate.pid === 'number' &&
    Number.isInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.cwd === 'string' &&
    typeof candidate.status === 'string' &&
    ALL_STATUSES.has(candidate.status as BackgroundSessionStatus) &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.provider === undefined ||
      typeof candidate.provider === 'string') &&
    (candidate.model === undefined || typeof candidate.model === 'string') &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    isStringArray(candidate.command) &&
    typeof candidate.stdoutLogPath === 'string' &&
    typeof candidate.stderrLogPath === 'string'
  )
}

export async function listBackgroundSessions(): Promise<BackgroundSession[]> {
  let entries: string[]
  try {
    entries = await readdir(getBackgroundSessionMetadataDir())
  } catch {
    return []
  }

  const sessions: BackgroundSession[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const session = await readSessionFile(
      join(getBackgroundSessionMetadataDir(), entry),
    )
    if (session) sessions.push(session)
  }

  return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export async function assertBackgroundSessionNameAvailable(
  name: string | undefined,
): Promise<void> {
  if (!name) return
  const existing = (await listBackgroundSessions()).find(
    s => s.name === name && !isTerminalBackgroundSession(s),
  )
  if (existing) {
    throw new Error(
      `Background session name "${name}" already exists (${existing.id})`,
    )
  }
}

export async function createBackgroundSession(
  input: CreateBackgroundSessionInput,
): Promise<BackgroundSession> {
  if (!Number.isInteger(input.pid) || input.pid <= 0) {
    throw new Error(`Invalid background session pid: ${input.pid}`)
  }
  await assertBackgroundSessionNameAvailable(input.name)
  const timestamp = iso(input.now)
  const logPaths = getBackgroundSessionLogPaths(input.id)
  const session: BackgroundSession = {
    id: input.id,
    ...(input.name ? { name: input.name } : {}),
    pid: input.pid,
    cwd: input.cwd,
    status: 'running',
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    sessionId: input.sessionId,
    startedAt: timestamp,
    updatedAt: timestamp,
    command: input.command,
    stdoutLogPath: input.stdoutLogPath ?? logPaths.stdoutLogPath,
    stderrLogPath: input.stderrLogPath ?? logPaths.stderrLogPath,
  }

  await ensureBackgroundSessionDirs()
  let createdStdoutLog = false
  let createdStderrLog = false
  let releaseReservedName: (() => Promise<void>) | undefined
  try {
    releaseReservedName = input.name
      ? await reserveBackgroundSessionName(input.name, input.id)
      : undefined
    if (input.logFilesPrecreated) {
      if (!(await backgroundSessionLogExists(session.stdoutLogPath))) {
        throw new Error(
          `Background session log file does not exist: ${session.stdoutLogPath}`,
        )
      }
      if (!(await backgroundSessionLogExists(session.stderrLogPath))) {
        throw new Error(
          `Background session log file does not exist: ${session.stderrLogPath}`,
        )
      }
    } else {
      await writeFile(session.stdoutLogPath, '', { flag: 'wx' })
      createdStdoutLog = true
      await writeFile(session.stderrLogPath, '', { flag: 'wx' })
      createdStderrLog = true
    }
    await writeNewSession(session)
  } catch (error) {
    if (createdStdoutLog) await unlink(session.stdoutLogPath).catch(() => {})
    if (createdStderrLog) await unlink(session.stderrLogPath).catch(() => {})
    await releaseReservedName?.()
    if (isErrno(error, 'EEXIST')) {
      throw new Error(`Background session id "${session.id}" already exists`)
    }
    throw error
  }
  return session
}

export async function resolveBackgroundSession(
  target: string,
): Promise<BackgroundSession> {
  const sessions = await listBackgroundSessions()
  const exactId = sessions.filter(s => s.id === target)
  if (exactId.length === 1) return exactId[0]

  const idPrefix = sessions.filter(s => s.id.startsWith(target))
  if (idPrefix.length === 1) return idPrefix[0]
  if (idPrefix.length > 1) {
    throw new Error(`Background session id "${target}" is ambiguous`)
  }

  const byName = sessions.filter(s => s.name === target)
  const liveByName = byName.filter(s => !isTerminalBackgroundSession(s))
  if (liveByName.length === 1) return liveByName[0]
  if (liveByName.length > 1) {
    throw new Error(`Background session name "${target}" is ambiguous`)
  }
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    throw new Error(`Background session name "${target}" is ambiguous`)
  }

  throw new Error(`No background session found for "${target}"`)
}

export async function refreshBackgroundSessionStatuses(options?: {
  isProcessAlive?: (pid: number) => boolean
  getProcessCommand?: (pid: number) => string | null
  now?: Date
}): Promise<BackgroundSession[]> {
  const timestamp = iso(options?.now)
  const sessions = await listBackgroundSessions()
  const refreshed: BackgroundSession[] = []

  for (const session of sessions) {
    if (session.status !== 'running' && session.status !== 'unknown') {
      refreshed.push(session)
      continue
    }

    const processState = getBackgroundSessionProcessState(session, options)
    const nextStatus: BackgroundSessionStatus =
      processState === 'alive'
        ? 'running'
        : processState === 'unknown'
          ? 'unknown'
          : 'stale'

    if (session.status !== nextStatus) {
      const updated = {
        ...session,
        status: nextStatus,
        updatedAt: timestamp,
      }
      await writeSession(updated)
      refreshed.push(updated)
      continue
    }

    refreshed.push(session)
  }

  return refreshed
}

type BackgroundSessionProcessState = 'alive' | 'dead' | 'unknown'

function commandLineContainsArgs(commandLine: string, args: string[]): boolean {
  if (args.length === 0) return false
  let offset = 0
  for (const arg of args) {
    const index = commandLine.indexOf(arg, offset)
    if (index === -1) return false
    offset = index + arg.length
  }
  return true
}

function commandLineMatchesBackgroundSession(
  commandLine: string,
  session: BackgroundSession,
): boolean {
  if (commandLine.includes(session.sessionId)) return true
  // PR resume launches write to the resumed transcript id without carrying
  // that id on argv, so use the stored launch invocation as the PID guard.
  return commandLineContainsArgs(commandLine, session.command)
}

function getBackgroundSessionProcessState(
  session: BackgroundSession,
  options?: {
    isProcessAlive?: (pid: number) => boolean
    getProcessCommand?: (pid: number) => string | null
  },
): BackgroundSessionProcessState {
  const isAlive = options?.isProcessAlive ?? isProcessRunning
  if (!isAlive(session.pid)) return 'dead'

  const readCommand = options?.getProcessCommand ?? getProcessCommand
  const command = readCommand(session.pid)
  if (command == null) return 'unknown'
  return commandLineMatchesBackgroundSession(command, session) ? 'alive' : 'dead'
}

export function isBackgroundSessionProcessAlive(
  session: BackgroundSession,
  options?: {
    isProcessAlive?: (pid: number) => boolean
    getProcessCommand?: (pid: number) => string | null
  },
): boolean {
  return getBackgroundSessionProcessState(session, options) === 'alive'
}

export async function markBackgroundSessionKilled(
  target: string,
  options?: { now?: Date },
): Promise<BackgroundSession> {
  const session = await resolveBackgroundSession(target)
  const updated: BackgroundSession = {
    ...session,
    status: 'killed',
    updatedAt: iso(options?.now),
  }
  await writeSession(updated)
  return updated
}

export async function backgroundSessionLogExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function isTerminalBackgroundSession(
  session: BackgroundSession,
): boolean {
  return TERMINAL_STATUSES.has(session.status)
}
