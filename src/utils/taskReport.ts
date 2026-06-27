import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  win32,
} from 'node:path'

import { execa } from 'execa'

import {
  redactDiagnosticObject,
  redactHomePath,
  redactLikelySecrets,
} from './diagnostics/redaction.js'
import { stableStringifyJson } from './stableStringify.js'

export const TASK_REPORT_SCHEMA_VERSION = 1
export const DEFAULT_TASK_REPORT_PREVIEW_CHARS = 1_000

type JsonRecord = Record<string, unknown>

export type TaskReportStatus = 'success' | 'error' | 'cancelled' | 'unknown'

export type TaskReportSource = {
  transcriptPath: string
  malformedLineCount: number
}

export type TaskReportSession = {
  id: string | null
  name?: string
  tag?: string
  cwd?: string
  startedAt?: string
  endedAt?: string
  initialRequest?: string
  models: string[]
}

export type TaskReportBranch = {
  transcriptBranch?: string
  worktree?: {
    name?: string
    path?: string
    branch?: string
    originalBranch?: string
    originalHead?: string
    originalCwd?: string
  }
  pullRequest?: {
    number: number
    url?: string
    repository?: string
  }
}

export type TaskReportGitMetadata = {
  status: 'available' | 'unavailable'
  cwd: string
  branch?: string
  head?: string
  dirty?: boolean
  changedFiles: string[]
  error?: string
}

type TaskReportGitCommandResult = {
  stdout: string
  stderr: string
  code: number
  error?: string
}

export type TaskReportGitRunner = (
  cwd: string,
  args: string[],
) => Promise<TaskReportGitCommandResult>

export type TaskReportChangedFile = {
  path: string
  sources: Array<'tool' | 'git'>
}

export type TaskReportPreview = {
  preview: string
  truncated: boolean
  chars: number
}

export type TaskReportToolUse = {
  id: string
  name: string
  timestamp?: string
  status: TaskReportStatus
  inputSummary?: string
  resultSummary?: TaskReportPreview
  files: string[]
}

export type TaskReportCommand = {
  toolUseId: string
  timestamp?: string
  command: string
  description?: string
  status: TaskReportStatus
  exitCode?: number
  stdout?: TaskReportPreview
  stderr?: TaskReportPreview
}

export type TaskReportValidation = TaskReportCommand

export type TaskReportError = {
  source: 'tool' | 'transcript'
  message: string
  timestamp?: string
  toolUseId?: string
  toolName?: string
}

export type TaskReportReference = {
  kind: 'issue' | 'pull_request' | 'unknown'
  number: number
  url?: string
  repository?: string
}

export type TaskReport = {
  schemaVersion: typeof TASK_REPORT_SCHEMA_VERSION
  source: TaskReportSource
  session: TaskReportSession
  branch: TaskReportBranch
  git?: TaskReportGitMetadata
  changedFiles: TaskReportChangedFile[]
  toolUses: TaskReportToolUse[]
  commands: TaskReportCommand[]
  validations: TaskReportValidation[]
  errors: TaskReportError[]
  warnings: string[]
  linkedReferences: TaskReportReference[]
  redaction: {
    mode: 'best_effort'
    maxPreviewChars: number
  }
}

export type BuildTaskReportOptions = {
  transcriptPath: string
  cwd?: string
  git?: false | ((cwd: string) => Promise<TaskReportGitMetadata>)
  maxPreviewChars?: number
}

export type TaskReportArgs = {
  format: 'json'
  transcriptPath?: string | null
  sessionId?: string | null
  outFile?: string | null
  cwd?: string
}

type ParsedTranscript = {
  entries: JsonRecord[]
  malformedLineCount: number
}

type ObservedToolUse = {
  id: string
  name: string
  timestamp?: string
  input: unknown
}

type ObservedToolResult = {
  toolUseId: string
  timestamp?: string
  content: unknown
  toolUseResult: unknown
  isError: boolean
}

const MUTATING_FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const FILE_CONTENT_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])

