import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useDebounceCallback } from 'usehooks-ts';
import { type Command, getCommandName } from '../commands.js';
import { getModeFromInput, getValueFromInput } from '../components/PromptInput/inputModes.js';
import type { SuggestionItem, SuggestionType } from '../components/PromptInput/PromptInputFooterSuggestions.js';
import { useIsModalOverlayActive, useRegisterOverlay } from '../context/overlayContext.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until consumers wire handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js';
import { useOptionalKeybindingContext, useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useAppStateStore } from '../state/AppState.js';
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js';
import type { InlineGhostText, PromptInputMode } from '../types/textInputTypes.js';
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { generateProgressiveArgumentHint, parseArguments } from '../utils/argumentSubstitution.js';
import { getShellCompletions, type ShellCompletionType } from '../utils/bash/shellCompletion.js';
import { formatLogMetadata } from '../utils/format.js';
import { getSessionIdFromLog, searchSessionsByCustomTitle } from '../utils/sessionStorage.js';
import { applyCommandSuggestion, findMidInputSlashCommand, generateCommandSuggestions, getBestCommandMatch, isCommandInput } from '../utils/suggestions/commandSuggestions.js';
import { getDirectoryCompletions, getPathCompletions, isPathLikeToken } from '../utils/suggestions/directoryCompletion.js';
import { getShellHistoryCompletion } from '../utils/suggestions/shellHistoryCompletion.js';
import { getSlackChannelSuggestions, hasSlackMcpServer } from '../utils/suggestions/slackChannelSuggestions.js';
import { TEAM_LEAD_NAME } from '../utils/swarm/constants.js';
import { applyFileSuggestion, findLongestCommonPrefix, onIndexBuildComplete, startBackgroundCacheRefresh } from './fileSuggestions.js';
import { generateUnifiedSuggestions } from './unifiedSuggestions.js';

// Unicode-aware character class for file path tokens:
// \p{L} = letters (CJK, Latin, Cyrillic, etc.)
// \p{N} = numbers (incl. fullwidth)
// \p{M} = combining marks (macOS NFD accents, Devanagari vowel signs)
const AT_TOKEN_HEAD_RE = /^@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
const PATH_CHAR_HEAD_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u;
const TOKEN_WITH_AT_RE = /(@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+)$/u;
const TOKEN_WITHOUT_AT_RE = /[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+$/u;
const HAS_AT_SYMBOL_RE = /(^|\s)@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u;
const HASH_CHANNEL_RE = /(^|\s)#([a-z0-9][a-z0-9_-]*)$/;

// Type guard for path completion metadata
function isPathMetadata(metadata: unknown): metadata is {
  type: 'directory' | 'file';
} {
  return typeof metadata === 'object' && metadata !== null && 'type' in metadata && (metadata.type === 'directory' || metadata.type === 'file');
}

// Helper to determine selectedSuggestion when updating suggestions
function getPreservedSelection(prevSuggestions: SuggestionItem[], prevSelection: number, newSuggestions: SuggestionItem[]): number {
  // No new suggestions
  if (newSuggestions.length === 0) {
    return -1;
  }

  // No previous selection
  if (prevSelection < 0) {
    return 0;
  }

  // Get the previously selected item
  const prevSelectedItem = prevSuggestions[prevSelection];
  if (!prevSelectedItem) {
    return 0;
  }

  // Try to find the same item in the new list by ID
  const newIndex = newSuggestions.findIndex(item => item.id === prevSelectedItem.id);

  // Return the new index if found, otherwise default to 0
  return newIndex >= 0 ? newIndex : 0;
}
function buildResumeInputFromSuggestion(suggestion: SuggestionItem): string {
  const metadata = suggestion.metadata as {
    sessionId: string;
  } | undefined;
  return metadata?.sessionId ? `/resume ${metadata.sessionId}` : `/resume ${suggestion.displayText}`;
}
type Props = {
  onInputChange: (value: string) => void;
  onSubmit: (value: string, isSubmittingSlashCommand?: boolean) => void;
  setCursorOffset: (offset: number) => void;
  input: string;
  cursorOffset: number;
  commands: Command[];
  mode: string;
  agents: AgentDefinition[];
  setSuggestionsState: (f: (previousSuggestionsState: {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }) => {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }) => void;
  suggestionsState: {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  };
  suppressSuggestions?: boolean;
  markAccepted: () => void;
  onModeChange?: (mode: PromptInputMode) => void;
};
type UseTypeaheadResult = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  suggestionType: SuggestionType;
  maxColumnWidth?: number;
  commandArgumentHint?: string;
  inlineGhostText?: InlineGhostText;
  handleKeyDown: (e: KeyboardEvent) => void;
};

/**
 * Extract search token from a completion token by removing @ prefix and quotes
 * @param completionToken The completion token
 * @returns The search token with @ and quotes removed
 */
