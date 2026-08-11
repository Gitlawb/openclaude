import { randomUUID, type UUID } from 'crypto'
import { mkdir, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type {
  ContentReplacementEntry,
  Entry,
  GoalStateEntry,
  LogOption,
  SerializedMessage,
  SessionBranchEntry,
  TranscriptMessage,
} from '../../types/logs.js'
import type { Message } from '../../types/message.js'
import {
  buildConversationChain,
  flushSessionStorage,
  getTranscriptPath,
  loadTranscriptFile,
  saveCustomTitle,
  searchSessionsByCustomTitle,
} from '../../utils/sessionStorage.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { escapeRegExp } from '../../utils/stringUtils.js'
import { filterContentReplacementsForMessages } from '../../utils/toolResultStorage.js'

const NO_BRANCHABLE_MESSAGES =
  'No conversation messages to branch yet. Send a message first, then run /branch [name].'

type CopiedForkMetadata = Pick<
  LogOption,
  'tag' | 'agentName' | 'agentColor' | 'agentSetting' | 'mode' | 'goal'
>

type LegacyForkedTranscriptMessage = TranscriptMessage & {
  forkedFrom?: {
    sessionId?: unknown
  }
}

function findLegacyForkRootSessionId(
  entries: TranscriptMessage[],
): UUID | undefined {
  const legacyFork = entries.findLast(entry => {
    const forkedFrom = (entry as LegacyForkedTranscriptMessage).forkedFrom
    return typeof forkedFrom?.sessionId === 'string'
  }) as LegacyForkedTranscriptMessage | undefined

  return typeof legacyFork?.forkedFrom?.sessionId === 'string'
    ? (legacyFork.forkedFrom.sessionId as UUID)
    : undefined
}

function findLatestBranchLeaf(
  messages: Iterable<TranscriptMessage>,
  leafUuids: Set<UUID>,
  sessionId: UUID,
): TranscriptMessage | undefined {
  let latest: TranscriptMessage | undefined
  let maxTime = -Infinity

  for (const message of messages) {
    if (
      message.sessionId !== sessionId ||
      !leafUuids.has(message.uuid) ||
      message.isSidechain ||
      (message.type !== 'user' && message.type !== 'assistant')
    ) {
      continue
    }
    const time = Date.parse(message.timestamp)
    if (time > maxTime) {
      maxTime = time
      latest = message
    }
  }

  return latest
}

function findCurrentBranchLeaf(
  transcriptMessages: Map<UUID, TranscriptMessage>,
  currentMessages: Message[],
  sessionId: UUID,
): TranscriptMessage | undefined {
  for (let i = currentMessages.length - 1; i >= 0; i--) {
    const message = currentMessages[i]
    if (message?.type !== 'user' && message?.type !== 'assistant') continue
    const transcriptMessage = transcriptMessages.get(message.uuid)
    if (
      transcriptMessage &&
      transcriptMessage.sessionId === sessionId &&
      !transcriptMessage.isSidechain
    ) {
      return transcriptMessage
    }
  }
  return undefined
}

function normalizeMode(mode: string | undefined): LogOption['mode'] {
  // Keep this in sync with LogOption['mode']; loadTranscriptFile returns the
  // raw persisted string because older transcripts can carry unknown values.
  return mode === 'coordinator' || mode === 'normal' ? mode : undefined
}

function buildCopiedMetadataEntries(
  sessionId: UUID,
  metadata: CopiedForkMetadata,
): Entry[] {
  const entries: Entry[] = []

  if (metadata.tag) {
    entries.push({
      type: 'tag',
      sessionId,
      tag: metadata.tag,
    })
  }
  if (metadata.agentName) {
    entries.push({
      type: 'agent-name',
      sessionId,
      agentName: metadata.agentName,
    })
  }
  if (metadata.agentColor) {
    entries.push({
      type: 'agent-color',
      sessionId,
      agentColor: metadata.agentColor,
    })
  }
  if (metadata.agentSetting) {
    entries.push({
      type: 'agent-setting',
      sessionId,
      agentSetting: metadata.agentSetting,
    })
  }
  if (metadata.mode) {
    entries.push({
      type: 'mode',
      sessionId,
      mode: metadata.mode,
    })
  }
  if (metadata.goal !== undefined) {
    // Goal progress is part of the copied conversation state. Do not reset it
    // here; a branch starts from the same history point as its parent.
    entries.push({
      type: 'goal-state',
      sessionId,
      goal: metadata.goal,
    } satisfies GoalStateEntry)
  }

  return entries
}

/**
 * Derive a single-line title base from the first user message.
 * Collapses whitespace — multiline first messages (pasted stacks, code)
 * otherwise flow into the saved title and break the resume hint.
 */
export function deriveFirstPrompt(
  firstUserMessage: Extract<SerializedMessage, { type: 'user' }> | undefined,
): string {
  const content = firstUserMessage?.message?.content
  if (!content) return 'Branched conversation'
  const raw =
    typeof content === 'string'
      ? content
      : content.find(
          (block): block is { type: 'text'; text: string } =>
            block.type === 'text',
        )?.text
  if (!raw) return 'Branched conversation'
  return (
    raw.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Branched conversation'
  )
}

/**
 * Creates a branch of the current conversation by copying the active
 * transcript chain into a new session file. Preserves original per-message
 * metadata (timestamps, gitBranch, etc.) while updating sessionId and writing
 * session-level branch metadata.
 */
async function createFork(
  customTitle: string | undefined,
  currentMessages: Message[],
): Promise<{
  sessionId: UUID
  title: string
  usedCustomTitle: boolean
  forkPath: string
  serializedMessages: SerializedMessage[]
  contentReplacementRecords: ContentReplacementEntry['replacements']
  sourceSessionId: UUID
  branchMetadata: SessionBranchEntry
  copiedMetadata: CopiedForkMetadata
}> {
  const forkSessionId = randomUUID() as UUID
  const originalSessionId = getSessionId() as UUID
  const currentTranscriptPath = getTranscriptPath()
  const transcriptDir = dirname(currentTranscriptPath)
  const forkSessionPath = join(transcriptDir, `${forkSessionId}.jsonl`)

  // Ensure the current session directory exists. For resumed sessions this may
  // differ from the launch cwd's project directory.
  await mkdir(transcriptDir, { recursive: true, mode: 0o700 })

  await flushSessionStorage()

  // Avoid a preflight full-file read; loadTranscriptFile below has the
  // large-transcript optimized path.
  let transcriptSize: number
  try {
    transcriptSize = (await stat(currentTranscriptPath)).size
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw new Error(NO_BRANCHABLE_MESSAGES)
    }
    throw error
  }

  if (transcriptSize === 0) {
    throw new Error(NO_BRANCHABLE_MESSAGES)
  }

  const {
    messages,
    leafUuids,
    tags,
    agentNames,
    agentColors,
    agentSettings,
    modes,
    goalStates,
    contentReplacements,
    sessionBranches,
  } = await loadTranscriptFile(currentTranscriptPath, { keepAllLeaves: true })
  const leafMessage =
    findCurrentBranchLeaf(messages, currentMessages, originalSessionId) ??
    findLatestBranchLeaf(messages.values(), leafUuids, originalSessionId)

  if (!leafMessage) {
    throw new Error(NO_BRANCHABLE_MESSAGES)
  }

  const mainConversationEntries = buildConversationChain(messages, leafMessage)

  // Content-replacement entries for the original session. These record which
  // tool_result blocks were replaced with previews by the per-message budget.
  // Without them in the fork JSONL, `claude -r {forkId}` reconstructs state
  // with an empty replacements Map → previously-replaced results are classified
  // as FROZEN and sent as full content (prompt cache miss + permanent overage).
  // sessionId must be rewritten since loadTranscriptFile keys lookup by the
  // session's messages' sessionId.
  const contentReplacementRecords = filterContentReplacementsForMessages(
    mainConversationEntries,
    contentReplacements.get(originalSessionId) ?? [],
  )

  if (mainConversationEntries.length === 0) {
    throw new Error(NO_BRANCHABLE_MESSAGES)
  }

  const copiedMetadata: CopiedForkMetadata = {
    tag: tags.get(originalSessionId),
    agentName: agentNames.get(originalSessionId),
    agentColor: agentColors.get(originalSessionId),
    agentSetting: agentSettings.get(originalSessionId),
    mode: normalizeMode(modes.get(originalSessionId)),
    goal: goalStates.has(originalSessionId)
      ? goalStates.get(originalSessionId)
      : undefined,
  }

  // Build forked entries with new sessionId and preserved metadata
  let parentUuid: UUID | null = null
  const lines: string[] = []
  const serializedMessages: SerializedMessage[] = []

  for (const entry of mainConversationEntries) {
    const { forkedFrom: _legacyForkedFrom, ...entryWithoutLegacyFork } =
      entry as LegacyForkedTranscriptMessage

    // Create forked transcript entry preserving all original metadata
    const forkedEntry: TranscriptMessage = {
      ...entryWithoutLegacyFork,
      sessionId: forkSessionId,
      parentUuid,
      isSidechain: false,
    }

    // Build serialized message for LogOption
    const {
      parentUuid: _serializedParentUuid,
      isSidechain: _serializedIsSidechain,
      ...serializedBase
    } = entryWithoutLegacyFork
    const serialized: SerializedMessage = {
      ...serializedBase,
      sessionId: forkSessionId,
    }

    serializedMessages.push(serialized)
    lines.push(jsonStringify(forkedEntry))
    if (entry.type !== 'progress') {
      parentUuid = entry.uuid
    }
  }

  for (const entry of buildCopiedMetadataEntries(
    forkSessionId,
    copiedMetadata,
  )) {
    lines.push(jsonStringify(entry))
  }

  const firstPrompt = deriveFirstPrompt(
    serializedMessages.find(m => m.type === 'user'),
  )
  const effectiveTitle =
    customTitle?.trim() || (await getUniqueForkName(firstPrompt))
  const sourceBranchMetadata = sessionBranches.get(originalSessionId)
  const legacyForkRootSessionId =
    findLegacyForkRootSessionId(mainConversationEntries)
  const branchedAtMessage = mainConversationEntries.findLast(
    entry => entry.type === 'user' || entry.type === 'assistant',
  )
  const branchMetadata: SessionBranchEntry = {
    type: 'session-branch',
    sessionId: forkSessionId,
    parentSessionId: originalSessionId,
    rootSessionId:
      sourceBranchMetadata?.rootSessionId ??
      legacyForkRootSessionId ??
      originalSessionId,
    branchedFromSessionId: originalSessionId,
    branchName: effectiveTitle,
    branchedAt: new Date().toISOString(),
    ...(branchedAtMessage
      ? { branchedAtMessageId: branchedAtMessage.uuid }
      : {}),
  }
  lines.unshift(jsonStringify(branchMetadata))

  // Append content-replacement entry (if any) with the fork's sessionId.
  // Written as a SINGLE entry (same shape as insertContentReplacement) so
  // loadTranscriptFile's content-replacement branch picks it up.
  if (contentReplacementRecords.length > 0) {
    const forkedReplacementEntry: ContentReplacementEntry = {
      type: 'content-replacement',
      sessionId: forkSessionId,
      replacements: contentReplacementRecords,
    }
    lines.push(jsonStringify(forkedReplacementEntry))
  }

  // Write the fork session file
  await writeFile(forkSessionPath, lines.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  })
  // Append the title after the raw copy so saveCustomTitle remains the single
  // path for title provenance analytics and current-session title cache updates.
  await saveCustomTitle(
    forkSessionId,
    effectiveTitle,
    forkSessionPath,
    customTitle?.trim() ? 'user' : 'auto',
  )

  return {
    sessionId: forkSessionId,
    title: effectiveTitle,
    usedCustomTitle: !!customTitle?.trim(),
    forkPath: forkSessionPath,
    serializedMessages,
    contentReplacementRecords,
    sourceSessionId: originalSessionId,
    branchMetadata,
    copiedMetadata,
  }
}