const VALIDATION_COMMAND_PATTERNS = [
  /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(?:test(?::[A-Za-z0-9_-]+)?|typecheck(?::[A-Za-z0-9_-]+)?|web:typecheck|web:build|build|smoke|check|lint|security:pr-scan)\b/,
  /\bbun\s+test\b/,
  /\bgit\s+diff\s+--check\b/,
  /\bpython\s+-m\s+pytest\b/,
  /\bpytest\b/,
  /\btsc\b/,
]

export async function buildTaskReport(
  options: BuildTaskReportOptions,
): Promise<TaskReport> {
  const maxPreviewChars = normalizeMaxPreviewChars(options.maxPreviewChars)
  const transcriptPath = resolve(options.transcriptPath)
  const { entries, malformedLineCount } =
    await readTranscriptEntries(transcriptPath)

  const sessionId =
    findSessionId(entries) ?? basenameWithoutExtension(transcriptPath)
  const metadata = collectSessionMetadata(entries, maxPreviewChars)
  const toolResults = collectToolResults(entries)
  const observedToolUses = collectToolUses(entries)
  const changedFileSources = new Map<string, Set<'tool' | 'git'>>()
  const errors: TaskReportError[] = []
  const commands: TaskReportCommand[] = []
  const validations: TaskReportValidation[] = []
  const toolUses: TaskReportToolUse[] = []
  const referenceTextParts: string[] = []
  const cwdForGit = metadata.cwd ?? options.cwd ?? process.cwd()

  if (metadata.initialRequest) {
    referenceTextParts.push(metadata.initialRequest)
  }

  for (const observed of observedToolUses) {
    const result = toolResults.get(observed.id)
    const status = getObservedStatus(result)
    const files = extractToolFiles(observed.name, observed.input, result)
    const changedFiles = extractChangedFiles(observed.name, observed.input, result)
    for (const file of changedFiles) {
      addChangedFileSource(changedFileSources, file, 'tool', cwdForGit)
    }

    const resultSummary = shouldIncludeToolResultSummary(observed.name)
      ? previewUnknown(result?.content ?? result?.toolUseResult, maxPreviewChars)
      : undefined
    const toolUse: TaskReportToolUse = {
      id: observed.id,
      name: observed.name,
      status,
      files: sortUnique(files.map(path => redact(path))),
    }
    if (observed.timestamp) toolUse.timestamp = observed.timestamp
    const summary = summarizeToolInput(
      observed.name,
      observed.input,
      maxPreviewChars,
    )
    if (summary) toolUse.inputSummary = summary
    if (resultSummary) toolUse.resultSummary = resultSummary
    toolUses.push(toolUse)

    if (observed.name === 'Bash') {
      const rawCommand = extractBashCommand(observed.input)
      const command = buildCommandReport(
        observed,
        result,
        status,
        maxPreviewChars,
      )
      if (command) {
        commands.push(command)
        if (rawCommand) referenceTextParts.push(redact(rawCommand))
        if (rawCommand && isValidationCommand(rawCommand)) {
          validations.push(command)
        }
      }
    }

    if (result?.isError === true) {
      const message = previewUnknown(
        result.content ?? result.toolUseResult,
        maxPreviewChars,
      )
      errors.push({
        source: 'tool',
        toolUseId: observed.id,
        toolName: observed.name,
        message: message?.preview ?? 'Tool result was marked as an error.',
        ...(result.timestamp ? { timestamp: result.timestamp } : {}),
      })
    }
  }

  const rawGit =
    options.git === false
      ? undefined
      : await (options.git ?? collectTaskReportGitMetadata)(cwdForGit)
  const git = rawGit ? normalizeGitMetadata(rawGit) : undefined
  if (git) {
    for (const file of git.changedFiles) {
      addChangedFileSource(changedFileSources, file, 'git', cwdForGit)
    }
  }

  const branch = collectBranchMetadata(entries)
  if (branch.pullRequest?.url) {
    referenceTextParts.push(branch.pullRequest.url)
  }
  for (const text of metadata.referenceTextParts) {
    referenceTextParts.push(text)
  }

  const warnings: string[] = []
  if (malformedLineCount > 0) {
    warnings.push(
      `Skipped ${malformedLineCount} malformed transcript line${
        malformedLineCount === 1 ? '' : 's'
      }.`,
    )
  }
  if (entries.length === 0) {
    warnings.push('No transcript entries were available for this report.')
  }
  if (validations.length === 0) {
    warnings.push('No validation commands were observed in this transcript.')
  }

  return {
    schemaVersion: TASK_REPORT_SCHEMA_VERSION,
    source: {
      transcriptPath: redact(transcriptPath),
      malformedLineCount,
    },
    session: {
      id: sessionId || null,
      ...(metadata.name ? { name: metadata.name } : {}),
      ...(metadata.tag ? { tag: metadata.tag } : {}),
      ...(metadata.cwd ? { cwd: redact(metadata.cwd) } : {}),
      ...(metadata.startedAt ? { startedAt: metadata.startedAt } : {}),
      ...(metadata.endedAt ? { endedAt: metadata.endedAt } : {}),
      ...(metadata.initialRequest
        ? { initialRequest: metadata.initialRequest }
        : {}),
      models: sortUnique(metadata.models),
    },
    branch,
    ...(git ? { git } : {}),
    changedFiles: formatChangedFiles(changedFileSources),
    toolUses,
    commands,
    validations,
    errors,
    warnings,
    linkedReferences: collectLinkedReferences(referenceTextParts, branch),
    redaction: {
      mode: 'best_effort',
      maxPreviewChars,
    },
  }
}

