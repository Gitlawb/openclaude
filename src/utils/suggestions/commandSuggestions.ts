import Fuse from 'fuse.js'
import {
  type Command,
  formatDescriptionWithSource,
  getCommandName,
} from '../../commands.js'
import type { SuggestionItem } from '../../components/PromptInput/PromptInputFooterSuggestions.js'
import { logForDebugging } from '../debug.js'
import { getSkillUsageScore } from './skillUsageTracking.js'

// Commands expose dynamic getters (description/isHidden/etc.) that read live
// state and can throw. These getters run for every command while building the
// search index, so a single bad command must never break suggestions for the
// rest. Track which ones we've already warned about so the dev log fires once.
const warnedBrokenCommands = new Set<string>()

function warnBrokenCommand(label: string, err: unknown): void {
  if (warnedBrokenCommands.has(label)) {
    return
  }
  warnedBrokenCommands.add(label)
  logForDebugging(
    `command suggestion: skipped metadata for "${label}" — getter threw: ${
      err instanceof Error ? err.message : String(err)
    }`,
    { level: 'warn' },
  )
}

/**
 * Read a command's `isHidden` getter without letting a throw propagate.
 * Defaults to not-hidden so a command with a broken getter stays usable.
 */
function safeIsHidden(command: Command): boolean {
  try {
    return Boolean(command.isHidden)
  } catch (err) {
    warnBrokenCommand(safeCommandName(command) ?? 'unknown', err)
    return false
  }
}

/**
 * Read a command's name without letting a throw propagate. Returns null when
 * even the name can't be resolved — such a command is unusable and dropped.
 */
function safeCommandName(command: Command): string | null {
  try {
    return getCommandName(command)
  } catch {
    return null
  }
}

function safeCommandAliases(
  command: Command,
  commandName: string,
): string[] | undefined {
  try {
    return command.aliases
  } catch (err) {
    warnBrokenCommand(commandName, err)
    return undefined
  }
}

// Treat these characters as word separators for command search
const SEPARATORS = /[:_-]/g

type CommandSearchItem = {
  descriptionKey: string[]
  partKey: string[] | undefined
  commandName: string
  command: Command
  aliasKey: string[] | undefined
}

type CommandSearchSnapshot = {
  aliases: string[] | undefined
  command: Command
  commandName: string
  isHidden: boolean
  renderedDescription: string
}

// Cache the Fuse index keyed by the commands array identity plus a signature
// of the searchable UI text. The commands array is stable (memoized in
// REPL.tsx), while language changes can alter rendered descriptions in place.
let fuseCache: {
  commands: Command[]
  signature: string
  fuse: Fuse<CommandSearchItem>
} | null = null

function getCommandFuseForSnapshots(
  commands: Command[],
  snapshots: CommandSearchSnapshot[],
): Fuse<CommandSearchItem> {
  const signature = getCommandSearchSignature(snapshots)

  if (
    fuseCache?.commands === commands &&
    fuseCache.signature === signature
  ) {
    return fuseCache.fuse
  }

  const commandData: CommandSearchItem[] = snapshots
    .filter(snapshot => !snapshot.isHidden)
    .map(snapshot => {
      const { aliases, command, commandName, renderedDescription } = snapshot
      const parts = commandName.split(SEPARATORS).filter(Boolean)

      return {
        descriptionKey: renderedDescription
          .split(/\s+/)
          .map(word => cleanWord(word))
          .filter(Boolean),
        partKey: parts.length > 1 ? parts : undefined,
        commandName,
        command,
        aliasKey: aliases,
      }
    })

  const fuse = new Fuse(commandData, {
    includeScore: true,
    threshold: 0.3, // relatively strict matching
    location: 0, // prefer matches at the beginning of strings
    distance: 100, // increased to allow matching in descriptions
    keys: [
      {
        name: 'commandName',
        weight: 3, // Highest priority for command names
      },
      {
        name: 'partKey',
        weight: 2, // Next highest priority for command parts
      },
      {
        name: 'aliasKey',
        weight: 2, // Same high priority for aliases
      },
      {
        name: 'descriptionKey',
        weight: 0.5, // Lower priority for descriptions
      },
    ],
  })

  fuseCache = { commands, signature, fuse }
  return fuse
}