/**
 * Generates a unique fork name by checking for collisions with existing session names.
 * If "baseName (Branch)" already exists, tries "baseName (Branch 2)", etc.
 */
async function getUniqueForkName(baseName: string): Promise<string> {
  const candidateName = `${baseName} (Branch)`

  // Check if this exact name already exists
  const existingWithExactName = await searchSessionsByCustomTitle(
    candidateName,
    { exact: true },
  )

  if (existingWithExactName.length === 0) {
    return candidateName
  }

  // Name collision - find a unique numbered suffix
  // Search for all sessions that start with the base pattern
  const existingForks = await searchSessionsByCustomTitle(`${baseName} (Branch`)

  // Extract existing fork numbers to find the next available
  const usedNumbers = new Set<number>([1]) // Consider " (Branch)" as number 1
  const forkNumberPattern = new RegExp(
    `^${escapeRegExp(baseName)} \\(Branch(?: (\\d+))?\\)$`,
  )

  for (const session of existingForks) {
    const match = session.customTitle?.match(forkNumberPattern)
    if (match) {
      if (match[1]) {
        usedNumbers.add(parseInt(match[1], 10))
      } else {
        usedNumbers.add(1) // " (Branch)" without number is treated as 1
      }
    }
  }

  // Find the next available number
  let nextNumber = 2
  while (usedNumbers.has(nextNumber)) {
    nextNumber++
  }

  return `${baseName} (Branch ${nextNumber})`
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const customTitle = args?.trim() || undefined

  try {
    const fork = await createFork(customTitle, context.messages ?? [])
    const {
      sessionId,
      title,
      usedCustomTitle,
      forkPath,
      serializedMessages,
      contentReplacementRecords,
      sourceSessionId,
      branchMetadata,
      copiedMetadata,
    } = fork

    // Build LogOption for resume
    const now = new Date()
    const firstPrompt = deriveFirstPrompt(
      serializedMessages.find(m => m.type === 'user'),
    )

    const forkLog: LogOption = {
      date: now.toISOString().split('T')[0]!,
      messages: serializedMessages,
      fullPath: forkPath,
      value: now.getTime(),
      created: now,
      modified: now,
      firstPrompt,
      messageCount: serializedMessages.length,
      isSidechain: false,
      sessionId,
      customTitle: title,
      contentReplacements: contentReplacementRecords,
      sessionBranch: branchMetadata,
      ...copiedMetadata,
    }

    const branchConfirmation = `Branched conversation "${title}" from ${sourceSessionId} to ${sessionId}.`
    const filesystemCaveat =
      'Files remain in the same working tree; this is conversation branching, not filesystem isolation.'
    const originalResumeHint = `To resume the original: claude -r ${sourceSessionId}`

    if (context.resume) {
      try {
        await context.resume(sessionId, forkLog, 'fork')
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error occurred'
        logEvent('tengu_conversation_fork_switch_failed', {
          message_count: serializedMessages.length,
          has_custom_title: usedCustomTitle,
        })
        onDone(
          [
            branchConfirmation,
            `Created the branch file, but failed to switch sessions: ${message}`,
            filesystemCaveat,
            `Resume this branch with: /resume ${sessionId}`,
            originalResumeHint,
          ].join('\n'),
          { display: 'system' },
        )
        return null
      }

      logEvent('tengu_conversation_forked', {
        message_count: serializedMessages.length,
        has_custom_title: usedCustomTitle,
      })
      onDone(
        [
          branchConfirmation,
          'You are now in the branch.',
          filesystemCaveat,
          originalResumeHint,
        ].join('\n'),
        { display: 'system' },
      )
    } else {
      // Fallback if resume not available
      logEvent('tengu_conversation_forked', {
        message_count: serializedMessages.length,
        has_custom_title: usedCustomTitle,
      })
      onDone(
        [
          branchConfirmation,
          'Automatic session switching is unavailable in this context.',
          filesystemCaveat,
          `Resume this branch with: /resume ${sessionId}`,
          originalResumeHint,
        ].join('\n'),
      )
    }

    return null
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred'
    onDone(
      message === NO_BRANCHABLE_MESSAGES
        ? message
        : `Failed to branch conversation: ${message}`,
    )
    return null
  }
}