export async function collectTaskReportGitMetadata(
  cwd: string,
  gitRunner: TaskReportGitRunner = runGit,
): Promise<TaskReportGitMetadata> {
  const base = ['--no-optional-locks']
  const inside = await gitRunner(cwd, [
    ...base,
    'rev-parse',
    '--is-inside-work-tree',
  ])
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return {
      status: 'unavailable',
      cwd: redact(cwd),
      changedFiles: [],
      error: redact(
        inside.error ?? inside.stderr.trim() ?? 'not a git repository',
      ),
    }
  }

  const [branch, head, status] = await Promise.all([
    gitRunner(cwd, [...base, 'branch', '--show-current']),
    gitRunner(cwd, [...base, 'rev-parse', '--short=12', 'HEAD']),
    gitRunner(cwd, [...base, 'status', '--porcelain=v1']),
  ])
  const gitStatusAvailable = status.code === 0
  const changedFiles = gitStatusAvailable
    ? parseGitStatusChangedFiles(status.stdout)
    : []

  return {
    status: 'available',
    cwd: redact(cwd),
    ...(branch.code === 0 && branch.stdout.trim()
      ? { branch: redact(branch.stdout.trim()) }
      : {}),
    ...(head.code === 0 && head.stdout.trim()
      ? { head: redact(head.stdout.trim()) }
      : {}),
    ...(gitStatusAvailable ? { dirty: changedFiles.length > 0 } : {}),
    changedFiles: sortUnique(changedFiles.map(path => redact(path))),
    ...(status.code !== 0
      ? { error: redact(status.error ?? status.stderr.trim()) }
      : {}),
  }
}

export function formatTaskReportAsJson(report: TaskReport): string {
  return stableStringifyJson(report, 2)
}

export async function writeTaskReport(
  outFile: string,
  content: string,
): Promise<string> {
  const outputPath = resolve(process.cwd(), outFile)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, content, 'utf8')
  return outputPath
}

async function readTranscriptEntries(
  transcriptPath: string,
): Promise<ParsedTranscript> {
  const raw = await readFile(transcriptPath, 'utf8')
  if (transcriptPath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return {
        entries: coerceJsonTranscriptEntries(parsed),
        malformedLineCount: 0,
      }
    } catch {
      return { entries: [], malformedLineCount: 1 }
    }
  }

  const entries: JsonRecord[] = []
  let malformedLineCount = 0
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isRecord(parsed)) {
        entries.push(parsed)
      }
    } catch {
      malformedLineCount++
    }
  }
  return { entries, malformedLineCount }
}

