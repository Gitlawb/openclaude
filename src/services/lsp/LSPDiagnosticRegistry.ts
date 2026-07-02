import { randomUUID } from 'crypto'
import { LRUCache } from 'lru-cache'
import * as path from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { DiagnosticFile } from '../diagnosticTracking.js'

/**
 * Pending LSP diagnostic notification
 */
export type PendingLSPDiagnostic = {
  /** Server that sent the diagnostic */
  serverName: string
  /** Diagnostic files */
  files: DiagnosticFile[]
  /** When diagnostic was received */
  timestamp: number
  /** Whether attachment was already sent to conversation */
  attachmentSent: boolean
}

export type LSPDiagnosticSet = {
  serverName: string
  files: DiagnosticFile[]
}

/**
 * LSP Diagnostic Registry
 *
 * Stores LSP diagnostics received asynchronously from LSP servers via
 * textDocument/publishDiagnostics notifications. Follows the same pattern
 * as AsyncHookRegistry for consistent async attachment delivery.
 *
 * Pattern:
 * 1. LSP server sends publishDiagnostics notification
 * 2. registerPendingLSPDiagnostic() stores diagnostic
 * 3. checkForLSPDiagnostics() retrieves pending diagnostics
 * 4. getLSPDiagnosticAttachments() converts to Attachment[]
 * 5. getAttachments() delivers to conversation automatically
 *
 * Similar to AsyncHookRegistry but simpler since diagnostics arrive
 * synchronously (no need to accumulate output over time).
 */

// Volume limiting constants
const MAX_DIAGNOSTICS_PER_FILE = 10
const MAX_TOTAL_DIAGNOSTICS = 30

// Max files to track for deduplication - prevents unbounded memory growth
const MAX_DELIVERED_FILES = 500
const MAX_RECENT_FILES = 500

const DIAGNOSTIC_STORM_WINDOW_MS = 60_000
const DIAGNOSTIC_STORM_RAW_THRESHOLD = 200
const DIAGNOSTIC_STORM_LOG_THROTTLE_MS = 60_000
const RECENT_FILE_PRIORITY_WINDOW_MS = 5 * 60_000
const MAX_STORM_TOP_FILES = 5
const STORM_SUMMARY_URI_PREFIX = 'lsp://diagnostic-storm'

type DiagnosticWindowEvent = {
  timestamp: number
  rawCount: number
  duplicateCount: number
  droppedCount: number
  deliveredCount: number
  fileCounts: Map<string, number>
}

type DiagnosticWindowState = {
  events: DiagnosticWindowEvent[]
  lastStormSummaryLoggedAt: number | undefined
}

type RollingDiagnosticStats = {
  rawCount: number
  duplicateCount: number
  droppedCount: number
  deliveredCount: number
  topFiles: Array<{ uri: string; count: number }>
}

type DeduplicationResult = {
  files: DiagnosticFile[]
  duplicateCount: number
}

type LimitResult = {
  files: DiagnosticFile[]
  droppedCount: number
  deliveredCount: number
}

type ServerDeliveryPlan = {
  serverName: string
  deduplicationResult: DeduplicationResult
  prioritizedFiles: DiagnosticFile[]
  shouldSummarizeStorm: boolean
}

// Global registry state
const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>()

// Cross-turn deduplication: tracks diagnostics that have been delivered
// Maps file URI to a set of diagnostic keys (hash of message+severity+range)
// Using LRUCache to prevent unbounded growth in long sessions
const deliveredDiagnostics = new LRUCache<string, Set<string>>({
  max: MAX_DELIVERED_FILES,
})

const recentDiagnosticFileActivity = new LRUCache<string, number>({
  max: MAX_RECENT_FILES,
})

const diagnosticWindows = new Map<string, DiagnosticWindowState>()

function normalizeDiagnosticUri(uri: string): string {
  for (const prefix of ['file://', '_claude_fs_right:', '_claude_fs_left:']) {
    if (uri.startsWith(prefix)) {
      return uri.slice(prefix.length)
    }
  }
  return uri
}

function displayFileForStormSummary(uri: string): string {
  const normalized = normalizeDiagnosticUri(uri).replace(/\\/g, '/')
  return path.basename(normalized) || normalized || '<unknown>'
}

function getDiagnosticWindowState(serverName: string): DiagnosticWindowState {
  let state = diagnosticWindows.get(serverName)
  if (!state) {
    state = { events: [], lastStormSummaryLoggedAt: undefined }
    diagnosticWindows.set(serverName, state)
  }
  return state
}

