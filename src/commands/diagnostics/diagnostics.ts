import { stripVTControlCharacters } from 'node:util'

import type { Diagnostic } from '../../services/diagnosticTracking.js'
import {
  getPendingLSPDiagnosticsSnapshot,
  type LSPDiagnosticSet,
} from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getInitializationStatus } from '../../services/lsp/manager.js'
import { toError } from '../../utils/errors.js'
import { escapeXml } from '../../utils/xml.js'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'

type InitializationStatus = ReturnType<typeof getInitializationStatus>
type TextCommandResult = Extract<LocalCommandResult, { type: 'text' }>
type DiagnosticEntry = { diagnostic: Diagnostic; serverName: string }
type GroupedDiagnosticFile = { uri: string; diagnostics: DiagnosticEntry[] }

export type DiagnosticsCommandDeps = {
  getInitializationStatus: () => InitializationStatus
  getPendingLSPDiagnosticsSnapshot: () => LSPDiagnosticSet[]
}

const DEFAULT_DEPS: DiagnosticsCommandDeps = {
  getInitializationStatus,
  getPendingLSPDiagnosticsSnapshot,
}

const MAX_DIAGNOSTICS_OUTPUT_CHARS = 4_000
const MAX_DISPLAY_FIELD_CHARS = 1_000
const MAX_TRUNCATION_LINE_BACKTRACK = 120
const FIELD_TRUNCATION_MARKER = '...[truncated]'
const TRUNCATION_MARKER = '\n...[truncated]'
const SEVERITY_ORDER: Diagnostic['severity'][] = [
  'Error',
  'Warning',
  'Info',
  'Hint',
]

export const call: LocalCommandCall = args =>
  runDiagnosticsCommand(args, DEFAULT_DEPS)

export async function runDiagnosticsCommand(
  _args: string,
  deps: DiagnosticsCommandDeps = DEFAULT_DEPS,
): Promise<TextCommandResult> {
  let status: InitializationStatus
  try {
    status = deps.getInitializationStatus()
  } catch (error) {
    return unavailable(toError(error).message)
  }

  if (status.status === 'not-started') {
    return text(
      'LSP diagnostics unavailable: LSP is not initialized. OpenClaude initializes LSP only after workspace trust is established.',
    )
  }
  if (status.status === 'pending') {
    return text(
      'LSP diagnostics unavailable: LSP initialization is still in progress.',
    )
  }
  if (status.status === 'failed') {
    return unavailable(status.error.message)
  }

  let diagnosticSets: LSPDiagnosticSet[]
  try {
    diagnosticSets = deps.getPendingLSPDiagnosticsSnapshot()
  } catch (error) {
    return unavailable(toError(error).message)
  }

  if (
    !diagnosticSets.some(set =>
      set.files.some(file => file.diagnostics.length > 0),
    )
  ) {
    return text('No LSP diagnostics available.')
  }

  return text(formatDiagnosticsOutput(diagnosticSets))
}

export function formatDiagnosticsOutput(
  diagnosticSets: LSPDiagnosticSet[],
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? MAX_DIAGNOSTICS_OUTPUT_CHARS
  const output = createOutputBuilder(maxChars)
  if (!output.appendLine('LSP diagnostics')) {
    return output.value()
  }

  for (const file of mergeDiagnosticSets(diagnosticSets)) {
    if (
      !output.appendLine('') ||
      !output.appendLine(sanitizeDisplayField(file.uri))
    ) {
      return output.value()
    }

    for (const severity of SEVERITY_ORDER) {
      const diagnostics = file.diagnostics
        .filter(entry => entry.diagnostic.severity === severity)
        .sort(compareDiagnosticEntries)
      if (diagnostics.length === 0) {
        continue
      }

      if (!output.appendLine(`  ${severity}`)) {
        return output.value()
      }

      for (const entry of diagnostics) {
        if (!output.appendLine(`    - ${formatDiagnostic(entry)}`)) {
          return output.value()
        }
      }
    }
  }

  return output.value()
}

function text(value: string): TextCommandResult {
  return { type: 'text', value }
}

function unavailable(message: string): TextCommandResult {
  return text(`LSP diagnostics unavailable: ${sanitizeDisplayField(message)}`)
}