function coerceJsonTranscriptEntries(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord)
  }
  if (!isRecord(value)) {
    return []
  }
  const messages = value.messages
  if (Array.isArray(messages)) {
    return messages.filter(isRecord)
  }
  return [value]
}

function collectSessionMetadata(
  entries: JsonRecord[],
  maxPreviewChars: number,
): {
  name?: string
  tag?: string
  cwd?: string
  startedAt?: string
  endedAt?: string
  initialRequest?: string
  models: string[]
  referenceTextParts: string[]
} {
  const timestamps = entries
    .map(entry => stringValue(entry.timestamp))
    .filter((value): value is string => Boolean(value))
  const models: string[] = []
  const referenceTextParts: string[] = []
  let name: string | undefined
  let tag: string | undefined
  let cwd: string | undefined
  let initialRequest: string | undefined

  for (const entry of entries) {
    if (entry.type === 'custom-title') {
      const title = stringValue(entry.customTitle)
      if (title) name = truncateText(redact(title), maxPreviewChars).preview
    } else if (entry.type === 'tag') {
      const observedTag = stringValue(entry.tag)
      if (observedTag) tag = truncateText(redact(observedTag), maxPreviewChars).preview
    }

    const observedCwd = stringValue(entry.cwd)
    if (!cwd && observedCwd) cwd = observedCwd

    const message = recordValue(entry.message)
    const model = stringValue(message?.model)
    if (model) models.push(redact(model))

    const isToolResult = isToolResultEntry(entry)
    const text = isToolResult ? undefined : extractMessageText(message)
    if (text) referenceTextParts.push(text)
    if (!initialRequest && entry.type === 'user' && !isToolResult) {
      const request = text?.trim()
      if (request) {
        initialRequest = truncateText(redact(request), maxPreviewChars).preview
      }
    }
  }

  return {
    ...(name ? { name } : {}),
    ...(tag ? { tag } : {}),
    ...(cwd ? { cwd } : {}),
    ...(timestamps[0] ? { startedAt: timestamps[0] } : {}),
    ...(timestamps.at(-1) ? { endedAt: timestamps.at(-1) } : {}),
    ...(initialRequest ? { initialRequest } : {}),
    models,
    referenceTextParts,
  }
}

function collectBranchMetadata(entries: JsonRecord[]): TaskReportBranch {
  const branch: TaskReportBranch = {}
  for (const entry of entries) {
    const transcriptBranch = stringValue(entry.gitBranch)
    if (transcriptBranch) {
      branch.transcriptBranch = redact(transcriptBranch)
    }

    if (entry.type === 'worktree-state') {
      const worktree = recordValue(entry.worktreeSession)
      if (worktree) {
        branch.worktree = {
          ...(stringValue(worktree.worktreeName)
            ? { name: redact(stringValue(worktree.worktreeName) as string) }
            : {}),
          ...(stringValue(worktree.worktreePath)
            ? { path: redact(stringValue(worktree.worktreePath) as string) }
            : {}),
          ...(stringValue(worktree.worktreeBranch)
            ? { branch: redact(stringValue(worktree.worktreeBranch) as string) }
            : {}),
          ...(stringValue(worktree.originalBranch)
            ? {
                originalBranch: redact(
                  stringValue(worktree.originalBranch) as string,
                ),
              }
            : {}),
          ...(stringValue(worktree.originalHeadCommit)
            ? {
                originalHead: redact(
                  stringValue(worktree.originalHeadCommit) as string,
                ),
              }
            : {}),
          ...(stringValue(worktree.originalCwd)
            ? { originalCwd: redact(stringValue(worktree.originalCwd) as string) }
            : {}),
        }
      }
    }

    if (entry.type === 'pr-link') {
      const number = numberValue(entry.prNumber)
      if (number !== undefined) {
        branch.pullRequest = {
          number,
          ...(stringValue(entry.prUrl) ? { url: redact(stringValue(entry.prUrl) as string) } : {}),
          ...(stringValue(entry.prRepository)
            ? { repository: redact(stringValue(entry.prRepository) as string) }
            : {}),
        }
      }
    }
  }
  return branch
}