function pruneDiagnosticWindow(serverName: string, now: number): void {
  const state = diagnosticWindows.get(serverName)
  if (!state) {
    return
  }

  state.events = state.events.filter(
    event => now - event.timestamp <= DIAGNOSTIC_STORM_WINDOW_MS,
  )

  if (
    state.events.length === 0 &&
    (state.lastStormSummaryLoggedAt === undefined ||
      now - state.lastStormSummaryLoggedAt > DIAGNOSTIC_STORM_LOG_THROTTLE_MS)
  ) {
    diagnosticWindows.delete(serverName)
  }
}

function recordDiagnosticWindowEvent(
  serverName: string,
  event: DiagnosticWindowEvent,
): void {
  const state = getDiagnosticWindowState(serverName)
  state.events.push(event)
  pruneDiagnosticWindow(serverName, event.timestamp)
}

function recordDiagnosticsReceived(
  serverName: string,
  files: DiagnosticFile[],
  now: number,
): void {
  const fileCounts = new Map<string, number>()
  let rawCount = 0

  for (const file of files) {
    const count = file.diagnostics.length
    if (count === 0) {
      continue
    }
    rawCount += count
    const normalizedUri = normalizeDiagnosticUri(file.uri)
    fileCounts.set(normalizedUri, (fileCounts.get(normalizedUri) ?? 0) + count)
  }

  if (rawCount === 0) {
    return
  }

  recordDiagnosticWindowEvent(serverName, {
    timestamp: now,
    rawCount,
    duplicateCount: 0,
    droppedCount: 0,
    deliveredCount: 0,
    fileCounts,
  })
}

function recordDiagnosticsDelivery(
  serverName: string,
  stats: {
    duplicateCount: number
    droppedCount: number
    deliveredCount: number
  },
  now: number,
): void {
  if (
    stats.duplicateCount === 0 &&
    stats.droppedCount === 0 &&
    stats.deliveredCount === 0
  ) {
    return
  }

  recordDiagnosticWindowEvent(serverName, {
    timestamp: now,
    rawCount: 0,
    duplicateCount: stats.duplicateCount,
    droppedCount: stats.droppedCount,
    deliveredCount: stats.deliveredCount,
    fileCounts: new Map(),
  })
}

function getRollingDiagnosticStats(
  serverName: string,
  now: number,
): RollingDiagnosticStats {
  pruneDiagnosticWindow(serverName, now)
  const state = diagnosticWindows.get(serverName)
  const fileCounts = new Map<string, number>()
  const stats: RollingDiagnosticStats = {
    rawCount: 0,
    duplicateCount: 0,
    droppedCount: 0,
    deliveredCount: 0,
    topFiles: [],
  }

  if (!state) {
    return stats
  }

  for (const event of state.events) {
    stats.rawCount += event.rawCount
    stats.duplicateCount += event.duplicateCount
    stats.droppedCount += event.droppedCount
    stats.deliveredCount += event.deliveredCount

    for (const [uri, count] of event.fileCounts) {
      fileCounts.set(uri, (fileCounts.get(uri) ?? 0) + count)
    }
  }

  stats.topFiles = Array.from(fileCounts.entries())
    .map(([uri, count]) => ({ uri, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }
      return displayFileForStormSummary(a.uri).localeCompare(
        displayFileForStormSummary(b.uri),
      )
    })
    .slice(0, MAX_STORM_TOP_FILES)

  return stats
}

function shouldAttachStormSummary(stats: RollingDiagnosticStats): boolean {
  return stats.rawCount > DIAGNOSTIC_STORM_RAW_THRESHOLD
}

function formatStormSummary(
  serverName: string,
  stats: RollingDiagnosticStats,
): string {
  const topFiles =
    stats.topFiles.length === 0
      ? 'none'
      : stats.topFiles
          .map(file => `${displayFileForStormSummary(file.uri)}:${file.count}`)
          .join(', ')

  return (
    `LSP diagnostic storm: server=${serverName} ` +
    `raw=${stats.rawCount} duplicates=${stats.duplicateCount} ` +
    `dropped=${stats.droppedCount} delivered=${stats.deliveredCount} ` +
    `topFiles=[${topFiles}]`
  )
}