function mergeDiagnosticSets(
  diagnosticSets: LSPDiagnosticSet[],
): GroupedDiagnosticFile[] {
  const byUri = new Map<string, DiagnosticEntry[]>()
  for (const set of diagnosticSets) {
    for (const file of set.files) {
      if (file.diagnostics.length === 0) {
        continue
      }
      const diagnostics = byUri.get(file.uri) ?? []
      diagnostics.push(
        ...file.diagnostics.map(diagnostic => ({
          diagnostic,
          serverName: set.serverName,
        })),
      )
      byUri.set(file.uri, diagnostics)
    }
  }

  return Array.from(byUri.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uri, diagnostics]) => ({ uri, diagnostics }))
}

function formatDiagnostic(entry: DiagnosticEntry): string {
  const { diagnostic, serverName } = entry
  const line = diagnostic.range.start.line + 1
  const character = diagnostic.range.start.character + 1
  const code = diagnostic.code
    ? ` [${sanitizeDisplayField(diagnostic.code)}]`
    : ''
  const provenance = formatProvenance(diagnostic, serverName)
  const message = sanitizeDisplayField(diagnostic.message)
  return `Line ${line}:${character} ${message}${code}${provenance}`
}

function formatProvenance(diagnostic: Diagnostic, serverName: string): string {
  const source = diagnostic.source ? sanitizeDisplayField(diagnostic.source) : ''
  const server = serverName ? sanitizeDisplayField(serverName) : ''
  if (source && server && source !== server) {
    return ` (${source}; server: ${server})`
  }
  if (source) {
    return ` (${source})`
  }
  if (server) {
    return ` (server: ${server})`
  }
  return ''
}

function sanitizeDisplayField(value: string): string {
  const withoutControlSequences = stripVTControlCharacters(value)
  const singleLine = withoutControlSequences
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
  const visible =
    singleLine.length > MAX_DISPLAY_FIELD_CHARS
      ? singleLine.slice(0, MAX_DISPLAY_FIELD_CHARS) + FIELD_TRUNCATION_MARKER
      : singleLine
  // Text command results are embedded in local-command XML by some callers.
  return escapeXml(visible)
}

function compareDiagnosticEntries(
  a: DiagnosticEntry,
  b: DiagnosticEntry,
): number {
  const lineDelta =
    a.diagnostic.range.start.line - b.diagnostic.range.start.line
  if (lineDelta !== 0) return lineDelta
  const characterDelta =
    a.diagnostic.range.start.character - b.diagnostic.range.start.character
  if (characterDelta !== 0) return characterDelta
  const messageDelta = a.diagnostic.message.localeCompare(b.diagnostic.message)
  if (messageDelta !== 0) return messageDelta
  return a.serverName.localeCompare(b.serverName)
}

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) {
    return output
  }
  if (maxChars <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, Math.max(0, maxChars))
  }
  const limit = maxChars - TRUNCATION_MARKER.length
  const lastLineBreak = output.lastIndexOf('\n', limit)
  const lineBreakIsNearby =
    lastLineBreak > 0 && limit - lastLineBreak <= MAX_TRUNCATION_LINE_BACKTRACK
  const end = avoidSplitXmlEntity(
    output,
    lineBreakIsNearby ? lastLineBreak : limit,
  )
  return output.slice(0, end) + TRUNCATION_MARKER
}

function createOutputBuilder(maxChars: number): {
  appendLine: (line: string) => boolean
  value: () => string
} {
  let output = ''
  let truncated = false

  return {
    appendLine(line: string): boolean {
      if (truncated) {
        return false
      }

      const next = output.length === 0 ? line : `${output}\n${line}`
      if (next.length > maxChars) {
        output = truncateOutput(next, maxChars)
        truncated = true
        return false
      }

      output = next
      return true
    },
    value(): string {
      return output
    },
  }
}

function avoidSplitXmlEntity(output: string, end: number): number {
  const lastAmpersand = output.lastIndexOf('&', end - 1)
  if (lastAmpersand === -1) {
    return end
  }

  const lastSemicolon = output.lastIndexOf(';', end - 1)
  if (lastSemicolon > lastAmpersand) {
    return end
  }

  const nextSemicolon = output.indexOf(';', lastAmpersand)
  if (nextSemicolon >= end && nextSemicolon - lastAmpersand <= 10) {
    return lastAmpersand
  }

  return end
}