function collectToolUses(entries: JsonRecord[]): ObservedToolUse[] {
  const toolUses: ObservedToolUse[] = []
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue
    const message = recordValue(entry.message)
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_use') continue
      const id = stringValue(block.id)
      const name = stringValue(block.name)
      if (!id || !name) continue
      toolUses.push({
        id,
        name,
        input: block.input,
        ...(stringValue(entry.timestamp)
          ? { timestamp: stringValue(entry.timestamp) as string }
          : {}),
      })
    }
  }
  return toolUses
}

function collectToolResults(entries: JsonRecord[]): Map<string, ObservedToolResult> {
  const results = new Map<string, ObservedToolResult>()
  for (const entry of entries) {
    if (entry.type !== 'user') continue
    const message = recordValue(entry.message)
    const content = message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue
      const toolUseId = stringValue(block.tool_use_id)
      if (!toolUseId) continue
      results.set(toolUseId, {
        toolUseId,
        content: block.content,
        toolUseResult: entry.toolUseResult,
        isError: block.is_error === true,
        ...(stringValue(entry.timestamp)
          ? { timestamp: stringValue(entry.timestamp) as string }
          : {}),
      })
    }
  }
  return results
}

function buildCommandReport(
  observed: ObservedToolUse,
  result: ObservedToolResult | undefined,
  status: TaskReportStatus,
  maxPreviewChars: number,
): TaskReportCommand | null {
  const input = recordValue(observed.input)
  const rawCommand = extractBashCommand(observed.input)
  if (!rawCommand) return null

  const structuredResult = recordValue(result?.toolUseResult)
  const stdout = stringValue(structuredResult?.stdout)
  const stderr = stringValue(structuredResult?.stderr)
  const exitCode = extractExitCode(result)
  const command: TaskReportCommand = {
    toolUseId: observed.id,
    command: truncateText(redact(rawCommand), maxPreviewChars).preview,
    status,
  }
  const description = stringValue(input?.description)
  if (description) {
    command.description = truncateText(redact(description), maxPreviewChars).preview
  }
  if (observed.timestamp) {
    command.timestamp = observed.timestamp
  }
  if (exitCode !== undefined) {
    command.exitCode = exitCode
  }
  if (stdout !== undefined) {
    command.stdout = truncateText(redact(stdout), maxPreviewChars)
  }
  if (stderr !== undefined) {
    command.stderr = truncateText(redact(stderr), maxPreviewChars)
  }
  return command
}

function extractBashCommand(input: unknown): string | undefined {
  const inputRecord = recordValue(input)
  return stringValue(inputRecord?.command)
}

function getObservedStatus(
  result: ObservedToolResult | undefined,
): TaskReportStatus {
  if (!result) return 'unknown'
  const structuredResult = recordValue(result.toolUseResult)
  if (structuredResult?.interrupted === true) return 'cancelled'
  const exitCode = extractExitCode(result)
  if (exitCode !== undefined && exitCode !== 0) return 'error'
  if (result.isError) return 'error'
  return 'success'
}

function shouldIncludeToolResultSummary(toolName: string): boolean {
  return !FILE_CONTENT_TOOLS.has(toolName)
}