function buildStormSummaryFile(
  serverName: string,
  stats: RollingDiagnosticStats,
): DiagnosticFile {
  return {
    uri: `${STORM_SUMMARY_URI_PREFIX}/${encodeURIComponent(serverName)}`,
    diagnostics: [
      {
        message: formatStormSummary(serverName, stats),
        severity: 'Info',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        source: 'openclaude-lsp',
        code: 'diagnostic-storm',
      },
    ],
  }
}

function maybeLogStormSummary(
  serverName: string,
  stats: RollingDiagnosticStats,
  now: number,
): void {
  const state = getDiagnosticWindowState(serverName)
  if (
    state.lastStormSummaryLoggedAt !== undefined &&
    now - state.lastStormSummaryLoggedAt < DIAGNOSTIC_STORM_LOG_THROTTLE_MS
  ) {
    return
  }

  state.lastStormSummaryLoggedAt = now
  logForDebugging(formatStormSummary(serverName, stats))
}

/**
 * Record an LSP file interaction so diagnostics for recently opened or edited
 * files are preserved first when a diagnostic burst exceeds the per-turn cap.
 */
export function recordLSPDiagnosticFileActivity(
  fileUri: string,
  timestamp = Date.now(),
): void {
  recentDiagnosticFileActivity.set(normalizeDiagnosticUri(fileUri), timestamp)
}

/**
 * Register LSP diagnostics received from a server.
 * These will be delivered as attachments in the next query.
 *
 * @param serverName - Name of LSP server that sent diagnostics
 * @param files - Diagnostic files to deliver
 */
export function registerPendingLSPDiagnostic({
  serverName,
  files,
  timestamp = Date.now(),
}: {
  serverName: string
  files: DiagnosticFile[]
  timestamp?: number
}): void {
  // Use UUID for guaranteed uniqueness (handles rapid registrations)
  const diagnosticId = randomUUID()

  recordDiagnosticsReceived(serverName, files, timestamp)

  pendingDiagnostics.set(diagnosticId, {
    serverName,
    files,
    timestamp,
    attachmentSent: false,
  })
}

/**
 * Maps severity string to numeric value for sorting.
 * Error=1, Warning=2, Info=3, Hint=4
 */
function severityToNumber(severity: string | undefined): number {
  switch (severity) {
    case 'Error':
      return 1
    case 'Warning':
      return 2
    case 'Info':
      return 3
    case 'Hint':
      return 4
    default:
      return 4
  }
}

/**
 * Creates a unique key for a diagnostic based on its content.
 * Used for both within-batch and cross-turn deduplication.
 */
function createDiagnosticKey(diag: {
  message: string
  severity?: string
  range?: unknown
  source?: string
  code?: unknown
}): string {
  return jsonStringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source || null,
    code: diag.code || null,
  })
}

/**
 * Deduplicates diagnostics by file URI and diagnostic content.
 * When filterPreviouslyDelivered is true, also filters out diagnostics that
 * were already delivered in previous turns.
 * Two diagnostics are considered duplicates if they have the same:
 * - File URI
 * - Range (start/end line and character)
 * - Message
 * - Severity
 * - Source and code (if present)
 */
