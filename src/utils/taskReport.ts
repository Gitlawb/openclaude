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
  STATUS_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import {
  redactDiagnosticObject,
  redactHomePath,
  redactLikelySecrets,
} from './redaction.js'
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

export type TaskReportFormat = 'json' | 'markdown'

export type TaskReportArgs = {
  format: TaskReportFormat
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
const SHELL_COMMAND_TOOLS = new Set(['Bash', 'PowerShell'])

const VALIDATION_COMMAND_PATTERNS = [
  /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(?:build:verified|doctor:runtime(?::json)?|hardening:(?:check|strict)|integrations:check|security:pr-scan|verify:privacy|web:(?:build|typecheck)|test(?::[A-Za-z0-9_-]+)?|typecheck(?::[A-Za-z0-9_-]+)?|build|check|lint|smoke)(?=$|[\s;&|)"'])/,
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
  const taskNotificationStatuses = collectTaskNotificationStatuses(entries)
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
    const observedStatus = getObservedStatus(result)
    const status = isShellCommandTool(observed.name)
      ? reconcileShellStatus(
          observedStatus,
          taskNotificationStatuses.get(observed.id),
        )
      : observedStatus
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

    if (isShellCommandTool(observed.name)) {
      const rawCommand = extractShellCommand(observed.input)
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

export function formatTaskReportAsMarkdown(report: TaskReport): string {
  const lines: string[] = ['# Task Report', '']

  lines.push('## Summary')
  lines.push(`- Session: ${formatSessionSummary(report.session)}`)
  lines.push(`- Validation: ${formatValidationSummary(report.validations)}`)
  lines.push(`- Commands run: ${report.commands.length}`)
  lines.push(`- Files changed: ${report.changedFiles.length}`)
  lines.push(`- Tool uses: ${report.toolUses.length}`)
  lines.push(`- Errors: ${report.errors.length}`)
  lines.push(`- Warnings: ${report.warnings.length}`)
  lines.push('')

  lines.push('## Session')
  lines.push(`- ID: ${formatMaybeCode(report.session.id)}`)
  if (report.session.name) {
    lines.push(`- Title: ${markdownText(report.session.name)}`)
  }
  if (report.session.tag) lines.push(`- Tag: ${codeSpan(report.session.tag)}`)
  if (report.session.cwd) lines.push(`- CWD: ${codeSpan(report.session.cwd)}`)
  lines.push(`- Transcript: ${codeSpan(report.source.transcriptPath)}`)
  if (report.session.startedAt) {
    lines.push(`- Started: ${codeSpan(report.session.startedAt)}`)
  }
  if (report.session.endedAt) {
    lines.push(`- Ended: ${codeSpan(report.session.endedAt)}`)
  }
  if (report.session.initialRequest) {
    lines.push('- Initial request:')
    lines.push(
      indentBlock(formatFencedCode(report.session.initialRequest), '  '),
    )
  }
  lines.push(
    `- Models: ${
      report.session.models.length > 0
        ? report.session.models.map(codeSpan).join(', ')
        : 'none observed'
    }`,
  )
  lines.push('')

  lines.push('## Branching / Worktree')
  appendBranchMarkdown(lines, report)
  lines.push('')

  lines.push('## Changes')
  if (report.toolUses.length === 0) {
    lines.push('- No tool uses observed.')
  } else {
    for (const toolUse of report.toolUses) {
      lines.push(
        `- ${codeSpan(toolUse.status)} ${codeSpan(toolUse.name)}${
          toolUse.inputSummary ? ` - ${markdownText(toolUse.inputSummary)}` : ''
        }`,
      )
      if (toolUse.timestamp) {
        lines.push(`  - Time: ${codeSpan(toolUse.timestamp)}`)
      }
      if (toolUse.files.length > 0) {
        lines.push(`  - Files: ${toolUse.files.map(codeSpan).join(', ')}`)
      }
      appendPreviewMarkdown(lines, 'result', toolUse.resultSummary)
    }
  }
  lines.push('')

  lines.push('## Files changed')
  if (report.changedFiles.length === 0) {
    lines.push('- No changed files observed.')
  } else {
    for (const file of report.changedFiles) {
      lines.push(`- ${codeSpan(file.path)} (${file.sources.join(', ')})`)
    }
  }
  lines.push('')

  lines.push('## Commands run')
  appendCommandsMarkdown(lines, report.commands)
  lines.push('')

  lines.push('## Validation')
  if (report.validations.length === 0) {
    lines.push('- No validation commands were observed.')
  } else {
    appendCommandsMarkdown(lines, report.validations)
  }
  lines.push('')

  lines.push('## Errors / Warnings')
  appendErrorsAndWarningsMarkdown(lines, report)
  lines.push('')

  lines.push('## Risks / Follow-ups')
  lines.push('- Not represented in task report JSON v1.')
  lines.push('')

  return lines.join('\n')
}

export function formatTaskReport(
  report: TaskReport,
  format: TaskReportFormat,
): string {
  switch (format) {
    case 'json':
      return formatTaskReportAsJson(report)
    case 'markdown':
      return formatTaskReportAsMarkdown(report)
    default:
      throw new Error(`Unsupported task report format: ${String(format)}`)
  }
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

function formatSessionSummary(session: TaskReportSession): string {
  if (session.name) return markdownText(session.name)
  if (session.id) return codeSpan(session.id)
  return 'unknown'
}

function formatValidationSummary(validations: TaskReportValidation[]): string {
  if (validations.length === 0) return 'none observed'
  const passed = validations.filter(command => command.status === 'success').length
  const failed = validations.filter(command => command.status === 'error').length
  const unknown = validations.filter(command => command.status === 'unknown').length
  const cancelled = validations.filter(
    command => command.status === 'cancelled',
  ).length
  return `${passed} passed, ${failed} failed, ${unknown} unknown${
    cancelled > 0 ? `, ${cancelled} cancelled` : ''
  }`
}

function appendBranchMarkdown(lines: string[], report: TaskReport): void {
  let hasMetadata = false
  const branch = report.branch

  if (branch.transcriptBranch) {
    lines.push(`- Transcript branch: ${codeSpan(branch.transcriptBranch)}`)
    hasMetadata = true
  }

  if (branch.worktree) {
    const worktree = branch.worktree
    if (worktree.name) lines.push(`- Worktree: ${codeSpan(worktree.name)}`)
    if (worktree.path) lines.push(`- Worktree path: ${codeSpan(worktree.path)}`)
    if (worktree.branch) {
      lines.push(`- Worktree branch: ${codeSpan(worktree.branch)}`)
    }
    if (worktree.originalBranch) {
      lines.push(`- Original branch: ${codeSpan(worktree.originalBranch)}`)
    }
    if (worktree.originalHead) {
      lines.push(`- Original head: ${codeSpan(worktree.originalHead)}`)
    }
    if (worktree.originalCwd) {
      lines.push(`- Original CWD: ${codeSpan(worktree.originalCwd)}`)
    }
    hasMetadata = true
  }

  if (branch.pullRequest) {
    lines.push(`- Pull request: ${formatReference(branch.pullRequest)}`)
    hasMetadata = true
  }

  if (report.git) {
    lines.push(`- Git status: ${codeSpan(report.git.status)}`)
    lines.push(`- Git CWD: ${codeSpan(report.git.cwd)}`)
    if (report.git.branch) {
      lines.push(`- Git branch: ${codeSpan(report.git.branch)}`)
    }
    if (report.git.head) lines.push(`- Git head: ${codeSpan(report.git.head)}`)
    if (report.git.dirty !== undefined) {
      lines.push(`- Git dirty: ${report.git.dirty ? 'yes' : 'no'}`)
    }
    if (report.git.error) {
      lines.push(`- Git error: ${markdownText(report.git.error)}`)
    }
    hasMetadata = true
  }

  if (report.linkedReferences.length > 0) {
    lines.push('- Linked references:')
    for (const reference of report.linkedReferences) {
      lines.push(`  - ${reference.kind}: ${formatReference(reference)}`)
    }
    hasMetadata = true
  }

  if (!hasMetadata) {
    lines.push('- No branch, worktree, or git metadata available.')
  }
}

function appendCommandsMarkdown(
  lines: string[],
  commands: TaskReportCommand[],
): void {
  if (commands.length === 0) {
    lines.push('- No commands observed.')
    return
  }

  for (const command of commands) {
    const description = command.description
      ? ` - ${markdownText(command.description)}`
      : ''
    const exitCode =
      command.exitCode !== undefined ? ` (exit ${command.exitCode})` : ''
    const multilineCommand = hasLineBreak(command.command)
    const commandLabel = multilineCommand ? 'command' : codeSpan(command.command)
    lines.push(
      `- ${codeSpan(command.status)} ${commandLabel}${description}${exitCode}`,
    )
    if (multilineCommand) {
      lines.push('  - Command:')
      lines.push(
        indentBlock(formatFencedCode(command.command, 'shell'), '    '),
      )
    }
    if (command.timestamp) {
      lines.push(`  - Time: ${codeSpan(command.timestamp)}`)
    }
    appendPreviewMarkdown(lines, 'stdout', command.stdout)
    appendPreviewMarkdown(lines, 'stderr', command.stderr)
  }
}

function appendPreviewMarkdown(
  lines: string[],
  label: string,
  preview: TaskReportPreview | undefined,
): void {
  if (!preview || preview.preview.length === 0) return
  const suffix = preview.truncated ? ` (truncated, ${preview.chars} chars)` : ''
  lines.push(`  - ${label}${suffix}:`)
  lines.push(indentBlock(formatFencedCode(preview.preview), '    '))
}

function appendErrorsAndWarningsMarkdown(
  lines: string[],
  report: TaskReport,
): void {
  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push('- none')
    return
  }

  if (report.errors.length > 0) {
    lines.push('### Errors')
    for (const error of report.errors) {
      const context =
        error.toolName || error.toolUseId
          ? ` (${[
              error.toolName ? codeSpan(error.toolName) : undefined,
              error.toolUseId ? codeSpan(error.toolUseId) : undefined,
            ]
              .filter(Boolean)
              .join(', ')})`
          : ''
      const label = `${capitalize(error.source)} error${context}`
      appendProseMarkdown(lines, label, error.message)
    }
  }

  if (report.warnings.length > 0) {
    lines.push('### Warnings')
    for (const warning of report.warnings) {
      if (hasLineBreak(warning)) {
        appendProseMarkdown(lines, 'Warning', warning)
      } else {
        lines.push(`- ${markdownText(warning)}`)
      }
    }
  }
}

function appendProseMarkdown(
  lines: string[],
  label: string,
  value: string,
): void {
  if (hasLineBreak(value)) {
    lines.push(`- ${label}:`)
    lines.push(indentBlock(formatFencedCode(value), '  '))
    return
  }

  lines.push(`- ${label}: ${markdownText(value)}`)
}

function formatReference(reference: {
  number: number
  url?: string
  repository?: string
}): string {
  const label = `#${reference.number}`
  const safeUrl = reference.url ? formatMarkdownUrl(reference.url) : null
  const linked = safeUrl ? `[${label}](<${safeUrl}>)` : codeSpan(label)
  return reference.repository
    ? `${linked} (${codeSpan(reference.repository)})`
    : linked
}

function formatMarkdownUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function formatMaybeCode(value: string | null | undefined): string {
  return value ? codeSpan(value) : 'unknown'
}

function formatFencedCode(value: string, language = 'text'): string {
  const content = value.replaceAll('\r\n', '\n')
  const backtickRuns = content.match(/`+/g) ?? []
  const fenceLength = Math.max(
    3,
    ...backtickRuns.map(run => run.length + 1),
  )
  const fence = '`'.repeat(fenceLength)
  return `${fence}${language}\n${content}\n${fence}`
}

function codeSpan(value: string): string {
  const content = value
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', ' ')
  const backtickRuns = content.match(/`+/g) ?? []
  const fenceLength = Math.max(
    1,
    ...backtickRuns.map(run => run.length + 1),
  )
  const fence = '`'.repeat(fenceLength)
  const needsPadding = content.startsWith('`') || content.endsWith('`')
  return needsPadding
    ? `${fence} ${content} ${fence}`
    : `${fence}${content}${fence}`
}

function indentBlock(value: string, indent: string): string {
  return value
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n')
}

function markdownText(value: string): string {
  return escapeMarkdownText(singleLine(value))
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_\[\]<>])/g, '\\$1')
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value)
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value
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

function collectTaskNotificationStatuses(
  entries: JsonRecord[],
): Map<string, TaskReportStatus> {
  const statuses = new Map<string, TaskReportStatus>()
  for (const entry of entries) {
    if (isToolResultEntry(entry)) continue

    const text = extractRawMessageText(recordValue(entry.message))
    if (!text?.includes(`<${TASK_NOTIFICATION_TAG}`)) continue

    const toolUseId = extractXmlTag(text, TOOL_USE_ID_TAG)
    if (!toolUseId) continue

    const status = taskNotificationStatusToReportStatus(
      extractXmlTag(text, STATUS_TAG),
    )
    if (status) {
      statuses.set(toolUseId, status)
    }
  }
  return statuses
}

function taskNotificationStatusToReportStatus(
  status: string | undefined,
): TaskReportStatus | undefined {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'killed':
    case 'stopped':
      return 'cancelled'
    default:
      return undefined
  }
}

function reconcileShellStatus(
  observedStatus: TaskReportStatus,
  notificationStatus: TaskReportStatus | undefined,
): TaskReportStatus {
  return observedStatus === 'unknown'
    ? (notificationStatus ?? observedStatus)
    : observedStatus
}

function buildCommandReport(
  observed: ObservedToolUse,
  result: ObservedToolResult | undefined,
  status: TaskReportStatus,
  maxPreviewChars: number,
): TaskReportCommand | null {
  const input = recordValue(observed.input)
  const rawCommand = extractShellCommand(observed.input)
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

function extractShellCommand(input: unknown): string | undefined {
  const inputRecord = recordValue(input)
  return stringValue(inputRecord?.command)
}

function getObservedStatus(
  result: ObservedToolResult | undefined,
): TaskReportStatus {
  if (!result) return 'unknown'
  const structuredResult = recordValue(result.toolUseResult)
  if (structuredResult?.interrupted === true) return 'cancelled'
  if (stringValue(structuredResult?.backgroundTaskId)) return 'unknown'
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
  if (isShellCommandTool(toolName)) {
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

function extractRawMessageText(
  message: JsonRecord | null | undefined,
): string | undefined {
  if (!message) return undefined
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .map(block => {
      if (typeof block === 'string') return block
      if (!isRecord(block)) return undefined
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      return undefined
    })
    .filter((part): part is string => Boolean(part?.trim()))
  return parts.length > 0 ? parts.join('\n') : undefined
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

function extractXmlTag(text: string, tagName: string): string | undefined {
  const openingTag = `<${tagName}>`
  const closingTag = `</${tagName}>`
  const valueStart = text.indexOf(openingTag)
  if (valueStart === -1) return undefined

  const contentStart = valueStart + openingTag.length
  const valueEnd = text.indexOf(closingTag, contentStart)
  if (valueEnd === -1) return undefined

  const value = text.slice(contentStart, valueEnd).trim()
  return value || undefined
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

function isShellCommandTool(toolName: string): boolean {
  return SHELL_COMMAND_TOOLS.has(toolName)
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