function extractToolFiles(
  toolName: string,
  input: unknown,
  result: ObservedToolResult | undefined,
): string[] {
  const files = new Set<string>()
  const inputRecord = recordValue(input)
  for (const file of extractFilePathsFromRecord(inputRecord)) {
    files.add(file)
  }
  if (toolName === 'Bash') {
    const simulatedSedEdit = recordValue(inputRecord?._simulatedSedEdit)
    const sedFile = stringValue(simulatedSedEdit?.filePath)
    if (sedFile) files.add(sedFile)
  }
  const resultRecord = recordValue(result?.toolUseResult)
  for (const file of extractFilePathsFromRecord(resultRecord)) {
    files.add(file)
  }
  return [...files]
}

function extractChangedFiles(
  toolName: string,
  input: unknown,
  result: ObservedToolResult | undefined,
): string[] {
  if (!MUTATING_FILE_TOOLS.has(toolName) && toolName !== 'Bash') {
    return []
  }
  if (toolName === 'Bash') {
    const inputRecord = recordValue(input)
    const simulatedSedEdit = recordValue(inputRecord?._simulatedSedEdit)
    const sedFile = stringValue(simulatedSedEdit?.filePath)
    return sedFile ? [sedFile] : []
  }
  return extractToolFiles(toolName, input, result)
}

function extractFilePathsFromRecord(record: JsonRecord | null | undefined): string[] {
  if (!record) return []
  const candidates = [
    stringValue(record.file_path),
    stringValue(record.filePath),
    stringValue(record.notebook_path),
    stringValue(record.path),
  ].filter((value): value is string => Boolean(value))
  const gitDiff = recordValue(record.gitDiff)
  const diffFile = stringValue(gitDiff?.filename)
  if (diffFile) candidates.push(diffFile)
  return candidates
}

function summarizeToolInput(
  toolName: string,
  input: unknown,
  maxPreviewChars: number,
): string | undefined {
  const record = recordValue(input)
  if (!record) return undefined
  if (toolName === 'Bash') {
    const command = stringValue(record.command)
    return command ? truncateText(redact(command), maxPreviewChars).preview : undefined
  }
  const filePath =
    stringValue(record.file_path) ??
    stringValue(record.filePath) ??
    stringValue(record.notebook_path)
  if (filePath) {
    return truncateText(redact(`${toolName} ${filePath}`), maxPreviewChars).preview
  }
  const keys = Object.keys(record).sort()
  if (keys.length === 0) return undefined
  return truncateText(redact(`${toolName} input keys: ${keys.join(', ')}`), maxPreviewChars).preview
}

function extractExitCode(result: ObservedToolResult | undefined): number | undefined {
  if (!result) return undefined
  const structuredResult = recordValue(result.toolUseResult)
  const structuredExitCode = numberValue(structuredResult?.exitCode)
  if (structuredExitCode !== undefined) {
    return structuredExitCode
  }

  const parts = [
    unknownToString(result.content),
    unknownToString(result.toolUseResult),
  ].filter((value): value is string => Boolean(value))
  for (const part of parts) {
    const match = /\bexit code[:\s]+(\d+)\b/i.exec(part)
    if (match?.[1]) {
      return Number(match[1])
    }
  }
  return undefined
}

function previewUnknown(
  value: unknown,
  maxPreviewChars: number,
): TaskReportPreview | undefined {
  const text = unknownToString(value)
  if (!text) return undefined
  return truncateText(redact(text), maxPreviewChars)
}

function unknownToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map(item => unknownToString(item))
      .filter((item): item is string => Boolean(item))
      .join('\n')
  }
  if (isRecord(value)) {
    const content = value.content
    if (typeof content === 'string') return content
    try {
      return stableStringifyJson(redactObject(value))
    } catch {
      return undefined
    }
  }
  return undefined
}

function extractMessageText(message: JsonRecord | null | undefined): string | undefined {
  if (!message) return undefined
  const content = message.content
  if (typeof content === 'string') return redact(content)
  if (!Array.isArray(content)) return undefined
  const parts = content
    .map(block => {
      if (typeof block === 'string') return block
      if (!isRecord(block)) return undefined
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      if (block.type === 'tool_result') {
        return unknownToString(block.content)
      }
      return undefined
    })
    .filter((part): part is string => Boolean(part?.trim()))
  return parts.length > 0 ? redact(parts.join('\n')) : undefined
}

