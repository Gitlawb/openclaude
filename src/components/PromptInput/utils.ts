import {
  hasUsedBackslashReturn,
  isShiftEnterKeyBindingInstalled,
} from '../../commands/terminalSetup/terminalSetup.js'
import type { Key } from '../../ink.js'
import type {
  PromptInputMode,
  TextInputChangeContext,
} from '../../types/textInputTypes.js'
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
    key.end
  ) {
    return false
  }
  const delIndex = input.indexOf('\x7f')
  const leadingInput = delIndex === -1 ? input : input.slice(0, delIndex)
  return (
    leadingInput.length > 0 &&
    !/^\s/.test(leadingInput) &&
    !leadingInput.startsWith('\x1b')
  )
}

export function normalizePromptInputChunk(
  input: string,
  key: Key,
  prependLazySpace: boolean,
): string {
  const normalizedInput = input.replaceAll('\t', '    ')
  return prependLazySpace && isNonSpacePrintable(normalizedInput, key)
    ? ` ${normalizedInput}`
    : normalizedInput
}

export function resolveHelpToggleChange(
  value: string,
  changeContext?: TextInputChangeContext,
):
  | {
      restore?: { value: string; cursorOffset: number }
      suppressSubmit: boolean
    }
  | null {
  if (value !== '?') return null

  return {
    restore: changeContext
      ? {
          value: changeContext.previousValue,
          cursorOffset: changeContext.cursorOffset,
        }
      : undefined,
    suppressSubmit: changeContext?.willSubmit === true,
  }
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