export function extractSearchToken(completionToken: {
  token: string;
  isQuoted?: boolean;
}): string {
  if (completionToken.isQuoted) {
    // Remove @" prefix and optional closing "
    return completionToken.token.slice(2).replace(/"$/, '');
  } else if (completionToken.token.startsWith('@')) {
    return completionToken.token.substring(1);
  } else {
    return completionToken.token;
  }
}

/**
 * Format a replacement value with proper @ prefix and quotes based on context
 * @param options Configuration for formatting
 * @param options.displayText The text to display
 * @param options.mode The current mode (bash or prompt)
 * @param options.hasAtPrefix Whether the original token has @ prefix
 * @param options.needsQuotes Whether the text needs quotes (contains spaces)
 * @param options.isQuoted Whether the original token was already quoted (user typed @"...)
 * @param options.isComplete Whether this is a complete suggestion (adds trailing space)
 * @returns The formatted replacement value
 */
export function formatReplacementValue(options: {
  displayText: string;
  mode: string;
  hasAtPrefix: boolean;
  needsQuotes: boolean;
  isQuoted?: boolean;
  isComplete: boolean;
}): string {
  const {
    displayText,
    mode,
    hasAtPrefix,
    needsQuotes,
    isQuoted,
    isComplete
  } = options;
  const space = isComplete ? ' ' : '';
  if (isQuoted || needsQuotes) {
    // Use quoted format
    return mode === 'bash' ? `"${displayText}"${space}` : `@"${displayText}"${space}`;
  } else if (hasAtPrefix) {
    return mode === 'bash' ? `${displayText}${space}` : `@${displayText}${space}`;
  } else {
    return displayText;
  }
}

/**
 * Apply a shell completion suggestion by replacing the current word
 */
export function applyShellSuggestion(suggestion: SuggestionItem, input: string, cursorOffset: number, onInputChange: (value: string) => void, setCursorOffset: (offset: number) => void, completionType: ShellCompletionType | undefined): void {
  const beforeCursor = input.slice(0, cursorOffset);
  const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
  const wordStart = lastSpaceIndex + 1;

  // Prepare the replacement text based on completion type
  let replacementText: string;
  if (completionType === 'variable') {
    replacementText = '$' + suggestion.displayText + ' ';
  } else if (completionType === 'command') {
    replacementText = suggestion.displayText + ' ';
  } else {
    replacementText = suggestion.displayText;
  }
  const newInput = input.slice(0, wordStart) + replacementText + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(wordStart + replacementText.length);
}
const DM_MEMBER_RE = /(^|\s)@[\w-]*$/;
function applyTriggerSuggestion(suggestion: SuggestionItem, input: string, cursorOffset: number, triggerRe: RegExp, onInputChange: (value: string) => void, setCursorOffset: (offset: number) => void): void {
  const m = input.slice(0, cursorOffset).match(triggerRe);
  if (!m || m.index === undefined) return;
  const prefixStart = m.index + (m[1]?.length ?? 0);
  const before = input.slice(0, prefixStart);
  const newInput = before + suggestion.displayText + ' ' + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(before.length + suggestion.displayText.length + 1);
}
let currentShellCompletionAbortController: AbortController | null = null;

/**
 * Generate bash shell completion suggestions
 */
async function generateBashSuggestions(input: string, cursorOffset: number): Promise<SuggestionItem[]> {
  try {
    if (currentShellCompletionAbortController) {
      currentShellCompletionAbortController.abort();
    }
    currentShellCompletionAbortController = new AbortController();
    const suggestions = await getShellCompletions(input, cursorOffset, currentShellCompletionAbortController.signal);
    return suggestions;
  } catch {
    // Silent failure - don't break UX
    logEvent('tengu_shell_completion_failed', {});
    return [];
  }
}

/**
 * Apply a directory/path completion suggestion to the input
 * Always adds @ prefix since we're replacing the entire token (including any existing @)
 *
 * @param input The current input text
 * @param suggestionId The ID of the suggestion to apply
 * @param tokenStartPos The start position of the token being replaced
 * @param tokenLength The length of the token being replaced
 * @param isDirectory Whether the suggestion is a directory (adds / suffix) or file (adds space)
 * @returns Object with the new input text and cursor position
 */
export function applyDirectorySuggestion(input: string, suggestionId: string, tokenStartPos: number, tokenLength: number, isDirectory: boolean): {
  newInput: string;
  cursorPos: number;
} {
  const suffix = isDirectory ? '/' : ' ';
  const before = input.slice(0, tokenStartPos);
  const after = input.slice(tokenStartPos + tokenLength);
  // Always add @ prefix - if token already has it, we're replacing
  // the whole token (including @) with @suggestion.id
  const replacement = '@' + suggestionId + suffix;
  const newInput = before + replacement + after;
  return {
    newInput,
    cursorPos: before.length + replacement.length
  };
}

/**
 * Extract a completable token at the cursor position
 * @param text The input text
 * @param cursorPos The cursor position
 * @param includeAtSymbol Whether to consider @ symbol as part of the token
 * @returns The completable token and its start position, or null if not found
 */
export function extractCompletionToken(text: string, cursorPos: number, includeAtSymbol = false): {
  token: string;
  startPos: number;
  isQuoted?: boolean;
} | null {
  // Empty input check
  if (!text) return null;

  // Get text up to cursor
  const textBeforeCursor = text.substring(0, cursorPos);

  // Check for quoted @ mention first (e.g., @"my file with spaces")
  if (includeAtSymbol) {
    const quotedAtRegex = /@"([^"]*)"?$/;
    const quotedMatch = textBeforeCursor.match(quotedAtRegex);
    if (quotedMatch && quotedMatch.index !== undefined) {
      // Include any remaining quoted content after cursor until closing quote or end
      const textAfterCursor = text.substring(cursorPos);
      const afterQuotedMatch = textAfterCursor.match(/^[^"]*"?/);
      const quotedSuffix = afterQuotedMatch ? afterQuotedMatch[0] : '';
      return {
        token: quotedMatch[0] + quotedSuffix,
        startPos: quotedMatch.index,
        isQuoted: true
      };
    }
  }

  // Fast path for @ tokens: use lastIndexOf to avoid expensive $ anchor scan
  if (includeAtSymbol) {
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
      const fromAt = textBeforeCursor.substring(atIdx);
      const atHeadMatch = fromAt.match(AT_TOKEN_HEAD_RE);
      if (atHeadMatch && atHeadMatch[0].length === fromAt.length) {
        const textAfterCursor = text.substring(cursorPos);
        const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
        const tokenSuffix = afterMatch ? afterMatch[0] : '';
        return {
          token: atHeadMatch[0] + tokenSuffix,
          startPos: atIdx,
          isQuoted: false
        };
      }
    }
  }

  // Non-@ token or cursor outside @ token — use $ anchor on (short) tail
  const tokenRegex = includeAtSymbol ? TOKEN_WITH_AT_RE : TOKEN_WITHOUT_AT_RE;
  const match = textBeforeCursor.match(tokenRegex);
  if (!match || match.index === undefined) {
    return null;
  }

  // Check if cursor is in the MIDDLE of a token (more word characters after cursor)
  // If so, extend the token to include all characters until whitespace or end of string
  const textAfterCursor = text.substring(cursorPos);
  const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
  const tokenSuffix = afterMatch ? afterMatch[0] : '';
  return {
    token: match[0] + tokenSuffix,
    startPos: match.index,
    isQuoted: false
  };
}
function extractCommandNameAndArgs(value: string): {
  commandName: string;
  args: string;
} | null {
  if (isCommandInput(value)) {
    const spaceIndex = value.indexOf(' ');
    if (spaceIndex === -1) return {
      commandName: value.slice(1),
      args: ''
    };
    return {
      commandName: value.slice(1, spaceIndex),
      args: value.slice(spaceIndex + 1)
    };
  }
  return null;
}
function hasCommandWithArguments(isAtEndWithWhitespace: boolean, value: string) {
  // If value.endsWith(' ') but the user is not at the end, then the user has
  // potentially gone back to the command in an effort to edit the command name
  // (but preserve the arguments).
  return !isAtEndWithWhitespace && value.includes(' ') && !value.endsWith(' ');
}