function collectLinkedReferences(
  textParts: string[],
  branch: TaskReportBranch,
): TaskReportReference[] {
  const references = new Map<string, TaskReportReference>()

  if (branch.pullRequest) {
    const pr = branch.pullRequest
    const key = `pull_request:${pr.repository ?? ''}:${pr.number}:${pr.url ?? ''}`
    references.set(key, {
      kind: 'pull_request',
      number: pr.number,
      ...(pr.url ? { url: pr.url } : {}),
      ...(pr.repository ? { repository: pr.repository } : {}),
    })
  }

  for (const text of textParts) {
    for (const reference of extractGithubUrlReferences(text)) {
      const key = `${reference.kind}:${reference.repository ?? ''}:${
        reference.number
      }:${reference.url ?? ''}`
      references.set(key, reference)
    }
    for (const reference of extractShorthandReferences(text)) {
      const key = `${reference.kind}:${reference.number}`
      if (!references.has(key)) {
        references.set(key, reference)
      }
    }
  }

  return [...references.values()].sort((a, b) => {
    const kindCompare = a.kind.localeCompare(b.kind)
    if (kindCompare !== 0) return kindCompare
    const repoCompare = (a.repository ?? '').localeCompare(b.repository ?? '')
    if (repoCompare !== 0) return repoCompare
    return a.number - b.number
  })
}

function extractGithubUrlReferences(text: string): TaskReportReference[] {
  const references: TaskReportReference[] = []
  const urlPattern =
    /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(pull|issues)\/(\d+)/g
  for (const match of text.matchAll(urlPattern)) {
    const repository = match[1]
    const kind = match[2] === 'pull' ? 'pull_request' : 'issue'
    const number = Number(match[3])
    const url = match[0]
    if (repository && Number.isSafeInteger(number)) {
      references.push({
        kind,
        number,
        repository,
        url,
      })
    }
  }
  return references
}