function deduplicateDiagnosticFiles(
  allFiles: DiagnosticFile[],
  options: { filterPreviouslyDelivered?: boolean } = {
    filterPreviouslyDelivered: true,
  },
): DeduplicationResult {
  // Group diagnostics by file URI
  const fileMap = new Map<string, Set<string>>()
  const dedupedFileMap = new Map<string, DiagnosticFile>()
  const dedupedFiles: DiagnosticFile[] = []
  let duplicateCount = 0

  for (const file of allFiles) {
    const normalizedUri = normalizeDiagnosticUri(file.uri)
    if (!fileMap.has(normalizedUri)) {
      fileMap.set(normalizedUri, new Set())
      const dedupedFile = { uri: file.uri, diagnostics: [] }
      dedupedFileMap.set(normalizedUri, dedupedFile)
      dedupedFiles.push(dedupedFile)
    }

    const seenDiagnostics = fileMap.get(normalizedUri)!
    const dedupedFile = dedupedFileMap.get(normalizedUri)!

    // Get previously delivered diagnostics for this file (for cross-turn dedup)
    const previouslyDelivered =
      options.filterPreviouslyDelivered === false
        ? new Set<string>()
        : deliveredDiagnostics.get(normalizedUri) || new Set()

    for (const diag of file.diagnostics) {
      try {
        const key = createDiagnosticKey(diag)

        // Skip if already seen in this batch OR already delivered in previous turns
        if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) {
          duplicateCount++
          continue
        }

        seenDiagnostics.add(key)
        dedupedFile.diagnostics.push(diag)
      } catch (error: unknown) {
        const err = toError(error)
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>'
        logError(
          new Error(
            `Failed to deduplicate diagnostic in ${file.uri}: ${err.message}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        )
        // Include the diagnostic anyway to avoid losing information
        dedupedFile.diagnostics.push(diag)
      }
    }
  }

  // Filter out files with no diagnostics after deduplication
  return {
    files: dedupedFiles.filter(f => f.diagnostics.length > 0),
    duplicateCount,
  }
}

function prioritizeDiagnosticFiles(
  files: DiagnosticFile[],
  now: number,
): DiagnosticFile[] {
  return files
    .map((file, index) => {
      const lastActivity = recentDiagnosticFileActivity.get(
        normalizeDiagnosticUri(file.uri),
      )
      const isRecent =
        lastActivity !== undefined &&
        now - lastActivity <= RECENT_FILE_PRIORITY_WINDOW_MS

      return { file, index, isRecent, lastActivity: lastActivity ?? 0 }
    })
    .sort((a, b) => {
      if (a.isRecent !== b.isRecent) {
        return a.isRecent ? -1 : 1
      }
      if (a.isRecent && b.isRecent && a.lastActivity !== b.lastActivity) {
        return b.lastActivity - a.lastActivity
      }
      return a.index - b.index
    })
    .map(item => item.file)
}

function limitDiagnosticFiles(
  files: DiagnosticFile[],
  capacity: number,
): LimitResult {
  const limitedFiles: DiagnosticFile[] = []
  let remainingCapacity = Math.max(0, capacity)
  let droppedCount = 0
  let deliveredCount = 0

  for (const file of files) {
    const sortedDiagnostics = [...file.diagnostics].sort(
      (a, b) => severityToNumber(a.severity) - severityToNumber(b.severity),
    )

    let diagnostics = sortedDiagnostics
    if (diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      droppedCount += diagnostics.length - MAX_DIAGNOSTICS_PER_FILE
      diagnostics = diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE)
    }

    if (remainingCapacity <= 0) {
      droppedCount += diagnostics.length
      continue
    }

    if (diagnostics.length > remainingCapacity) {
      droppedCount += diagnostics.length - remainingCapacity
      diagnostics = diagnostics.slice(0, remainingCapacity)
    }

    remainingCapacity -= diagnostics.length
    deliveredCount += diagnostics.length

    if (diagnostics.length > 0) {
      limitedFiles.push({ uri: file.uri, diagnostics })
    }
  }

  return { files: limitedFiles, droppedCount, deliveredCount }
}

function trackDeliveredDiagnostics(files: DiagnosticFile[]): void {
  for (const file of files) {
    const normalizedUri = normalizeDiagnosticUri(file.uri)
    if (!deliveredDiagnostics.has(normalizedUri)) {
      deliveredDiagnostics.set(normalizedUri, new Set())
    }
    const delivered = deliveredDiagnostics.get(normalizedUri)!
    for (const diag of file.diagnostics) {
      try {
        delivered.add(createDiagnosticKey(diag))
      } catch (error: unknown) {
        // Log but continue - failure to track shouldn't prevent delivery
        const err = toError(error)
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>'
        logError(
          new Error(
            `Failed to track delivered diagnostic in ${file.uri}: ${err.message}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        )
      }
    }
  }
}

function collectUndeliveredDiagnosticFiles(): {
  filesByServer: Map<string, DiagnosticFile[]>
  diagnosticsToMark: PendingLSPDiagnostic[]
} {
  const filesByServer = new Map<string, DiagnosticFile[]>()
  const diagnosticsToMark: PendingLSPDiagnostic[] = []

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      if (!filesByServer.has(diagnostic.serverName)) {
        filesByServer.set(diagnostic.serverName, [])
      }
      filesByServer.get(diagnostic.serverName)!.push(...diagnostic.files)
      diagnosticsToMark.push(diagnostic)
    }
  }

  return { filesByServer, diagnosticsToMark }
}

/**
 * Read pending LSP diagnostics without marking them delivered.
 * Used by user-facing inspection surfaces that must not drain passive
 * diagnostic feedback attachments.
 */