/**
 * Hook for handling typeahead functionality for both commands and file paths
 */
export function useTypeahead({
  commands,
  onInputChange,
  onSubmit,
  setCursorOffset,
  input,
  cursorOffset,
  mode,
  agents,
  setSuggestionsState,
  suggestionsState: {
    suggestions,
    selectedSuggestion,
    commandArgumentHint
  },
  suppressSuggestions = false,
  markAccepted,
  onModeChange
}: Props): UseTypeaheadResult {
  const {
    addNotification
  } = useNotifications();
  const thinkingToggleShortcut = useShortcutDisplay('chat:thinkingToggle', 'Chat', 'alt+t');
  const [suggestionType, setSuggestionType] = useState<SuggestionType>('none');

  // Compute max column width from ALL commands once (not filtered results)
  // This prevents layout shift when filtering
  const allCommandsMaxWidth = useMemo(() => {
    const visibleCommands = commands.filter(cmd => !cmd.isHidden);
    if (visibleCommands.length === 0) return undefined;
    const maxLen = Math.max(...visibleCommands.map(cmd => getCommandName(cmd).length));
    return maxLen + 6; // +1 for "/" prefix, +5 for padding
  }, [commands]);
  const [maxColumnWidth, setMaxColumnWidth] = useState<number | undefined>(undefined);
  const mcpResources = useAppState(s => s.mcp.resources);
  const store = useAppStateStore();
  const promptSuggestion = useAppState(s => s.promptSuggestion);
  // PromptInput hides suggestion ghost text in teammate view — mirror that
  // gate here so Tab/rightArrow can't accept what isn't displayed.
  const isViewingTeammate = useAppState(s => !!s.viewingAgentTaskId);

  // Access keybinding context to check for pending chord sequences
  const keybindingContext = useOptionalKeybindingContext();

  // State for inline ghost text (bash history completion - async)
  const [inlineGhostText, setInlineGhostText] = useState<InlineGhostText | undefined>(undefined);

  // Synchronous ghost text for prompt mode mid-input slash commands.
  // Computed during render via useMemo to eliminate the one-frame flicker
  // that occurs when using useState + useEffect (effect runs after render).
  const syncPromptGhostText = useMemo((): InlineGhostText | undefined => {
    if (mode !== 'prompt' || suppressSuggestions) return undefined;
    const midInputCommand = findMidInputSlashCommand(input, cursorOffset);
    if (!midInputCommand) return undefined;
    const match = getBestCommandMatch(midInputCommand.partialCommand, commands);
    if (!match) return undefined;
    return {
      text: match.suffix,
      fullCommand: match.fullCommand,
      insertPosition: midInputCommand.startPos + 1 + midInputCommand.partialCommand.length
    };
  }, [input, cursorOffset, mode, commands, suppressSuggestions]);

  // Merged ghost text: prompt mode uses synchronous useMemo, bash mode uses async useState
  const effectiveGhostText = suppressSuggestions ? undefined : mode === 'prompt' ? syncPromptGhostText : inlineGhostText;

  // Use a ref for cursorOffset to avoid re-triggering suggestions on cursor movement alone
  // We only want to re-fetch suggestions when the actual search token changes
  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;

  // Track the latest search token to discard stale results from slow async operations
  const latestSearchTokenRef = useRef<string | null>(null);
  // Track previous input to detect actual text changes vs. callback recreations
  const prevInputRef = useRef('');
  // Track the latest path token to discard stale results from path completion
  const latestPathTokenRef = useRef('');
  // Track the latest bash input to discard stale results from history completion
  const latestBashInputRef = useRef('');
  // Track the latest slack channel token to discard stale results from MCP
  const latestSlackTokenRef = useRef('');
  // Track suggestions via ref to avoid updateSuggestions being recreated on selection changes
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  // Track the input value when suggestions were manually dismissed to prevent re-triggering
  const dismissedForInputRef = useRef<string | null>(null);

  // Clear all suggestions
  const clearSuggestions = useCallback(() => {
    setSuggestionsState(() => ({
      commandArgumentHint: undefined,
      suggestions: [],
      selectedSuggestion: -1
    }));
    setSuggestionType('none');
    setMaxColumnWidth(undefined);
    setInlineGhostText(undefined);
  }, [setSuggestionsState]);

  // Expensive async operation to fetch file/resource suggestions
  const fetchFileSuggestions = useCallback(async (searchToken: string, isAtSymbol = false): Promise<void> => {
    latestSearchTokenRef.current = searchToken;
    const combinedItems = await generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol);
    // Discard stale results if a newer query was initiated while waiting
    if (latestSearchTokenRef.current !== searchToken) {
      return;
    }
    if (combinedItems.length === 0) {
      // Inline clearSuggestions logic to avoid needing debouncedFetchFileSuggestions
      setSuggestionsState(() => ({
        commandArgumentHint: undefined,
        suggestions: [],
        selectedSuggestion: -1
      }));
      setSuggestionType('none');
      setMaxColumnWidth(undefined);
      return;
    }
    setSuggestionsState(prev => ({
      commandArgumentHint: undefined,
      suggestions: combinedItems,
      selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, combinedItems)
    }));
    setSuggestionType(combinedItems.length > 0 ? 'file' : 'none');
    setMaxColumnWidth(undefined); // No fixed width for file suggestions
  }, [mcpResources, setSuggestionsState, setSuggestionType, setMaxColumnWidth, agents]);

  // Pre-warm the file index on mount so the first @-mention doesn't block.
  // The build runs in background with ~4ms event-loop yields, so it doesn't
  // delay first render — it just races the user's first @ keystroke.
  //
  // If the user types before the build finishes, they get partial results
  // from the ready chunks; when the build completes, re-fire the last
  // search so partial upgrades to full. Clears the token ref so the same
  // query isn't discarded as stale.
  //
  // Skipped under NODE_ENV=test: REPL-mounting tests would spawn git ls-files
  // against the real CI workspace (270k+ files on Windows runners), and the
  // background build outlives the test — its setImmediate chain leaks into
  // subsequent tests in the shard. The subscriber still registers so
  // fileSuggestions tests that trigger a refresh directly work correctly.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'test') {
      startBackgroundCacheRefresh();
    }
    return onIndexBuildComplete(() => {
      const token = latestSearchTokenRef.current;
      if (token !== null) {
        latestSearchTokenRef.current = null;
        void fetchFileSuggestions(token, token === '');
      }
    });
  }, [fetchFileSuggestions]);

  // Debounce the file fetch operation. 50ms sits just above macOS default
  // key-repeat (~33ms) so held-delete/backspace coalesces into one search
  // instead of stuttering on each repeated key. The search itself is ~8–15ms
  // on a 270k-file index.
  const debouncedFetchFileSuggestions = useDebounceCallback(fetchFileSuggestions, 50);
  const fetchSlackChannels = useCallback(async (partial: string): Promise<void> => {
    latestSlackTokenRef.current = partial;
    const channels = await getSlackChannelSuggestions(store.getState().mcp.clients, partial);
    if (latestSlackTokenRef.current !== partial) return;
    setSuggestionsState(prev => ({
      commandArgumentHint: undefined,
      suggestions: channels,
      selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, channels)
    }));
    setSuggestionType(channels.length > 0 ? 'slack-channel' : 'none');
    setMaxColumnWidth(undefined);
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- store is a stable context ref
  [setSuggestionsState]);

  // First keystroke after # needs the MCP round-trip; subsequent keystrokes
  // that share the same first-word segment hit the cache synchronously.
  const debouncedFetchSlackChannels = useDebounceCallback(fetchSlackChannels, 150);

  // Handle immediate suggestion logic (cheap operations)
  // biome-ignore lint/correctness/useExhaustiveDependencies: store is a stable context ref, read imperatively at call-time
  const updateSuggestions = useCallback(async (value: string, inputCursorOffset?: number): Promise<void> => {
    // Use provided cursor offset or fall back to ref (avoids dependency on cursorOffset)
    const effectiveCursorOffset = inputCursorOffset ?? cursorOffsetRef.current;
    if (suppressSuggestions) {
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
      return;
    }

    // Check for mid-input slash command (e.g., "help me /com")
    // Only in prompt mode, not when input starts with "/" (handled separately)
    // Note: ghost text for prompt mode is computed synchronously via syncPromptGhostText useMemo.
    // We only need to clear dropdown suggestions here when ghost text is active.
    if (mode === 'prompt') {
      const midInputCommand = findMidInputSlashCommand(value, effectiveCursorOffset);
      if (midInputCommand) {
        const match = getBestCommandMatch(midInputCommand.partialCommand, commands);
        if (match) {
          // Clear dropdown suggestions when showing ghost text
          setSuggestionsState(() => ({
            commandArgumentHint: undefined,
            suggestions: [],
            selectedSuggestion: -1
          }));
          setSuggestionType('none');
          setMaxColumnWidth(undefined);
          return;
        }
      }
    }

    // Bash mode: check for history-based ghost text completion
    if (mode === 'bash' && value.trim()) {
      latestBashInputRef.current = value;
      const historyMatch = await getShellHistoryCompletion(value);
      // Discard stale results if input changed while waiting
      if (latestBashInputRef.current !== value) {
        return;
      }
      if (historyMatch) {
        setInlineGhostText({
          text: historyMatch.suffix,
          fullCommand: historyMatch.fullCommand,
          insertPosition: value.length
        });
        // Clear dropdown suggestions when showing ghost text
        setSuggestionsState(() => ({
          commandArgumentHint: undefined,
          suggestions: [],
          selectedSuggestion: -1
        }));
        setSuggestionType('none');
        setMaxColumnWidth(undefined);
        return;
      } else {
        // No history match, clear ghost text
        setInlineGhostText(undefined);
      }
    }

    // Check for @ to trigger team member / named subagent suggestions
    // Must check before @ file symbol to prevent conflict
    // Skip in bash mode - @ has no special meaning in shell commands
    const atMatch = mode !== 'bash' ? value.substring(0, effectiveCursorOffset).match(/(^|\s)@([\w-]*)$/) : null;
    if (atMatch) {
      const partialName = (atMatch[2] ?? '').toLowerCase();
      // Imperative read — reading at call-time fixes staleness for
      // teammates/subagents added mid-session.
      const state = store.getState();
      const members: SuggestionItem[] = [];
      const seen = new Set<string>();
      if (isAgentSwarmsEnabled() && state.teamContext) {
        for (const t of Object.values(state.teamContext.teammates ?? {})) {
          if (t.name === TEAM_LEAD_NAME) continue;
          if (!t.name.toLowerCase().startsWith(partialName)) continue;
          seen.add(t.name);
          members.push({
            id: `dm-${t.name}`,
            displayText: `@${t.name}`,
            description: 'send message'
          });
        }
      }
      for (const [name, agentId] of state.agentNameRegistry) {
        if (seen.has(name)) continue;
        if (!name.toLowerCase().startsWith(partialName)) continue;
        const status = state.tasks[agentId]?.status;
        members.push({
          id: `dm-${name}`,
          displayText: `@${name}`,
          description: status ? `send message · ${status}` : 'send message'
        });
      }
      if (members.length > 0) {
        debouncedFetchFileSuggestions.cancel();
        setSuggestionsState(prev => ({
          commandArgumentHint: undefined,
          suggestions: members,
          selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, members)
        }));
        setSuggestionType('agent');
        setMaxColumnWidth(undefined);
        return;
      }
    }

    // Check for # to trigger Slack channel suggestions (requires Slack MCP server)
    if (mode === 'prompt') {
      const hashMatch = value.substring(0, effectiveCursorOffset).match(HASH_CHANNEL_RE);
      if (hashMatch && hasSlackMcpServer(store.getState().mcp.clients)) {
        debouncedFetchSlackChannels(hashMatch[2]!);
        return;
      } else if (suggestionType === 'slack-channel') {
        debouncedFetchSlackChannels.cancel();
        clearSuggestions();
      }
    }

    // Check for @ symbol to trigger file suggestions (including quoted paths)
    // Includes colon for MCP resources (e.g., server:resource/path)
    const hasAtSymbol = value.substring(0, effectiveCursorOffset).match(HAS_AT_SYMBOL_RE);

    // First, check for slash command suggestions (higher priority than @ symbol)
    // Only show slash command selector if cursor is not on the "/" character itself
    // Also don't show if cursor is at end of line with whitespace before it
    // Don't show slash commands in bash mode
    const isAtEndWithWhitespace = effectiveCursorOffset === value.length && effectiveCursorOffset > 0 && value.length > 0 && value[effectiveCursorOffset - 1] === ' ';

    // Handle directory completion for commands
    if (mode === 'prompt' && isCommandInput(value) && effectiveCursorOffset > 0) {
      const parsedCommand = extractCommandNameAndArgs(value);
      if (parsedCommand && parsedCommand.commandName === 'add-dir' && parsedCommand.args) {
        const {
          args
        } = parsedCommand;

        // Clear suggestions if args end with whitespace (user is done with path)
        if (args.match(/\s+$/)) {
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
          return;
        }
        const dirSuggestions = await getDirectoryCompletions(args);
        if (dirSuggestions.length > 0) {
          setSuggestionsState(prev => ({
            suggestions: dirSuggestions,
            selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, dirSuggestions),
            commandArgumentHint: undefined
          }));
          setSuggestionType('directory');
          return;
        }

        // No suggestions found - clear and return
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
        return;
      }

      // Handle custom title completion for /resume command
      if (parsedCommand && parsedCommand.commandName === 'resume' && parsedCommand.args !== undefined && value.includes(' ')) {
        const {
          args
        } = parsedCommand;

        // Get custom title suggestions using partial match
        const matches = await searchSessionsByCustomTitle(args, {
          limit: 10
        });
        const suggestions = matches.map(log => {
          const sessionId = getSessionIdFromLog(log);
          return {
            id: `resume-title-${sessionId}`,
            displayText: log.customTitle!,
            description: formatLogMetadata(log),
            metadata: {
              sessionId
            }
          };
        });
        if (suggestions.length > 0) {
          setSuggestionsState(prev => ({
            suggestions,
            selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, suggestions),
            commandArgumentHint: undefined
          }));
          setSuggestionType('custom-title');
          return;
        }

        // No suggestions found - clear and return
        clearSuggestions();
        return;
      }
    }

    // Determine whether to display the argument hint and command suggestions.
    if (mode === 'prompt' && isCommandInput(value) && effectiveCursorOffset > 0 && !hasCommandWithArguments(isAtEndWithWhitespace, value)) {
      let commandArgumentHint: string | undefined = undefined;
      if (value.length > 1) {
        // We have a partial or complete command without arguments
        // Check if it matches a command exactly and has an argument hint

        // Extract command name: everything after / until the first space (or end)
        const spaceIndex = value.indexOf(' ');
        const commandName = spaceIndex === -1 ? value.slice(1) : value.slice(1, spaceIndex);

        // Check if there are real arguments (non-whitespace after the command)
        const hasRealArguments = spaceIndex !== -1 && value.slice(spaceIndex + 1).trim().length > 0;

        // Check if input is exactly "command + single space" (ready for arguments)
        const hasExactlyOneTrailingSpace = spaceIndex !== -1 && value.length === spaceIndex + 1;

        // If input has a space after the command, don't show suggestions
        // This prevents Enter from selecting a different command after Tab completion
        if (spaceIndex !== -1) {
          const exactMatch = commands.find(cmd => getCommandName(cmd) === commandName);
          if (exactMatch || hasRealArguments) {
            // Priority 1: Static argumentHint (only on first trailing space for backwards compat)
            if (exactMatch?.argumentHint && hasExactlyOneTrailingSpace) {
              commandArgumentHint = exactMatch.argumentHint;
            }
            // Priority 2: Progressive hint from argNames (show when trailing space)
            else if (exactMatch?.type === 'prompt' && exactMatch.argNames?.length && value.endsWith(' ')) {
              const argsText = value.slice(spaceIndex + 1);
              const typedArgs = parseArguments(argsText);
              commandArgumentHint = generateProgressiveArgumentHint(exactMatch.argNames, typedArgs);
            }
            setSuggestionsState(() => ({
              commandArgumentHint,
              suggestions: [],
              selectedSuggestion: -1
            }));
            setSuggestionType('none');
            setMaxColumnWidth(undefined);
            return;
          }
        }

        // Note: argument hint is only shown when there's exactly one trailing space
        // (set above when hasExactlyOneTrailingSpace is true)
      }
      const commandItems = generateCommandSuggestions(value, commands);
      setSuggestionsState(() => ({
        commandArgumentHint,
        suggestions: commandItems,
        selectedSuggestion: commandItems.length > 0 ? 0 : -1
      }));
      setSuggestionType(commandItems.length > 0 ? 'command' : 'none');

      // Use stable width from all commands (prevents layout shift when filtering)
      if (commandItems.length > 0) {
        setMaxColumnWidth(allCommandsMaxWidth);
      }
      return;
    }
    if (suggestionType === 'command') {
      // If we had command suggestions but the input no longer starts with '/'
      // we need to clear the suggestions. However, we should not return
      // because there may be relevant @ symbol and file suggestions.
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
    } else if (isCommandInput(value) && hasCommandWithArguments(isAtEndWithWhitespace, value)) {
      // If we have a command with arguments (no trailing space), clear any stale hint
      // This prevents the hint from flashing when transitioning between states
      setSuggestionsState(prev => prev.commandArgumentHint ? {
        ...prev,
        commandArgumentHint: undefined
      } : prev);
    }
    if (suggestionType === 'custom-title') {
      // If we had custom-title suggestions but the input is no longer /resume
      // we need to clear the suggestions.
      clearSuggestions();
    }
    if (suggestionType === 'agent' && suggestionsRef.current.some((s: SuggestionItem) => s.id?.startsWith('dm-'))) {
      // If we had team member suggestions but the input no longer has @
      // we need to clear the suggestions.
      const hasAt = value.substring(0, effectiveCursorOffset).match(/(^|\s)@([\w-]*)$/);
      if (!hasAt) {
        clearSuggestions();
      }
    }

    // Check for @ symbol to trigger file and MCP resource suggestions
    // Skip @ autocomplete in bash mode - @ has no special meaning in shell commands
    if (hasAtSymbol && mode !== 'bash') {
      // Get the @ token (including the @ symbol)
      const completionToken = extractCompletionToken(value, effectiveCursorOffset, true);
      if (completionToken && completionToken.token.startsWith('@')) {
        const searchToken = extractSearchToken(completionToken);

        // If the token after @ is path-like, use path completion instead of fuzzy search
        // This handles cases like @~/path, @./path, @/path for directory traversal
        if (isPathLikeToken(searchToken)) {
          latestPathTokenRef.current = searchToken;
          const pathSuggestions = await getPathCompletions(searchToken, {
            maxResults: 10
          });
          // Discard stale results if a newer query was initiated while waiting
          if (latestPathTokenRef.current !== searchToken) {
            return;
          }
          if (pathSuggestions.length > 0) {
            setSuggestionsState(prev => ({
              suggestions: pathSuggestions,
              selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, pathSuggestions),
              commandArgumentHint: undefined
            }));
            setSuggestionType('directory');
            return;
          }
        }

        // Skip if we already fetched for this exact token (prevents loop from
        // suggestions dependency causing updateSuggestions to be recreated)
        if (latestSearchTokenRef.current === searchToken) {
          return;
        }
        void debouncedFetchFileSuggestions(searchToken, true);
        return;
      }
    }

    // If we have active file suggestions or the input changed, check for file suggestions
    if (suggestionType === 'file') {
      const completionToken = extractCompletionToken(value, effectiveCursorOffset, true);
      if (completionToken) {
        const searchToken = extractSearchToken(completionToken);
        // Skip if we already fetched for this exact token
        if (latestSearchTokenRef.current === searchToken) {
          return;
        }
        void debouncedFetchFileSuggestions(searchToken, false);
      } else {
        // If we had file suggestions but now there's no completion token
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }

    // Clear shell suggestions if not in bash mode OR if input has changed
    if (suggestionType === 'shell') {
      const inputSnapshot = (suggestionsRef.current[0]?.metadata as {
        inputSnapshot?: string;
      })?.inputSnapshot;
      if (mode !== 'bash' || value !== inputSnapshot) {
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }
  }, [suggestionType, commands, setSuggestionsState, clearSuggestions, debouncedFetchFileSuggestions, debouncedFetchSlackChannels, mode, suppressSuggestions,
  // Note: using suggestionsRef instead of suggestions to avoid recreating
  // this callback when only selectedSuggestion changes (not the suggestions list)
  allCommandsMaxWidth]);

  // Update suggestions when input changes
  // Note: We intentionally don't depend on cursorOffset here - cursor movement alone
  // shouldn't re-trigger suggestions. The cursorOffsetRef is used to get the current
  // position when needed without causing re-renders.
  useEffect(() => {
    // If suggestions were dismissed for this exact input, don't re-trigger
    if (dismissedForInputRef.current === input) {
      return;
    }
    // When the actual input text changes (not just updateSuggestions being recreated),
    // reset the search token ref so the same query can be re-fetched.
    // This fixes: type @readme.md, clear, retype @readme.md → no suggestions.
    if (prevInputRef.current !== input) {
      prevInputRef.current = input;
      latestSearchTokenRef.current = null;
    }
    // Clear the dismissed state when input changes
    dismissedForInputRef.current = null;
    void updateSuggestions(input);
  }, [input, updateSuggestions]);

  // Handle tab key press - complete suggestions or trigger file suggestions
  const handleTab = useCallback(async () => {
    // If we have inline ghost text, apply it
    if (effectiveGhostText) {
      // Check for bash mode history completion first
      if (mode === 'bash') {
        // Replace the input with the full command from history
        onInputChange(effectiveGhostText.fullCommand);
        setCursorOffset(effectiveGhostText.fullCommand.length);
        setInlineGhostText(undefined);
        return;
      }

      // Find the mid-input command to get its position (for prompt mode)
      const midInputCommand = findMidInputSlashCommand(input, cursorOffset);
      if (midInputCommand) {
        // Replace the partial command with the full command + space
        const before = input.slice(0, midInputCommand.startPos);
        const after = input.slice(midInputCommand.startPos + midInputCommand.token.length);
        const newInput = before + '/' + effectiveGhostText.fullCommand + ' ' + after;
        const newCursorOffset = midInputCommand.startPos + 1 + effectiveGhostText.fullCommand.length + 1;
        onInputChange(newInput);
        setCursorOffset(newCursorOffset);
        return;
      }
    }

    // If we have active suggestions, select one
    if (suggestions.length > 0) {
      // Cancel any pending debounced fetches to prevent flicker when accepting
      debouncedFetchFileSuggestions.cancel();
      debouncedFetchSlackChannels.cancel();
      const index = selectedSuggestion === -1 ? 0 : selectedSuggestion;
      const suggestion = suggestions[index];
      if (suggestionType === 'command' && index < suggestions.length) {
        if (suggestion) {
          applyCommandSuggestion(suggestion, false,
          // don't execute on tab
          commands, onInputChange, setCursorOffset, onSubmit);
          clearSuggestions();
        }
      } else if (suggestionType === 'custom-title' && suggestions.length > 0) {
        // Apply custom title to /resume command with sessionId
        if (suggestion) {
          const newInput = buildResumeInputFromSuggestion(suggestion);
          onInputChange(newInput);
          setCursorOffset(newInput.length);
          clearSuggestions();
        }
      } else if (suggestionType === 'directory' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          // Check if this is a command context (e.g., /add-dir) or general path completion
          const isInCommandContext = isCommandInput(input);
          let newInput: string;
          if (isInCommandContext) {
            // Command context: replace just the argument portion
            const spaceIndex = input.indexOf(' ');
            const commandPart = input.slice(0, spaceIndex + 1); // Include the space
            const cmdSuffix = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory' ? '/' : ' ';
            newInput = commandPart + suggestion.id + cmdSuffix;
            onInputChange(newInput);
            setCursorOffset(newInput.length);
            if (isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory') {
              // For directories, fetch new suggestions for the updated path
              setSuggestionsState(prev => ({
                ...prev,
                commandArgumentHint: undefined
              }));
              void updateSuggestions(newInput, newInput.length);
            } else {
              clearSuggestions();
            }
          } else {
            // General path completion: replace the path token in input with @-prefixed path
            // Try to get token with @ prefix first to check if already prefixed
            const completionTokenWithAt = extractCompletionToken(input, cursorOffset, true);
            const completionToken = completionTokenWithAt ?? extractCompletionToken(input, cursorOffset, false);
            if (completionToken) {
              const isDir = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory';
              const result = applyDirectorySuggestion(input, suggestion.id, completionToken.startPos, completionToken.token.length, isDir);
              newInput = result.newInput;
              onInputChange(newInput);
              setCursorOffset(result.cursorPos);
              if (isDir) {
                // For directories, fetch new suggestions for the updated path
                setSuggestionsState(prev => ({
                  ...prev,
                  commandArgumentHint: undefined
                }));
                void updateSuggestions(newInput, result.cursorPos);
              } else {
                // For files, clear suggestions
                clearSuggestions();
              }
            } else {
              // No completion token found (e.g., cursor after space) - just clear suggestions
              // without modifying input to avoid data loss
              clearSuggestions();
            }
          }
        }
      } else if (suggestionType === 'shell' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          const metadata = suggestion.metadata as {
            completionType: ShellCompletionType;
          } | undefined;
          applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
          clearSuggestions();
        }
      } else if (suggestionType === 'agent' && suggestions.length > 0 && suggestions[index]?.id?.startsWith('dm-')) {
        const suggestion = suggestions[index];
        if (suggestion) {
          applyTriggerSuggestion(suggestion, input, cursorOffset, DM_MEMBER_RE, onInputChange, setCursorOffset);
          clearSuggestions();
        }
      } else if (suggestionType === 'slack-channel' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          applyTriggerSuggestion(suggestion, input, cursorOffset, HASH_CHANNEL_RE, onInputChange, setCursorOffset);
          clearSuggestions();
        }
      } else if (suggestionType === 'file' && suggestions.length > 0) {
        const completionToken = extractCompletionToken(input, cursorOffset, true);
        if (!completionToken) {
          clearSuggestions();
          return;
        }

        // Check if all suggestions share a common prefix longer than the current input
        const commonPrefix = findLongestCommonPrefix(suggestions);

        // Determine if token starts with @ to preserve it during replacement
        const hasAtPrefix = completionToken.token.startsWith('@');
        // The effective token length excludes the @ and quotes if present
        let effectiveTokenLength: number;
        if (completionToken.isQuoted) {
          // Remove @" prefix and optional closing " to get effective length
          effectiveTokenLength = completionToken.token.slice(2).replace(/"$/, '').length;
        } else if (hasAtPrefix) {
          effectiveTokenLength = completionToken.token.length - 1;
        } else {
          effectiveTokenLength = completionToken.token.length;
        }

        // If there's a common prefix longer than what the user has typed,
        // replace the current input with the common prefix
        if (commonPrefix.length > effectiveTokenLength) {
          const replacementValue = formatReplacementValue({
            displayText: commonPrefix,
            mode,
            hasAtPrefix,
            needsQuotes: false,
            // common prefix doesn't need quotes unless already quoted
            isQuoted: completionToken.isQuoted,
            isComplete: false // partial completion
          });
          applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
          // Don't clear suggestions so user can continue typing or select a specific option
          // Instead, update for the new prefix
          void updateSuggestions(input.replace(completionToken.token, replacementValue), cursorOffset);
        } else if (index < suggestions.length) {
          // Otherwise, apply the selected suggestion
          const suggestion = suggestions[index];
          if (suggestion) {
            const needsQuotes = suggestion.displayText.includes(' ');
            const replacementValue = formatReplacementValue({
              displayText: suggestion.displayText,
              mode,
              hasAtPrefix,
              needsQuotes,
              isQuoted: completionToken.isQuoted,
              isComplete: true // complete suggestion
            });
            applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
            clearSuggestions();
          }
        }
      }
    } else if (input.trim() !== '') {
      let suggestionType: SuggestionType;
      let suggestionItems: SuggestionItem[];
      if (mode === 'bash') {
        suggestionType = 'shell';
        // This should be very fast, taking <10ms
        const bashSuggestions = await generateBashSuggestions(input, cursorOffset);
        if (bashSuggestions.length === 1) {
          // If single suggestion, apply it immediately
          const suggestion = bashSuggestions[0];
          if (suggestion) {
            const metadata = suggestion.metadata as {
              completionType: ShellCompletionType;
            } | undefined;
            applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
          }
          suggestionItems = [];
        } else {
          suggestionItems = bashSuggestions;
        }
      } else {
        suggestionType = 'file';
        // If no suggestions, fetch file and MCP resource suggestions
        const completionInfo = extractCompletionToken(input, cursorOffset, true);
        if (completionInfo) {
          // If token starts with @, search without the @ prefix
          const isAtSymbol = completionInfo.token.startsWith('@');
          const searchToken = isAtSymbol ? completionInfo.token.substring(1) : completionInfo.token;
          suggestionItems = await generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol);
        } else {
          suggestionItems = [];
        }
      }
      if (suggestionItems.length > 0) {
        // Multiple suggestions or not bash mode: show list
        setSuggestionsState(prev => ({
          commandArgumentHint: undefined,
          suggestions: suggestionItems,
          selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, suggestionItems)
        }));
        setSuggestionType(suggestionType);
        setMaxColumnWidth(undefined);
      }
    }
  }, [suggestions, selectedSuggestion, input, suggestionType, commands, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, cursorOffset, updateSuggestions, mcpResources, setSuggestionsState, agents, debouncedFetchFileSuggestions, debouncedFetchSlackChannels, effectiveGhostText]);

  // Handle enter key press - apply and execute suggestions
  const handleEnter = useCallback(() => {
    if (selectedSuggestion < 0 || suggestions.length === 0) return;
    const suggestion = suggestions[selectedSuggestion];
    if (suggestionType === 'command' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyCommandSuggestion(suggestion, true,
        // execute on return
        commands, onInputChange, setCursorOffset, onSubmit);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'custom-title' && selectedSuggestion < suggestions.length) {
      // Apply custom title and execute /resume command with sessionId
      if (suggestion) {
        const newInput = buildResumeInputFromSuggestion(suggestion);
        onInputChange(newInput);
        setCursorOffset(newInput.length);
        onSubmit(newInput, /* isSubmittingSlashCommand */true);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'shell' && selectedSuggestion < suggestions.length) {
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        const metadata = suggestion.metadata as {
          completionType: ShellCompletionType;
        } | undefined;
        applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'agent' && selectedSuggestion < suggestions.length && suggestion?.id?.startsWith('dm-')) {
      applyTriggerSuggestion(suggestion, input, cursorOffset, DM_MEMBER_RE, onInputChange, setCursorOffset);
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
    } else if (suggestionType === 'slack-channel' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyTriggerSuggestion(suggestion, input, cursorOffset, HASH_CHANNEL_RE, onInputChange, setCursorOffset);
        debouncedFetchSlackChannels.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'file' && selectedSuggestion < suggestions.length) {
      // Extract completion token directly when needed
      const completionInfo = extractCompletionToken(input, cursorOffset, true);
      if (completionInfo) {
        if (suggestion) {
          const hasAtPrefix = completionInfo.token.startsWith('@');
          const needsQuotes = suggestion.displayText.includes(' ');
          const replacementValue = formatReplacementValue({
            displayText: suggestion.displayText,
            mode,
            hasAtPrefix,
            needsQuotes,
            isQuoted: completionInfo.isQuoted,
            isComplete: true // complete suggestion
          });
          applyFileSuggestion(replacementValue, input, completionInfo.token, completionInfo.startPos, onInputChange, setCursorOffset);
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
        }
      }
    } else if (suggestionType === 'directory' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        // In command context (e.g., /add-dir), Enter submits the command
        // rather than applying the directory suggestion. Just clear
        // suggestions and let the submit handler process the current input.
        if (isCommandInput(input)) {
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
          return;
        }

        // General path completion: replace the path token
        const completionTokenWithAt = extractCompletionToken(input, cursorOffset, true);
        const completionToken = completionTokenWithAt ?? extractCompletionToken(input, cursorOffset, false);
        if (completionToken) {
          const isDir = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory';
          const result = applyDirectorySuggestion(input, suggestion.id, completionToken.startPos, completionToken.token.length, isDir);
          onInputChange(result.newInput);
          setCursorOffset(result.cursorPos);
        }
        // If no completion token found (e.g., cursor after space), don't modify input
        // to avoid data loss - just clear suggestions

        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }
  }, [suggestions, selectedSuggestion, suggestionType, commands, input, cursorOffset, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, debouncedFetchFileSuggestions, debouncedFetchSlackChannels]);

  // Handler for autocomplete:accept - accepts current suggestion via Tab or Right Arrow
  const handleAutocompleteAccept = useCallback(() => {
    void handleTab();
  }, [handleTab]);

  // Handler for autocomplete:dismiss - clears suggestions and prevents re-triggering
  const handleAutocompleteDismiss = useCallback(() => {
    debouncedFetchFileSuggestions.cancel();
    debouncedFetchSlackChannels.cancel();
    clearSuggestions();
    // Remember the input when dismissed to prevent immediate re-triggering
    dismissedForInputRef.current = input;
  }, [debouncedFetchFileSuggestions, debouncedFetchSlackChannels, clearSuggestions, input]);

  // Handler for autocomplete:previous - selects previous suggestion
  const handleAutocompletePrevious = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.suggestions.length === 0
        ? -1
        : prev.selectedSuggestion <= 0
          ? prev.suggestions.length - 1
          : Math.min(prev.selectedSuggestion - 1, prev.suggestions.length - 1)
    }));
  }, [setSuggestionsState]);

  // Handler for autocomplete:next - selects next suggestion
  const handleAutocompleteNext = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.suggestions.length === 0
        ? -1
        : prev.selectedSuggestion >= prev.suggestions.length - 1
          ? 0
          : Math.max(0, prev.selectedSuggestion + 1)
    }));
  }, [setSuggestionsState]);

  // Autocomplete context keybindings - only active when suggestions are visible
  const autocompleteHandlers = useMemo(() => ({
    'autocomplete:accept': handleAutocompleteAccept,
    'autocomplete:dismiss': handleAutocompleteDismiss,
    'autocomplete:previous': handleAutocompletePrevious,
    'autocomplete:next': handleAutocompleteNext
  }), [handleAutocompleteAccept, handleAutocompleteDismiss, handleAutocompletePrevious, handleAutocompleteNext]);

  // Register autocomplete as an overlay so CancelRequestHandler defers ESC handling
  // This ensures ESC dismisses autocomplete before canceling running tasks
  const isAutocompleteActive = suggestions.length > 0 || !!effectiveGhostText;
  const isModalOverlayActive = useIsModalOverlayActive();
  useRegisterOverlay('autocomplete', isAutocompleteActive);
  // Register Autocomplete context so it appears in activeContexts for other handlers.
  // This allows Chat's resolver to see Autocomplete and defer to its bindings for up/down.
  useRegisterKeybindingContext('Autocomplete', isAutocompleteActive);

  // Disable autocomplete keybindings when a modal overlay (e.g., DiffDialog) is active,
  // so escape reaches the overlay's handler instead of dismissing autocomplete
  useKeybindings(autocompleteHandlers, {
    context: 'Autocomplete',
    isActive: isAutocompleteActive && !isModalOverlayActive
  });
  function acceptSuggestionText(text: string): void {
    const detectedMode = getModeFromInput(text);
    if (detectedMode !== 'prompt' && onModeChange) {
      onModeChange(detectedMode);
      const stripped = getValueFromInput(text);
      onInputChange(stripped);
      setCursorOffset(stripped.length);
    } else {
      onInputChange(text);
      setCursorOffset(text.length);
    }
  }

  // Handle keyboard input for behaviors not covered by keybindings
  const handleKeyDown = (e: KeyboardEvent): void => {
    // Handle right arrow to accept prompt suggestion ghost text
    if (e.key === 'right' && !isViewingTeammate) {
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input === '') {
        markAccepted();
        acceptSuggestionText(suggestionText);
        e.stopImmediatePropagation();
        return;
      }
    }

    // Handle Tab key fallback behaviors when no autocomplete suggestions
    // Don't handle tab if shift is pressed (used for mode cycle)
    if (e.key === 'tab' && !e.shift) {
      // Skip if autocomplete is handling this (suggestions or ghost text exist)
      if (suggestions.length > 0 || effectiveGhostText) {
        return;
      }
      // Accept prompt suggestion if it exists in AppState
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input === '' && !isViewingTeammate) {
        e.preventDefault();
        markAccepted();
        acceptSuggestionText(suggestionText);
        return;
      }
      // Remind user about thinking toggle shortcut if empty input
      if (input.trim() === '') {
        e.preventDefault();
        addNotification({
          key: 'thinking-toggle-hint',
          jsx: <Text dimColor>
              Use {thinkingToggleShortcut} to toggle thinking
            </Text>,
          priority: 'immediate',
          timeoutMs: 3000
        });
      }
      return;
    }

    // Only continue with navigation if we have suggestions
    if (suggestions.length === 0) return;

    // Handle Ctrl-N/P for navigation (arrows handled by keybindings)
    // Skip if we're in the middle of a chord sequence to allow chords like ctrl+f n
    const hasPendingChord = keybindingContext?.pendingChord != null;
    if (e.ctrl && e.key === 'n' && !hasPendingChord) {
      e.preventDefault();
      handleAutocompleteNext();
      return;
    }
    if (e.ctrl && e.key === 'p' && !hasPendingChord) {
      e.preventDefault();
      handleAutocompletePrevious();
      return;
    }

    // Handle selection and execution via return/enter
    // Shift+Enter and Meta+Enter insert newlines (handled by useTextInput),
    // so don't accept the suggestion for those.
    if (e.key === 'return' && !e.shift && !e.meta) {
      e.preventDefault();
      handleEnter();
    }
  };

  // Backward-compat bridge: PromptInput doesn't yet wire handleKeyDown to
  // <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until the consumer is migrated (separate PR).
  // TODO(onKeyDown-migration): remove once PromptInput passes handleKeyDown.
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  });
  return {
    suggestions,
    selectedSuggestion,
    suggestionType,
    maxColumnWidth,
    commandArgumentHint,
    inlineGhostText: effectiveGhostText,
    handleKeyDown
  };
}
