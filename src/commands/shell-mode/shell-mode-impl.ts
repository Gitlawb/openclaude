import { spawn } from 'child_process'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async (_args: string) => {
  return {
    type: 'text',
    value: `🐚 Shell Mode

Press Ctrl-X at any time to drop into a raw shell. Type 'exit' or press
Ctrl-X again to return to DuckHive.

Keybindings:
  Ctrl+X  — Toggle between DuckHive and shell
  Ctrl+C  — Cancel current operation
  Ctrl+D  — Exit shell mode (same as 'exit')

In shell mode you have full access to your terminal. When you type 'exit',
you return to DuckHive with your session intact.

This is inspired by kimi-cli's shell toggle — no need to leave your session
to run quick terminal commands.`,
  }
}

// Note: The actual Ctrl-X toggle is implemented as an app:toggleShell keybinding
// in useGlobalKeybindings.tsx. This slash command serves as documentation and
// fallback for users who prefer typing /shell.