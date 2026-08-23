import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import {
  getProcessCommand,
  isProcessRunning,
} from '../utils/genericProcessUtils.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import {
  backgroundProcessMarkerToken,
  isValidBackgroundProcessMarker,
} from './bgRouting.js'

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
  processMarker?: string
  startedAt: string
  updatedAt: string
  command: string[]
  stdoutLogPath: string
  stderrLogPath: string
  finishedAt?: string
  exitCode?: number
  signal?: string
  terminalReason?: BackgroundSessionTerminalReason
}

export type BackgroundSessionTerminalReason =
  | 'exit_code'
  | 'signal'
  | 'explicit_kill'

type BackgroundSessionTerminalFact = {
  version: 1
  id: string
  pid: number
  status: 'exited' | 'failed' | 'killed'
  finishedAt: string
  terminalReason: BackgroundSessionTerminalReason
  exitCode?: number
  signal?: string
}

export type BackgroundSessionNaturalTermination =
  | { exitCode: number; signal?: never }
  | { exitCode?: never; signal: string }

export type CreateBackgroundSessionInput = {
  id: string
  name?: string
  pid: number
  cwd: string
  command: string[]
  provider?: string
  model?: string
  sessionId: string
  processMarker?: string
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
const SAFE_SIGNAL_RE = /^SIG[A-Z0-9]{1,24}$/
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

function getBackgroundSessionTerminalDir(): string {
  return join(getBackgroundSessionsRoot(), 'terminal')
}

function metadataPathForId(id: string): string {
  assertSafeId(id)
  return join(getBackgroundSessionMetadataDir(), `${id}.json`)
}

function nameReservationPathForName(name: string): string {
  const digest = createHash('sha256').update(name).digest('hex')
  return join(getBackgroundSessionNamesDir(), `${digest}.json`)
}

function terminalFactPathForId(
  id: string,
  kind: 'natural' | 'killed',
): string {
  assertSafeId(id)
  return join(getBackgroundSessionTerminalDir(), `${id}.${kind}.json`)
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
  await mkdir(getBackgroundSessionTerminalDir(), {
    recursive: true,
    mode: 0o700,
  })
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

function readSessionFileSync(path: string): BackgroundSession | null {
  try {
    const parsed = jsonParse(readFileSync(path, 'utf8'))
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

function releaseNameReservationSync(name: string, id: string): void {
  const path = nameReservationPathForName(name)
  try {
    const parsed = jsonParse(
      readFileSync(path, 'utf8'),
    ) as Partial<BackgroundSessionNameReservation>
    if (parsed?.id === id) unlinkSync(path)
  } catch {
    // Effective terminal-state reads recover stale reservations later.
  }
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
    const effectiveOwner = await applyAuthoritativeTerminalFacts(owner)
    return (
      effectiveOwner.name === name &&
      !isTerminalBackgroundSession(effectiveOwner)
    )
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

function isSafeExitCode(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  )
}

function isSafeSignal(value: unknown): value is string {
  return typeof value === 'string' && SAFE_SIGNAL_RE.test(value)
}

function isTerminalReason(
  value: unknown,
): value is BackgroundSessionTerminalReason {
  return (
    value === 'exit_code' || value === 'signal' || value === 'explicit_kill'
  )
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
    (candidate.processMarker === undefined ||
      isValidBackgroundProcessMarker(candidate.processMarker)) &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    isStringArray(candidate.command) &&
    typeof candidate.stdoutLogPath === 'string' &&
    typeof candidate.stderrLogPath === 'string' &&
    (candidate.finishedAt === undefined ||
      typeof candidate.finishedAt === 'string') &&
    (candidate.exitCode === undefined || isSafeExitCode(candidate.exitCode)) &&
    (candidate.signal === undefined || isSafeSignal(candidate.signal)) &&
    (candidate.terminalReason === undefined ||
      isTerminalReason(candidate.terminalReason))
  )
}

function isBackgroundSessionTerminalFact(
  value: unknown,
  expectedId: string,
  kind: 'natural' | 'killed',
): value is BackgroundSessionTerminalFact {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BackgroundSessionTerminalFact>
  if (
    candidate.version !== 1 ||
    candidate.id !== expectedId ||
    !SAFE_ID_RE.test(candidate.id) ||
    typeof candidate.pid !== 'number' ||
    !Number.isInteger(candidate.pid) ||
    candidate.pid <= 0 ||
    typeof candidate.finishedAt !== 'string' ||
    !isTerminalReason(candidate.terminalReason) ||
    (candidate.exitCode !== undefined &&
      !isSafeExitCode(candidate.exitCode)) ||
    (candidate.signal !== undefined && !isSafeSignal(candidate.signal))
  ) {
    return false
  }

  if (kind === 'killed') {
    return (
      candidate.status === 'killed' &&
      candidate.terminalReason === 'explicit_kill' &&
      candidate.exitCode === undefined &&
      candidate.signal === undefined
    )
  }

  if (candidate.status === 'exited') {
    return (
      candidate.terminalReason === 'exit_code' &&
      candidate.exitCode === 0 &&
      candidate.signal === undefined
    )
  }
  if (candidate.status !== 'failed') return false
  if (candidate.terminalReason === 'exit_code') {
    return (
      candidate.exitCode !== undefined &&
      candidate.exitCode !== 0 &&
      candidate.signal === undefined
    )
  }
  return (
    candidate.terminalReason === 'signal' &&
    candidate.exitCode === undefined &&
    candidate.signal !== undefined
  )
}

async function readTerminalFact(
  id: string,
  kind: 'natural' | 'killed',
): Promise<BackgroundSessionTerminalFact | null> {
  try {
    const parsed = jsonParse(
      await readFile(terminalFactPathForId(id, kind), 'utf8'),
    )
    return isBackgroundSessionTerminalFact(parsed, id, kind) ? parsed : null
  } catch {
    return null
  }
}

function readTerminalFactSync(
  id: string,
  kind: 'natural' | 'killed',
): BackgroundSessionTerminalFact | null {
  try {
    const parsed = jsonParse(
      readFileSync(terminalFactPathForId(id, kind), 'utf8'),
    )
    return isBackgroundSessionTerminalFact(parsed, id, kind) ? parsed : null
  } catch {
    return null
  }
}

async function applyAuthoritativeTerminalFacts(
  session: BackgroundSession,
): Promise<BackgroundSession> {
  const natural = await readTerminalFact(session.id, 'natural')
  const killed = await readTerminalFact(session.id, 'killed')
  let effective = session

  if (
    natural?.pid === session.pid &&
    (session.status === 'running' ||
      session.status === 'unknown' ||
      session.status === 'stale')
  ) {
    effective = {
      ...session,
      status: natural.status,
      updatedAt: natural.finishedAt,
      finishedAt: natural.finishedAt,
      terminalReason: natural.terminalReason,
      ...(natural.exitCode !== undefined
        ? { exitCode: natural.exitCode }
        : {}),
      ...(natural.signal !== undefined ? { signal: natural.signal } : {}),
    }
  }

  if (killed?.pid === session.pid) {
    effective = {
      ...effective,
      status: 'killed',
      updatedAt: killed.finishedAt,
      finishedAt: effective.finishedAt ?? killed.finishedAt,
      terminalReason: 'explicit_kill',
    }
  }

  return effective
}

function terminalFactTempPath(id: string): string {
  return join(
    getBackgroundSessionTerminalDir(),
    `${id}.${process.pid}.${randomUUID()}.tmp`,
  )
}

async function installTerminalFact(
  fact: BackgroundSessionTerminalFact,
  kind: 'natural' | 'killed',
): Promise<BackgroundSessionTerminalFact> {
  await ensureBackgroundSessionDirs()
  const target = terminalFactPathForId(fact.id, kind)
  const tmp = terminalFactTempPath(fact.id)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(tmp, 'wx', 0o600)
    await handle.writeFile(jsonStringify(fact))
    await handle.sync()
    await handle.close()
    handle = undefined
    await link(tmp, target)
    return fact
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      const existing = await readTerminalFact(fact.id, kind)
      if (existing) return existing
      throw new Error(`Invalid background session ${kind} terminal fact`)
    }
    throw error
  } finally {
    await handle?.close().catch(() => {})
    await unlink(tmp).catch(() => {})
  }
}

function installTerminalFactSync(
  fact: BackgroundSessionTerminalFact,
  kind: 'natural' | 'killed',
): BackgroundSessionTerminalFact {
  mkdirSync(getBackgroundSessionTerminalDir(), {
    recursive: true,
    mode: 0o700,
  })
  const target = terminalFactPathForId(fact.id, kind)
  const tmp = terminalFactTempPath(fact.id)
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, jsonStringify(fact))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    linkSync(tmp, target)
    return fact
  } catch (error) {
    if (isErrno(error, 'EEXIST')) {
      const existing = readTerminalFactSync(fact.id, kind)
      if (existing) return existing
      throw new Error(`Invalid background session ${kind} terminal fact`)
    }
    throw error
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {}
    }
    try {
      unlinkSync(tmp)
    } catch {}
  }
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
    if (session) sessions.push(await applyAuthoritativeTerminalFacts(session))
  }

  return sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export async function readBackgroundSessionForOwner(
  id: string,
): Promise<BackgroundSession | null> {
  assertSafeId(id)
  return await readSessionFile(metadataPathForId(id))
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
  if (
    input.processMarker !== undefined &&
    !isValidBackgroundProcessMarker(input.processMarker)
  ) {
    throw new Error('Invalid background process marker')
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
    ...(input.processMarker
      ? { processMarker: input.processMarker }
      : {}),
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

  const byName = sessions.filter(s => s.name === target)
  const liveByName = byName.filter(s => !isTerminalBackgroundSession(s))
  if (liveByName.length === 1) return liveByName[0]
  if (liveByName.length > 1) {
    throw new Error(`Background session name "${target}" is ambiguous`)
  }

  const idPrefix = sessions.filter(s => s.id.startsWith(target))
  if (idPrefix.length === 1) return idPrefix[0]
  if (idPrefix.length > 1) {
    throw new Error(`Background session id "${target}" is ambiguous`)
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
  _beforeStatusWriteForTesting?: (
    session: BackgroundSession,
    nextStatus: BackgroundSessionStatus,
  ) => Promise<void>
}): Promise<BackgroundSession[]> {
  const timestamp = iso(options?.now)
  const sessions = await listBackgroundSessions()
  const refreshed: BackgroundSession[] = []

  for (const session of sessions) {
    if (session.status !== 'running' && session.status !== 'unknown') {
      refreshed.push(session)
      continue
    }

    const processState = verifyBackgroundSessionProcessIdentity(
      session,
      options,
    ).state
    const nextStatus: BackgroundSessionStatus =
      processState === 'matches'
        ? 'running'
        : processState === 'unreadable'
          ? 'unknown'
          : 'stale'

    if (session.status !== nextStatus) {
      const updated = {
        ...session,
        status: nextStatus,
        updatedAt: timestamp,
      }
      await options?._beforeStatusWriteForTesting?.(session, nextStatus)
      await writeSession(updated)
      refreshed.push(await applyAuthoritativeTerminalFacts(updated))
      continue
    }

    refreshed.push(session)
  }

  return refreshed
}

export type BackgroundSessionProcessIdentity = {
  state: 'not-running' | 'matches' | 'mismatch' | 'unreadable'
  backgroundSessionId: string
  pid: number
}

export type BackgroundSessionProcessLiveness =
  | 'alive'
  | 'not-running'
  | 'unreadable'

export type BackgroundSessionProcessIdentityOptions = {
  isProcessAlive?: (pid: number) => boolean
  signalProcess?: (pid: number, signal: 0) => unknown
  getProcessCommand?: (pid: number) => string | null
}

// A spaced path or prompt is a single argv entry, but the raw command line
// quotes it, so a whitespace split fuses a quote onto the edge tokens. Windows
// `Get-CimInstance ... CommandLine` returns exactly this form — e.g.
//   "C:\Program Files\nodejs\node.exe" ...\cli.mjs --from-pr 1642 --print "refactor auth"
// splits to `"C:\Program`, `Files\nodejs\node.exe"`, ..., `"refactor`, `auth"`.
// The stored argv holds those same values unquoted, so trim a single leading
// and/or trailing quote from each token before comparing. POSIX `ps` output is
// unquoted, making this a no-op there, and it never widens the token-boundary
// match below (a stripped token still has to equal the stored one). See #1770.
function tokenizeCommandLine(value: string): string[] {
  return value
    .split(/\s+/)
    .map(token => token.replace(/^["']|["']$/g, ''))
    .filter(token => token.length > 0)
}

function commandLineContainsArgs(commandLine: string, args: string[]): boolean {
  if (args.length === 0) return false
  // Match the stored args against whole whitespace-delimited tokens, in order,
  // rather than as a raw substring. Substring matching let a stored selector
  // like "1642" satisfy a lookup against an unrelated live token "16420" (e.g. a
  // reused PID whose command line merely contains those digits), so a dead
  // session stayed classified as running. See #1770.
  //
  // A stored arg can itself contain whitespace — a prompt like "refactor auth"
  // is a single argv entry but `ps` renders it as separate words — so expand
  // each arg into its own tokens and require the flattened sequence to appear as
  // one CONTIGUOUS run of whole command tokens. An ordered-subsequence match
  // (skipping unrelated tokens between matches) would let a reused PID whose
  // command line merely interleaves the stored tokens pass — e.g. stored
  // ["node", "openclaude", "1642"] satisfied by "node attacker openclaude extra
  // 1642 --serve" — reopening the same wrong-process `kill` risk for token
  // insertion collisions. The real launch invocation appears as an unbroken run
  // (only the interpreter path or trailing flags differ), so leading/trailing
  // tokens are fine but interspersed ones are not.
  const tokens = tokenizeCommandLine(commandLine)
  const argTokens = args.flatMap(tokenizeCommandLine)
  if (argTokens.length === 0) return false
  if (argTokens.length > tokens.length) return false
  for (let start = 0; start <= tokens.length - argTokens.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < argTokens.length; offset += 1) {
      if (tokens[start + offset] !== argTokens[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

function commandLineMatchesBackgroundSession(
  commandLine: string,
  session: BackgroundSession,
): boolean {
  // Match the session id as a whole token, not a raw substring: an id like
  // "sess-1" must not match an unrelated live command that merely contains
  // "sess-100" (the same reused-PID collision this guard fixes for #1770).
  if (commandLineContainsArgs(commandLine, [session.sessionId])) return true
  // PR resume launches write to the resumed transcript id without carrying
  // that id on argv, so use the stored launch invocation as the PID guard.
  return commandLineContainsArgs(commandLine, session.command)
}

function markedCommandLineIdentity(
  commandLine: string,
  session: BackgroundSession,
  processMarker: string,
): 'matches' | 'mismatch' | 'unreadable' {
  const markerToken = backgroundProcessMarkerToken(processMarker)
  const storedTokens = session.command.flatMap(tokenizeCommandLine)
  const expectedIndex = storedTokens.indexOf(markerToken)
  if (expectedIndex === -1) return 'unreadable'

  const liveTokens = tokenizeCommandLine(commandLine)
  const comparablePrefixLength = Math.min(expectedIndex, liveTokens.length)
  for (let index = 0; index < comparablePrefixLength; index += 1) {
    if (liveTokens[index] !== storedTokens[index]) return 'mismatch'
  }

  if (liveTokens.length <= expectedIndex) return 'unreadable'
  const candidate = liveTokens[expectedIndex]!
  if (candidate === markerToken) return 'matches'
  if (
    expectedIndex === liveTokens.length - 1 &&
    candidate.length > 0 &&
    markerToken.startsWith(candidate)
  ) {
    return 'unreadable'
  }
  return 'mismatch'
}

export function verifyBackgroundSessionProcessIdentity(
  session: BackgroundSession,
  options?: BackgroundSessionProcessIdentityOptions,
): BackgroundSessionProcessIdentity {
  const result = (
    state: BackgroundSessionProcessIdentity['state'],
  ): BackgroundSessionProcessIdentity => ({
    state,
    backgroundSessionId: session.id,
    pid: session.pid,
  })
  const getLiveness = () =>
    getBackgroundSessionProcessLiveness(session.pid, options)
  const liveness = getLiveness()
  if (liveness !== 'alive') return result(liveness)

  const readCommand = options?.getProcessCommand ?? getProcessCommand
  let command: string | null
  try {
    command = readCommand(session.pid)
  } catch {
    const latestLiveness = getLiveness()
    return result(
      latestLiveness === 'alive' ? 'unreadable' : latestLiveness,
    )
  }
  const latestLiveness = getLiveness()
  if (latestLiveness !== 'alive') return result(latestLiveness)
  if (command == null || command.trim() === '') {
    return result('unreadable')
  }
  if (session.processMarker !== undefined) {
    return result(
      markedCommandLineIdentity(command, session, session.processMarker),
    )
  }
  return result(
    commandLineMatchesBackgroundSession(command, session)
      ? 'matches'
      : 'mismatch',
  )
}

export function getBackgroundSessionProcessLiveness(
  pid: number,
  options?: BackgroundSessionProcessIdentityOptions,
): BackgroundSessionProcessLiveness {
  if (options?.isProcessAlive) {
    try {
      return options.isProcessAlive(pid) ? 'alive' : 'not-running'
    } catch {
      return 'unreadable'
    }
  }
  if (pid <= 1) return 'not-running'

  const signalProcess = options?.signalProcess ?? process.kill
  try {
    signalProcess(pid, 0)
    return 'alive'
  } catch (error) {
    return isErrno(error, 'ESRCH') ? 'not-running' : 'unreadable'
  }
}

export function isBackgroundSessionProcessAlive(
  session: BackgroundSession,
  options?: BackgroundSessionProcessIdentityOptions,
): boolean {
  return (
    verifyBackgroundSessionProcessIdentity(session, options).state === 'matches'
  )
}

function naturalTerminalFact(
  id: string,
  pid: number,
  termination: BackgroundSessionNaturalTermination,
  now: Date | undefined,
): BackgroundSessionTerminalFact {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Invalid background session owner PID')
  }
  const finishedAt = iso(now)
  if (termination.signal !== undefined) {
    if (!isSafeSignal(termination.signal)) {
      throw new Error('Invalid background session termination signal')
    }
    return {
      version: 1,
      id,
      pid,
      status: 'failed',
      finishedAt,
      terminalReason: 'signal',
      signal: termination.signal,
    }
  }
  if (!isSafeExitCode(termination.exitCode)) {
    throw new Error('Invalid background session exit code')
  }
  return {
    version: 1,
    id,
    pid,
    status: termination.exitCode === 0 ? 'exited' : 'failed',
    finishedAt,
    terminalReason: 'exit_code',
    exitCode: termination.exitCode,
  }
}

function assertNaturalFinalizationOwner(
  session: BackgroundSession | null,
  id: string,
  ownerPid: number,
): asserts session is BackgroundSession {
  if (!session || session.id !== id || session.pid !== ownerPid) {
    throw new Error('Background session finalizer does not own this session')
  }
}

export async function recordBackgroundSessionNaturalTermination(
  id: string,
  termination: BackgroundSessionNaturalTermination,
  options: { ownerPid?: number; now?: Date } = {},
): Promise<BackgroundSession> {
  assertSafeId(id)
  const ownerPid = options.ownerPid ?? process.pid
  const session = await readSessionFile(metadataPathForId(id))
  assertNaturalFinalizationOwner(session, id, ownerPid)

  const effective = await applyAuthoritativeTerminalFacts(session)
  if (
    effective.status === 'killed' ||
    session.status === 'exited' ||
    session.status === 'failed'
  ) {
    return effective
  }
  if (
    session.status !== 'running' &&
    session.status !== 'unknown' &&
    session.status !== 'stale'
  ) {
    // Retain an exhaustive guard so future status additions require a deliberate
    // natural-finalization policy.
    throw new Error('Background session is not eligible for natural finalization')
  }

  await installTerminalFact(
    naturalTerminalFact(id, ownerPid, termination, options.now),
    'natural',
  )
  if (session.name) await releaseNameReservation(session.name, session.id)
  return await applyAuthoritativeTerminalFacts(session)
}

export function recordBackgroundSessionNaturalTerminationSync(
  id: string,
  termination: BackgroundSessionNaturalTermination,
  options: { ownerPid?: number; now?: Date } = {},
): void {
  assertSafeId(id)
  const ownerPid = options.ownerPid ?? process.pid
  const session = readSessionFileSync(metadataPathForId(id))
  assertNaturalFinalizationOwner(session, id, ownerPid)
  if (
    session.status === 'killed' ||
    session.status === 'exited' ||
    session.status === 'failed' ||
    readTerminalFactSync(id, 'killed')?.pid === ownerPid
  ) {
    return
  }
  if (
    session.status !== 'running' &&
    session.status !== 'unknown' &&
    session.status !== 'stale'
  ) {
    // Retain an exhaustive guard so future status additions require a deliberate
    // natural-finalization policy.
    throw new Error('Background session is not eligible for natural finalization')
  }

  installTerminalFactSync(
    naturalTerminalFact(id, ownerPid, termination, options.now),
    'natural',
  )
  if (session.name) releaseNameReservationSync(session.name, session.id)
}

export async function markBackgroundSessionKilled(
  target: string,
  options?: { now?: Date },
): Promise<BackgroundSession> {
  const session = await resolveBackgroundSession(target)
  const rawSession = await readSessionFile(metadataPathForId(session.id))
  if (!rawSession || rawSession.pid !== session.pid) {
    throw new Error('Background session changed before it could be marked killed')
  }
  await installTerminalFact(
    {
      version: 1,
      id: session.id,
      pid: session.pid,
      status: 'killed',
      finishedAt: iso(options?.now),
      terminalReason: 'explicit_kill',
    },
    'killed',
  )
  if (rawSession.name) {
    await releaseNameReservation(rawSession.name, rawSession.id)
  }
  return await applyAuthoritativeTerminalFacts(rawSession)
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