function extractShorthandReferences(text: string): TaskReportReference[] {
  const references: TaskReportReference[] = []
  for (const match of text.matchAll(/(?<![A-Za-z0-9_])#(\d+)\b/g)) {
    const number = Number(match[1])
    if (Number.isSafeInteger(number)) {
      references.push({ kind: 'unknown', number })
    }
  }
  return references
}

function formatChangedFiles(
  changedFileSources: Map<string, Set<'tool' | 'git'>>,
): TaskReportChangedFile[] {
  return [...changedFileSources.entries()]
    .map(([path, sources]) => ({
      path,
      sources: [...sources].sort() as Array<'tool' | 'git'>,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function addChangedFileSource(
  changedFileSources: Map<string, Set<'tool' | 'git'>>,
  path: string,
  source: 'tool' | 'git',
  cwd: string,
) {
  const redactedPath = redact(normalizeChangedFilePath(path, cwd))
  const sources = changedFileSources.get(redactedPath) ?? new Set<'tool' | 'git'>()
  sources.add(source)
  changedFileSources.set(redactedPath, sources)
}

function normalizeChangedFilePath(path: string, cwd: string): string {
  const value = path.trim()
  const posixRelative = relativeWithinCwd(value, cwd, isAbsolute, relative)
  if (posixRelative) return posixRelative.replaceAll('\\', '/')

  const windowsRelative = relativeWithinCwd(
    value,
    cwd,
    win32.isAbsolute,
    win32.relative,
  )
  if (windowsRelative) return windowsRelative.replaceAll('\\', '/')

  return value
}

function relativeWithinCwd(
  path: string,
  cwd: string,
  isAbsolutePath: (value: string) => boolean,
  relativePath: (from: string, to: string) => string,
): string | undefined {
  if (!isAbsolutePath(path) || !isAbsolutePath(cwd)) return undefined
  const relativePathValue = relativePath(cwd, path)
  const isOutsideCwd =
    relativePathValue === '..' ||
    relativePathValue.startsWith('../') ||
    relativePathValue.startsWith('..\\')
  if (
    !relativePathValue ||
    isOutsideCwd ||
    isAbsolutePath(relativePathValue)
  ) {
    return undefined
  }
  return relativePathValue
}

function isValidationCommand(command: string): boolean {
  return VALIDATION_COMMAND_PATTERNS.some(pattern => pattern.test(command))
}

function parseGitStatusChangedFiles(stdout: string): string[] {
  const changedFiles: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue
    const pathPart = rawLine.length > 3 ? rawLine.slice(3).trim() : rawLine.trim()
    const renamedPath = pathPart.includes(' -> ')
      ? pathPart.slice(pathPart.lastIndexOf(' -> ') + ' -> '.length)
      : pathPart
    const unquoted = renamedPath.replace(/^"|"$/g, '')
    if (unquoted) changedFiles.push(unquoted)
  }
  return changedFiles
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<TaskReportGitCommandResult> {
  try {
    const result = await execa('git', args, {
      cwd,
      reject: false,
      timeout: 3_000,
      maxBuffer: 1_000_000,
    })
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.exitCode ?? 0,
    }
  } catch (error) {
    const execaError = error as {
      stdout?: unknown
      stderr?: unknown
      exitCode?: unknown
      timedOut?: unknown
    }
    const message = error instanceof Error ? error.message : String(error)
    return {
      stdout: typeof execaError.stdout === 'string' ? execaError.stdout : '',
      stderr: typeof execaError.stderr === 'string' ? execaError.stderr : '',
      code:
        typeof execaError.exitCode === 'number'
          ? execaError.exitCode
          : execaError.timedOut === true
            ? 124
            : 1,
      error: execaError.timedOut === true ? 'git command timed out' : message,
    }
  }
}

function findSessionId(entries: JsonRecord[]): string | undefined {
  for (const entry of entries) {
    const sessionId = stringValue(entry.sessionId)
    if (sessionId) return sessionId
  }
  return undefined
}

function isToolResultEntry(entry: JsonRecord): boolean {
  if (entry.sourceToolAssistantUUID) return true
  const message = recordValue(entry.message)
  const content = message?.content
  return (
    Array.isArray(content) &&
    content.some(block => isRecord(block) && block.type === 'tool_result')
  )
}

function basenameWithoutExtension(path: string): string {
  const extension = extname(path)
  return extension ? basename(path, extension) : basename(path)
}

function truncateText(value: string, maxChars: number): TaskReportPreview {
  const safeMax = Math.max(1, maxChars)
  if (value.length <= safeMax) {
    return {
      preview: value,
      truncated: false,
      chars: value.length,
    }
  }
  return {
    preview: value.slice(0, safeMax),
    truncated: true,
    chars: value.length,
  }
}

function redact(value: string): string {
  return redactLikelySecrets(redactHomePath(value))
}

function redactObject(value: unknown): unknown {
  return redactDiagnosticObject(value)
}

function normalizeGitMetadata(
  metadata: TaskReportGitMetadata,
): TaskReportGitMetadata {
  return {
    status: metadata.status,
    cwd: redact(metadata.cwd),
    ...(metadata.branch ? { branch: redact(metadata.branch) } : {}),
    ...(metadata.head ? { head: redact(metadata.head) } : {}),
    ...(metadata.dirty !== undefined ? { dirty: metadata.dirty } : {}),
    changedFiles: sortUnique(metadata.changedFiles.map(path => redact(path))),
    ...(metadata.error ? { error: redact(metadata.error) } : {}),
  }
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function recordValue(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : undefined
}

function normalizeMaxPreviewChars(value: number | undefined): number {
  const candidate = value ?? DEFAULT_TASK_REPORT_PREVIEW_CHARS
  if (!Number.isFinite(candidate)) return DEFAULT_TASK_REPORT_PREVIEW_CHARS
  return Math.max(1, Math.floor(candidate))
}