function getCommandSearchSnapshots(
  commands: Command[],
): CommandSearchSnapshot[] {
  const snapshots: CommandSearchSnapshot[] = []
  for (const command of commands) {
    const commandName = safeCommandName(command)
    // A command we can't even name is unusable — drop it rather than risk a
    // throw poisoning the whole index.
    if (commandName === null) {
      continue
    }
    const aliases = safeCommandAliases(command, commandName)
    snapshots.push({
      aliases,
      command,
      commandName,
      isHidden: safeIsHidden(command),
      // getRenderedCommandDescription already falls back to '' on a throw.
      renderedDescription: getRenderedCommandDescription(command),
    })
  }
  return snapshots
}

function getCommandSearchSignature(
  snapshots: CommandSearchSnapshot[],
): string {
  return JSON.stringify(
    snapshots.map(snapshot => [
      snapshot.commandName,
      snapshot.aliases ?? [],
      snapshot.isHidden,
      snapshot.renderedDescription,
    ]),
  )
}

/**
 * Type guard to check if a suggestion's metadata is a Command.
 * Commands have a name string and a type property.
 */
function isCommandMetadata(metadata: unknown): metadata is Command {
  const maybeCommand = metadata as { type?: unknown }
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (maybeCommand.type === 'prompt' ||
      maybeCommand.type === 'local' ||
      maybeCommand.type === 'local-jsx')
  )
}

/**
 * Represents a slash command found mid-input (not at the start)
 */
export type MidInputSlashCommand = {
  token: string // e.g., "/com"
  startPos: number // Position of "/"
  partialCommand: string // e.g., "com"
}

/**
 * Finds a slash command token that appears mid-input (not at position 0).
 * A mid-input slash command is a "/" preceded by whitespace, where the cursor
 * is at or after the "/".
 *
 * @param input The full input string
 * @param cursorOffset The current cursor position
 * @returns The mid-input slash command info, or null if not found
 */
export function findMidInputSlashCommand(
  input: string,
  cursorOffset: number,
): MidInputSlashCommand | null {
  // If input starts with "/", this is start-of-input case (handled elsewhere)
  if (input.startsWith('/')) {
    return null
  }

  // Look backwards from cursor to find a "/" preceded by whitespace
  const beforeCursor = input.slice(0, cursorOffset)

  // Find the last "/" in the text before cursor
  // Pattern: whitespace followed by "/" then optional alphanumeric/dash characters.
  // Lookbehind (?<=\s) is avoided — it defeats YARR JIT in JSC, and the
  // interpreter scans O(n) even with the $ anchor. Capture the whitespace
  // instead and offset match.index by 1.
  const match = beforeCursor.match(/\s\/([a-zA-Z0-9_:-]*)$/)
  if (!match || match.index === undefined) {
    return null
  }

  // Get the full token (may extend past cursor)
  const slashPos = match.index + 1
  const textAfterSlash = input.slice(slashPos + 1)

  // Extract the command portion (until whitespace or end)
  const commandMatch = textAfterSlash.match(/^[a-zA-Z0-9_:-]*/)
  const fullCommand = commandMatch ? commandMatch[0] : ''

  // If cursor is past the command (after a space), don't show ghost text
  if (cursorOffset > slashPos + 1 + fullCommand.length) {
    return null
  }

  return {
    token: '/' + fullCommand,
    startPos: slashPos,
    partialCommand: fullCommand,
  }
}

/**
 * Finds the best matching command for a partial command string.
 * Delegates to generateCommandSuggestions and filters to prefix matches.
 *
 * @param partialCommand The partial command typed by the user (without "/")
 * @param commands Available commands
 * @returns The completion suffix (e.g., "mit" for partial "com" matching "commit"), or null
 */
export function getBestCommandMatch(
  partialCommand: string,
  commands: Command[],
): { suffix: string; fullCommand: string } | null {
  if (!partialCommand) {
    return null
  }

  // Use existing suggestion logic
  const suggestions = generateCommandSuggestions('/' + partialCommand, commands)
  if (suggestions.length === 0) {
    return null
  }

  // Find first suggestion that is a prefix match (for inline completion)
  const query = partialCommand.toLowerCase()
  for (const suggestion of suggestions) {
    if (!isCommandMetadata(suggestion.metadata)) {
      continue
    }
    const name = safeCommandName(suggestion.metadata)
    if (name === null) {
      continue
    }
    if (name.toLowerCase().startsWith(query)) {
      const suffix = name.slice(partialCommand.length)
      // Only return if there's something to complete
      if (suffix) {
        return { suffix, fullCommand: name }
      }
    }
  }

  return null
}

