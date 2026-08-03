import {
  hasUsedBackslashReturn,
  isShiftEnterKeyBindingInstalled,
} from '../../commands/terminalSetup/terminalSetup.js'
import type { Key } from '../../ink.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'
import { getGlobalConfig } from '../../utils/config.js'
import { env } from '../../utils/env.js'
import type { ModeEntryDecision } from './inputModes.js'
/**
 * Helper function to check if vim mode is currently enabled
 * @returns boolean indicating if vim mode is active
 */
export function isVimModeEnabled(): boolean {
  const config = getGlobalConfig()
  return config.editorMode === 'vim'
}

export function getNewlineInstructions(): string {
  // Apple Terminal on macOS uses native modifier key detection for Shift+Enter
  if (env.terminal === 'Apple_Terminal' && process.platform === 'darwin') {
    return 'shift + ⏎ for newline'
  }

  // For iTerm2 and VSCode, show Shift+Enter instructions if installed
  if (isShiftEnterKeyBindingInstalled()) {
    return 'shift + ⏎ for newline'
  }

  // Otherwise show backslash+return instructions
  return hasUsedBackslashReturn()
    ? '\\⏎ for newline'
    : 'backslash (\\) + return (⏎) for newline'
}

/**
 * True when the keystroke is a printable character that does not begin
 * with whitespace — i.e., a normal letter/digit/symbol the user typed.
 * Used to gate the lazy space inserted after an image pill.
 */
export function isNonSpacePrintable(input: string, key: Key): boolean {
  if (
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.return ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end ||
    input.includes('\x7f')
  ) {
    return false
  }
  return input.length > 0 && !/^\s/.test(input) && !input.startsWith('\x1b')
}

export function resolveCoalescedModeSubmission(
  input: string,
  renderedMode: PromptInputMode,
  pendingModeEntry: ModeEntryDecision | null,
): {
  input: string
  mode: PromptInputMode
  inputModeOverride?: PromptInputMode
} {
  if (!pendingModeEntry) {
    return { input, mode: renderedMode }
  }

  return {
    input: pendingModeEntry.strippedValue.replaceAll('\t', '    '),
    mode: pendingModeEntry.mode,
    inputModeOverride: pendingModeEntry.mode,
  }
}

export function canAcceptPromptSuggestion(mode: PromptInputMode): boolean {
  return mode === 'prompt'
}