export function getPendingLSPDiagnosticsSnapshot(): LSPDiagnosticSet[] {
  const now = Date.now()
  logForDebugging(
    `LSP Diagnostics: Snapshotting registry - ${pendingDiagnostics.size} pending`,
  )

  const { filesByServer } = collectUndeliveredDiagnosticFiles()
  if (filesByServer.size === 0) {
    return []
  }

  const snapshotSets: LSPDiagnosticSet[] = []
  let remainingCapacity = MAX_TOTAL_DIAGNOSTICS

  for (const [serverName, files] of filesByServer) {
    let deduplicationResult: DeduplicationResult
    try {
      deduplicationResult = deduplicateDiagnosticFiles(files, {
        filterPreviouslyDelivered: false,
      })
    } catch (error: unknown) {
      const err = toError(error)
      logError(
        new Error(`Failed to deduplicate LSP diagnostics: ${err.message}`),
      )
      deduplicationResult = { files, duplicateCount: 0 }
    }

    const prioritizedFiles = prioritizeDiagnosticFiles(
      deduplicationResult.files,
      now,
    )
    const limitResult = limitDiagnosticFiles(prioritizedFiles, remainingCapacity)
    if (limitResult.files.length > 0) {
      snapshotSets.push({
        serverName,
        files: limitResult.files.map(cloneDiagnosticFile),
      })
    }
    remainingCapacity -= limitResult.deliveredCount
  }

  return snapshotSets
}

function cloneDiagnosticFile(file: DiagnosticFile): DiagnosticFile {
  return {
    uri: file.uri,
    diagnostics: file.diagnostics.map(diagnostic => ({
      ...diagnostic,
      range: {
        start: { ...diagnostic.range.start },
        end: { ...diagnostic.range.end },
      },
    })),
  }
}

/**
 * Get all pending LSP diagnostics that haven't been delivered yet.
 * Deduplicates diagnostics to prevent sending the same diagnostic multiple times.
 * Marks diagnostics as sent to prevent duplicate delivery.
 *
 * @returns Array of pending diagnostics ready for delivery (deduplicated)
 */