/**
 * Checks if input is a command (starts with slash)
 */
export function isCommandInput(input: string): boolean {
  return input.startsWith('/')
}

export function getCommandSuggestionForEnter(
  input: string,
  suggestion: SuggestionItem | undefined,
  commands: Command[],
): string | SuggestionItem | undefined {
  const exactCommandName = !input.includes(' ') && isCommandInput(input)
    ? input.slice(1).toLowerCase().trim()
    : ''
  const exactCommands = exactCommandName
    ? commands.filter(
        cmd => safeCommandName(cmd)?.toLowerCase() === exactCommandName,
      )
    : []

  return exactCommands.length === 1
    ? safeCommandName(exactCommands[0]!) ?? suggestion
    : suggestion
}

/**
 * Checks if a command input has arguments
 * A command with just a trailing space is considered to have no arguments
 */
export function hasCommandArgs(input: string): boolean {
  if (!isCommandInput(input)) return false

  if (!input.includes(' ')) return false

  if (input.endsWith(' ')) return false

  return true
}

export function findCommandByExactName(
  commands: Command[],
  commandName: string,
): Command | undefined {
  return commands.find(command => safeCommandName(command) === commandName)
}

function findCommandByNameOrAlias(
  commands: Command[],
  commandName: string,
): Command | undefined {
  for (const command of commands) {
    const safeName = safeCommandName(command)
    if (safeName === null) {
      continue
    }
    if (safeName === commandName) {
      return command
    }
    if (safeCommandAliases(command, safeName)?.includes(commandName)) {
      return command
    }
  }
  return undefined
}