export function checkForLSPDiagnostics(): LSPDiagnosticSet[] {
  const now = Date.now()
  logForDebugging(
    `LSP Diagnostics: Checking registry - ${pendingDiagnostics.size} pending`,
  )

  const { filesByServer, diagnosticsToMark } =
    collectUndeliveredDiagnosticFiles()

  if (filesByServer.size === 0) {
    return []
  }

  // Only mark as sent AFTER successful deduplication, then delete from map.
  // Entries are tracked in deliveredDiagnostics LRU for dedup, so we don't
  // need to keep them in pendingDiagnostics after delivery.
  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true
  }
  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id)
    }
  }

  const serverNames: string[] = []
  const deliveredFiles: DiagnosticFile[] = []
  let duplicateCount = 0
  let droppedCount = 0
  let deliveredCount = 0
  const deliveryPlans: ServerDeliveryPlan[] = []

  for (const [serverName, files] of filesByServer) {
    let deduplicationResult: DeduplicationResult
    try {
      deduplicationResult = deduplicateDiagnosticFiles(files)
    } catch (error: unknown) {
      const err = toError(error)
      logError(
        new Error(`Failed to deduplicate LSP diagnostics: ${err.message}`),
      )
      // Fall back to undedup'd files to avoid losing diagnostics.
      deduplicationResult = { files, duplicateCount: 0 }
    }

    const statsBeforeDelivery = getRollingDiagnosticStats(serverName, now)
    const shouldSummarizeStorm = shouldAttachStormSummary(statsBeforeDelivery)
    const prioritizedFiles = prioritizeDiagnosticFiles(
      deduplicationResult.files,
      now,
    )

    deliveryPlans.push({
      serverName,
      deduplicationResult,
      prioritizedFiles,
      shouldSummarizeStorm,
    })
  }

  const reservedStormSummaryCount = Math.min(
    MAX_TOTAL_DIAGNOSTICS,
    deliveryPlans.filter(plan => plan.shouldSummarizeStorm).length,
  )
  let remainingCapacity = MAX_TOTAL_DIAGNOSTICS - reservedStormSummaryCount
  let remainingStormSummarySlots = reservedStormSummaryCount

  // The total diagnostic cap is global for the turn. Reserve compact storm
  // summary slots before allocating full diagnostics so one server cannot hide
  // another storming server's summary by exhausting the payload budget first.
  for (const plan of deliveryPlans) {
    const {
      serverName,
      deduplicationResult,
      prioritizedFiles,
      shouldSummarizeStorm,
    } = plan
    serverNames.push(serverName)

    const summarySlotReserved =
      shouldSummarizeStorm && remainingStormSummarySlots > 0
    if (summarySlotReserved) {
      remainingStormSummarySlots--
    }

    const limitResult = limitDiagnosticFiles(prioritizedFiles, remainingCapacity)

    recordDiagnosticsDelivery(
      serverName,
      {
        duplicateCount: deduplicationResult.duplicateCount,
        droppedCount: limitResult.droppedCount,
        deliveredCount: limitResult.deliveredCount,
      },
      now,
    )

    const statsAfterDelivery = getRollingDiagnosticStats(serverName, now)
    if (summarySlotReserved) {
      deliveredFiles.push(buildStormSummaryFile(serverName, statsAfterDelivery))
      maybeLogStormSummary(serverName, statsAfterDelivery, now)
    }

    // Volume caps intentionally drop diagnostics for the turn; account for the
    // full deduplicated batch so unchanged storms cannot trickle old diagnostics
    // into later turns one capped slice at a time.
    trackDeliveredDiagnostics(deduplicationResult.files)
    deliveredFiles.push(...limitResult.files)
    remainingCapacity -= limitResult.deliveredCount
    duplicateCount += deduplicationResult.duplicateCount
    droppedCount += limitResult.droppedCount
    deliveredCount += limitResult.deliveredCount

    if (remainingCapacity <= 0 && serverNames.length < filesByServer.size) {
      logForDebugging(
        `LSP Diagnostics: Global turn capacity exhausted after ${serverName}; later server diagnostics will be summarized or dropped`,
      )
    }
  }

  // Return empty if no diagnostics to deliver (all filtered by deduplication)
  if (deliveredFiles.length === 0) {
    logForDebugging(
      `LSP Diagnostics: No new diagnostics to deliver (all filtered by deduplication)`,
    )
    return []
  }

  if (duplicateCount > 0) {
    logForDebugging(
      `LSP Diagnostics: Deduplication removed ${duplicateCount} duplicate diagnostic(s)`,
    )
  }

  if (droppedCount > 0) {
    logForDebugging(
      `LSP Diagnostics: Volume limiting removed ${droppedCount} diagnostic(s) (max ${MAX_DIAGNOSTICS_PER_FILE}/file, ${MAX_TOTAL_DIAGNOSTICS} total)`,
    )
  }

  logForDebugging(
    `LSP Diagnostics: Delivering ${deliveredFiles.length} file(s) with ${deliveredCount} diagnostic(s) from ${serverNames.length} server(s)`,
  )

  // Return single result with all deduplicated diagnostics
  return [
    {
      serverName: serverNames.join(', '),
      files: deliveredFiles,
    },
  ]
}

/**
 * Clear all pending diagnostics.
 * Used during cleanup/shutdown or for testing.
 * Note: Does NOT clear deliveredDiagnostics - that's for cross-turn deduplication
 * and should only be cleared when files are edited or on session reset.
 */
export function clearAllLSPDiagnostics(): void {
  logForDebugging(
    `LSP Diagnostics: Clearing ${pendingDiagnostics.size} pending diagnostic(s)`,
  )
  pendingDiagnostics.clear()
}

/**
 * Reset all diagnostic state including cross-turn tracking.
 * Used on session reset or for testing.
 */
export function resetAllLSPDiagnosticState(): void {
  logForDebugging(
    `LSP Diagnostics: Resetting all state (${pendingDiagnostics.size} pending, ${deliveredDiagnostics.size} files tracked)`,
  )
  pendingDiagnostics.clear()
  deliveredDiagnostics.clear()
  recentDiagnosticFileActivity.clear()
  diagnosticWindows.clear()
}

/**
 * Clear delivered diagnostics for a specific file.
 * Should be called when a file is edited so that new diagnostics for that file
 * will be shown even if they match previously delivered ones.
 *
 * @param fileUri - URI of the file that was edited
 */
export function clearDeliveredDiagnosticsForFile(fileUri: string): void {
  const normalizedUri = normalizeDiagnosticUri(fileUri)
  if (deliveredDiagnostics.has(normalizedUri)) {
    logForDebugging(
      `LSP Diagnostics: Clearing delivered diagnostics for ${fileUri}`,
    )
    deliveredDiagnostics.delete(normalizedUri)
  }
}

/**
 * Get count of pending diagnostics (for monitoring)
 */
export function getPendingLSPDiagnosticCount(): number {
  return pendingDiagnostics.size
}