function commandNameFromSuggestionDisplay(displayText: string): string | null {
  return displayText.match(/^\/([^\s(]+)/)?.[1] ?? null
}

export function getCommandSuggestionsMaxWidth(
  commands: Command[],
): number | undefined {
  const visibleNames: string[] = []

  for (const command of commands) {
    const commandName = safeCommandName(command)
    if (commandName === null || safeIsHidden(command)) {
      continue
    }
    visibleNames.push(commandName)
  }

  if (visibleNames.length === 0) {
    return undefined
  }

  return Math.max(...visibleNames.map(name => name.length)) + 6
}

/**
 * Formats a command with proper notation
 */
export function formatCommand(command: string): string {
  return `/${command} `
}

/**
 * Generates a deterministic unique ID for a command suggestion.
 * Commands with the same name from different sources get unique IDs.
 *
 * Only prompt commands can have duplicates (from user settings, project
 * settings, plugins, etc). Built-in commands (local, local-jsx) are
 * defined once in code and can't have duplicates.
 */
function getCommandId(cmd: Command, commandName = getCommandName(cmd)): string {
  if (cmd.type === 'prompt') {
    // For plugin commands, include the repository to disambiguate
    if (cmd.source === 'plugin' && cmd.pluginInfo?.repository) {
      return `${commandName}:${cmd.source}:${cmd.pluginInfo.repository}`
    }
    return `${commandName}:${cmd.source}`
  }
  // Built-in commands include type as fallback for future-proofing
  return `${commandName}:${cmd.type}`
}

/**
 * Checks if a query matches any of the command's aliases.
 * Returns the matched alias if found, otherwise undefined.
 */
function findMatchedAlias(
  query: string,
  aliases?: string[],
): string | undefined {
  if (!aliases || aliases.length === 0 || query === '') {
    return undefined
  }
  // Show the alias when the typed slash query visibly matches it.
  return aliases.find(alias => alias.toLowerCase().includes(query))
}

/**
 * Creates a suggestion item from a command.
 * Only shows the matched alias in parentheses if the user typed an alias.
 */
function createCommandSuggestionItem(
  cmd: Command,
  matchedAlias?: string,
  commandName = getCommandName(cmd),
  renderedDescription = getRenderedCommandDescription(cmd),
): SuggestionItem {
  // Only show the alias if the user typed it
  const aliasText = matchedAlias ? ` (${matchedAlias})` : ''

  const isWorkflow = cmd.type === 'prompt' && cmd.kind === 'workflow'

  return {
    id: getCommandId(cmd, commandName),
    displayText: `/${commandName}${aliasText}`,
    tag: isWorkflow ? 'workflow' : undefined,
    description: renderedDescription,
    metadata: cmd,
  }
}

function createCommandSuggestionItemFromSnapshot(
  snapshot: CommandSearchSnapshot,
  matchedAlias?: string,
): SuggestionItem {
  return createCommandSuggestionItem(
    snapshot.command,
    matchedAlias,
    snapshot.commandName,
    snapshot.renderedDescription,
  )
}

function getRenderedCommandDescription(cmd: Command): string {
  // Command descriptions can be dynamic getters that read live state and may
  // throw (e.g. a backend returning null). This runs for every command while
  // building the Fuse index, so a single throwing getter must not break the
  // entire suggestion list — fall back to an empty description instead.
  try {
    const isWorkflow = cmd.type === 'prompt' && cmd.kind === 'workflow'
    const description = isWorkflow
      ? cmd.description
      : formatDescriptionWithSource(cmd)
    return (
      description +
      (cmd.type === 'prompt' && cmd.argNames?.length
        ? ` (arguments: ${cmd.argNames.join(', ')})`
        : '')
    )
  } catch (err) {
    warnBrokenCommand(safeCommandName(cmd) ?? 'unknown', err)
    return ''
  }
}

/**
 * Ensure suggestion IDs are unique for React keys and selection logic.
 * If duplicates exist, append a stable numeric suffix to subsequent entries.
 */
function ensureUniqueSuggestionIds(items: SuggestionItem[]): SuggestionItem[] {
  const counts = new Map<string, number>()
  return items.map(item => {
    const seen = counts.get(item.id) ?? 0
    counts.set(item.id, seen + 1)
    if (seen === 0) {
      return item
    }
    return {
      ...item,
      id: `${item.id}#${seen + 1}`,
    }
  })
}

/**
 * Generate command suggestions based on input
 */
export function generateCommandSuggestions(
  input: string,
  commands: Command[],
): SuggestionItem[] {
  // Only process command input
  if (!isCommandInput(input)) {
    return []
  }

  // If there are arguments, don't show suggestions
  if (hasCommandArgs(input)) {
    return []
  }

  const query = input.slice(1).toLowerCase().trim()
  const snapshots = getCommandSearchSnapshots(commands)

  // When just typing '/' without additional text
  if (query === '') {
    const visibleCommands = snapshots.filter(snapshot => !snapshot.isHidden)

    // Find recently used skills (only prompt commands have usage tracking)
    const recentlyUsed: CommandSearchSnapshot[] = []
    const commandsWithScores = visibleCommands
      .filter(snapshot => snapshot.command.type === 'prompt')
      .map(snapshot => ({
        snapshot,
        score: getSkillUsageScore(snapshot.commandName),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)

    // Take top 5 recently used skills
    for (const item of commandsWithScores.slice(0, 5)) {
      recentlyUsed.push(item.snapshot)
    }

    // Create a set of recently used command IDs to avoid duplicates
    const recentlyUsedIds = new Set(
      recentlyUsed.map(snapshot =>
        getCommandId(snapshot.command, snapshot.commandName),
      ),
    )

    // Categorize remaining commands (excluding recently used)
    const builtinCommands: CommandSearchSnapshot[] = []
    const userCommands: CommandSearchSnapshot[] = []
    const projectCommands: CommandSearchSnapshot[] = []
    const policyCommands: CommandSearchSnapshot[] = []
    const otherCommands: CommandSearchSnapshot[] = []

    visibleCommands.forEach(snapshot => {
      // Skip if already in recently used
      if (
        recentlyUsedIds.has(
          getCommandId(snapshot.command, snapshot.commandName),
        )
      ) {
        return
      }

      const cmd = snapshot.command
      if (cmd.type === 'local' || cmd.type === 'local-jsx') {
        builtinCommands.push(snapshot)
      } else if (
        cmd.type === 'prompt' &&
        (cmd.source === 'userSettings' || cmd.source === 'localSettings')
      ) {
        userCommands.push(snapshot)
      } else if (cmd.type === 'prompt' && cmd.source === 'projectSettings') {
        projectCommands.push(snapshot)
      } else if (cmd.type === 'prompt' && cmd.source === 'policySettings') {
        policyCommands.push(snapshot)
      } else {
        otherCommands.push(snapshot)
      }
    })

    // Sort each category alphabetically
    const sortAlphabetically = (
      a: CommandSearchSnapshot,
      b: CommandSearchSnapshot,
    ) => a.commandName.localeCompare(b.commandName)

    builtinCommands.sort(sortAlphabetically)
    userCommands.sort(sortAlphabetically)
    projectCommands.sort(sortAlphabetically)
    policyCommands.sort(sortAlphabetically)
    otherCommands.sort(sortAlphabetically)

    // Combine with built-in commands prioritized after recently used,
    // so they remain visible even when many skills are installed
    return ensureUniqueSuggestionIds([
      ...recentlyUsed,
      ...builtinCommands,
      ...userCommands,
      ...projectCommands,
      ...policyCommands,
      ...otherCommands,
    ].map(snapshot => createCommandSuggestionItemFromSnapshot(snapshot)))
  }

  // The Fuse index filters hidden commands, so an exact hidden command name
  // will not appear in Fuse results. If no visible command shares the name,
  // prepend the hidden exact match so explicit invocation still works.
  // Prepend rather than early-return so visible prefix siblings (e.g.
  // /voice-memo) still appear below, and getBestCommandMatch can still find
  // a non-empty suffix.
  let hiddenExact = snapshots.find(
    snapshot =>
      snapshot.isHidden && snapshot.commandName.toLowerCase() === query,
  )
  if (
    hiddenExact &&
    snapshots.some(
      snapshot =>
        !snapshot.isHidden && snapshot.commandName.toLowerCase() === query,
    )
  ) {
    hiddenExact = undefined
  }

  const fuse = getCommandFuseForSnapshots(commands, snapshots)
  const searchResults = fuse.search(query)
  const fuseResultByCommand = new Map<Command, (typeof searchResults)[number]>()
  for (const result of searchResults) {
    fuseResultByCommand.set(result.item.command, result)
  }

  // Rank identifier matches before using Fuse score and usage as tiebreakers.
  // Priority order:
  // 1. Exact name match (highest)
  // 2. Exact alias match
  // 3. Prefix name match
  // 4. Prefix alias match
  // 5. Prefix command part
  // 6. Substring name/alias/part matches
  // Precompute normalized identifier fields once; sorting can then compare
  // strings without rereading command metadata.
  const withMeta = snapshots
    .filter(snapshot => !snapshot.isHidden)
    .map(snapshot => {
      const { aliases: snapshotAliases, command, commandName } = snapshot
      const commandParts = commandName.split(SEPARATORS).filter(Boolean)
      const name = commandName.toLowerCase()
      const aliases = snapshotAliases?.map(alias => alias.toLowerCase()) ?? []
      const parts =
        commandParts.length > 1
          ? commandParts.map(part => part.toLowerCase())
          : []
      return {
        r: fuseResultByCommand.get(command),
        snapshot,
        command,
        commandName,
        name,
        aliases,
        parts,
      }
    })

  // Slash typeahead should only show rows where the typed characters are
  // visible in a command identifier: the command name or an alias. Separator-
  // delimited command-name parts still affect ranking for word-boundary hits.
  // Fuse contributes ranking, but description-only and typo-fuzzy matches are
  // not eligible for display.
  const includesQuery = (value: string) => value.includes(query)
  const startsWithQuery = (value: string) => value.startsWith(query)
  const matchesIdentifier = (item: (typeof withMeta)[number]) =>
    includesQuery(item.name) || item.aliases.some(includesQuery)

  const getMatchRank = (item: (typeof withMeta)[number]): number => {
    if (item.name === query) return 0
    if (item.aliases.some(alias => alias === query)) return 1
    if (startsWithQuery(item.name)) return 2
    if (item.aliases.some(startsWithQuery)) return 3
    if (item.parts.some(startsWithQuery)) return 4
    if (includesQuery(item.name)) return 5
    if (item.aliases.some(includesQuery)) return 6
    return 7
  }

  const filteredMeta = withMeta.filter(matchesIdentifier).map(item => ({
    ...item,
    usage:
      item.command.type === 'prompt'
        ? getSkillUsageScore(item.commandName)
        : 0,
  }))

  const sortedResults = filteredMeta.sort((a, b) => {
    const aName = a.name
    const bName = b.name
    const aAliases = a.aliases
    const bAliases = b.aliases

    const rankDiff = getMatchRank(a) - getMatchRank(b)
    if (rankDiff !== 0) return rankDiff

    // Check for prefix name match
    const aPrefixName = aName.startsWith(query)
    const bPrefixName = bName.startsWith(query)
    if (aPrefixName && !bPrefixName) return -1
    if (bPrefixName && !aPrefixName) return 1
    // Among prefix name matches, prefer the shorter name (closer to exact)
    if (aPrefixName && bPrefixName && aName.length !== bName.length) {
      return aName.length - bName.length
    }

    // Check for prefix alias match
    const aPrefixAlias = aAliases.find(alias => alias.startsWith(query))
    const bPrefixAlias = bAliases.find(alias => alias.startsWith(query))
    if (aPrefixAlias && !bPrefixAlias) return -1
    if (bPrefixAlias && !aPrefixAlias) return 1
    // Among prefix alias matches, prefer the shorter alias
    if (
      aPrefixAlias &&
      bPrefixAlias &&
      aPrefixAlias.length !== bPrefixAlias.length
    ) {
      return aPrefixAlias.length - bPrefixAlias.length
    }

    // For similar match types, use Fuse score with usage as tiebreaker
    const scoreDiff = (a.r?.score ?? 1) - (b.r?.score ?? 1)
    if (Math.abs(scoreDiff) > 0.1) {
      return scoreDiff
    }
    // For similar Fuse scores, prefer more frequently used skills
    return b.usage - a.usage
  })

  // Map search results to suggestion items
  // Note: We intentionally don't deduplicate here because commands with the same name
  // from different sources (e.g., projectSettings vs userSettings) may have different
  // implementations and should both be available to the user
  const fuseSuggestions = sortedResults.map(result => {
    // Only show alias in parentheses if the user typed an alias
    const matchedAlias = findMatchedAlias(query, result.snapshot.aliases)
    return createCommandSuggestionItemFromSnapshot(result.snapshot, matchedAlias)
  })
  // Skip the prepend defensively if the command is already present; duplicate
  // ids confuse React keys and selection state.
  if (hiddenExact) {
    const hiddenId = getCommandId(hiddenExact.command, hiddenExact.commandName)
    if (!fuseSuggestions.some(s => s.id === hiddenId)) {
      return ensureUniqueSuggestionIds([
        createCommandSuggestionItemFromSnapshot(hiddenExact),
        ...fuseSuggestions,
      ])
    }
  }
  return ensureUniqueSuggestionIds(fuseSuggestions)
}

/**
 * Apply selected command to input
 */
export function applyCommandSuggestion(
  suggestion: string | SuggestionItem,
  shouldExecute: boolean,
  commands: Command[],
  onInputChange: (value: string) => void,
  setCursorOffset: (offset: number) => void,
  onSubmit: (
    value: string,
    isSubmittingSlashCommand?: boolean,
    slashCommandOverride?: Command,
  ) => void,
): void {
  // Extract command name and object from string or SuggestionItem metadata
  let commandName: string
  let commandObj: Command | undefined
  if (typeof suggestion === 'string') {
    commandName = suggestion
    commandObj = shouldExecute
      ? findCommandByNameOrAlias(commands, commandName)
      : undefined
  } else {
    if (!isCommandMetadata(suggestion.metadata)) {
      return // Invalid suggestion, nothing to apply
    }
    commandName =
      safeCommandName(suggestion.metadata) ??
      commandNameFromSuggestionDisplay(suggestion.displayText) ??
      ''
    if (commandName === '') {
      return
    }
    commandObj = suggestion.metadata
  }

  // Format the command input with trailing space
  const newInput = formatCommand(commandName)
  onInputChange(newInput)
  setCursorOffset(newInput.length)

  // Execute command if requested and it takes no arguments
  if (shouldExecute && commandObj) {
    if (
      commandObj.type !== 'prompt' ||
      (commandObj.argNames ?? []).length === 0
    ) {
      onSubmit(newInput, /* isSubmittingSlashCommand */ true, commandObj)
    }
  }
}

// Helper function at bottom of file per CLAUDE.md
function cleanWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Find all /command patterns in text for highlighting.
 * Returns array of {start, end} positions.
 * Requires whitespace or start-of-string before the slash to avoid
 * matching paths like /usr/bin.
 */
export function findSlashCommandPositions(
  text: string,
): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = []
  // Match /command patterns preceded by whitespace or start-of-string
  const regex = /(^|[\s])(\/[a-zA-Z][a-zA-Z0-9:\-_]*)/g
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(text)) !== null) {
    const precedingChar = match[1] ?? ''
    const commandName = match[2] ?? ''
    // Start position is after the whitespace (if any)
    const start = match.index + precedingChar.length
    positions.push({ start, end: start + commandName.length })
  }
  return positions
}
