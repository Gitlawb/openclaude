import type { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../Tool.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { getCwd } from '../../utils/cwd.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { BashTool } from './BashTool.js'
import { checkReadOnlyConstraints } from './readOnlyValidation.js'
import { checkDangerousRemovalPaths } from './pathValidation.js'

const ACCEPT_EDITS_WRITE_COMMANDS = [
  // Filesystem write commands
  'mkdir',
  'touch',
  'rm',
  'rmdir',
  'mv',
  'cp',
  'sed',
 ] as const

const ACCEPT_EDITS_READ_ONLY_COMMANDS = [
  // Safe read-only commands — cannot modify files or cause data loss.
  // These still need to pass the existing read-only validator so redirects and
  // dangerous flags fall through to the normal permission flow.
  'grep',
  'cat',
  'ls',
  'find',
  'head',
  'tail',
  'echo',
  'pwd',
  'wc',
  'sort',
  'uniq',
  'diff',
] as const

type AcceptEditsWriteCommand = (typeof ACCEPT_EDITS_WRITE_COMMANDS)[number]
type AcceptEditsReadOnlyCommand =
  (typeof ACCEPT_EDITS_READ_ONLY_COMMANDS)[number]

function isAcceptEditsWriteCommand(
  command: string,
): command is AcceptEditsWriteCommand {
  return ACCEPT_EDITS_WRITE_COMMANDS.includes(command as AcceptEditsWriteCommand)
}

function isAcceptEditsReadOnlyCommand(
  command: string,
): command is AcceptEditsReadOnlyCommand {
  return ACCEPT_EDITS_READ_ONLY_COMMANDS.includes(
    command as AcceptEditsReadOnlyCommand,
  )
}

function hasShellRedirection(cmd: string): boolean {
  const parsed = tryParseShellCommand(cmd, env => `$${env}`)
  if (!parsed.success) {
    // Fail closed: unparseable commands should go through the normal prompt flow.
    return true
  }

  return parsed.tokens.some(
    token =>
      typeof token === 'object' &&
      token !== null &&
      'op' in token &&
      ['>', '>>', '>|', '&>', '&>>', '1>', '1>>', '2>', '2>>'].includes(
        String(token.op),
      ),
  )
}

function validateCommandForMode(
  cmd: string,
  toolPermissionContext: ToolPermissionContext,
  originalInput: string,
): PermissionResult {
  const trimmedCmd = cmd.trim()
  const [baseCmd] = trimmedCmd.split(/\s+/)

  if (!baseCmd) {
    return {
      behavior: 'passthrough',
      message: 'Base command not found',
    }
  }

  // In Accept Edits mode, auto-allow filesystem write operations.
  if (
    toolPermissionContext.mode === 'acceptEdits' &&
    isAcceptEditsWriteCommand(baseCmd)
  ) {
    // Guard: always run dangerous path check for rm/rmdir before auto-allowing.
    // This prevents rm -rf ~ / rm -rf / from bypassing checkDangerousRemovalPaths
    // which is otherwise skipped when acceptEdits returns allow early.
    if (baseCmd === 'rm' || baseCmd === 'rmdir') {
      const args = trimmedCmd.split(/\s+/).slice(1)
      const dangerousResult = checkDangerousRemovalPaths(baseCmd, args, getCwd())
      if (dangerousResult.behavior !== 'passthrough') {
        return dangerousResult
      }
    }

    return {
      behavior: 'allow',
      updatedInput: { command: cmd },
      decisionReason: {
        type: 'mode',
        mode: 'acceptEdits',
      },
    }
  }

  // In Accept Edits mode, only auto-allow read-only commands if they still
  // pass the full read-only validator. This prevents redirects and mutating
  // find forms from being silently auto-approved.
  if (
    toolPermissionContext.mode === 'acceptEdits' &&
    isAcceptEditsReadOnlyCommand(baseCmd)
  ) {
    if (hasShellRedirection(originalInput)) {
      return {
        behavior: 'passthrough',
        message:
          'Read-only commands with shell redirection require normal permission checks',
      }
    }

    const readOnlyResult = checkReadOnlyConstraints(
      { command: cmd } as z.infer<typeof BashTool.inputSchema>,
      false,
    )
    if (readOnlyResult.behavior === 'allow') {
      return {
        behavior: 'allow',
        updatedInput: { command: cmd },
        decisionReason: {
          type: 'mode',
          mode: 'acceptEdits',
        },
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: `No mode-specific handling for '${baseCmd}' in ${toolPermissionContext.mode} mode`,
  }
}

/**
 * Checks if commands should be handled differently based on the current permission mode
 *
 * This is the main entry point for mode-based permission logic.
 * Currently handles Accept Edits mode for filesystem commands,
 * but designed to be extended for other modes.
 *
 * @param input - The bash command input
 * @param toolPermissionContext - Context containing mode and permissions
 * @returns
 * - 'allow' if the current mode permits auto-approval
 * - 'ask' if the command needs approval in current mode
 * - 'passthrough' if no mode-specific handling applies
 */
export function checkPermissionMode(
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  // Skip if in bypass mode (handled elsewhere)
  if (toolPermissionContext.mode === 'bypassPermissions') {
    return {
      behavior: 'passthrough',
      message: 'Bypass mode is handled in main permission flow',
    }
  }

  // Skip if in dontAsk mode (handled in main permission flow)
  if (toolPermissionContext.mode === 'dontAsk') {
    return {
      behavior: 'passthrough',
      message: 'DontAsk mode is handled in main permission flow',
    }
  }

  const commands = splitCommand_DEPRECATED(input.command)

  // Check each subcommand
  for (const cmd of commands) {
    const result = validateCommandForMode(cmd, toolPermissionContext, input.command)

    // If any command triggers mode-specific behavior, return that result
    if (result.behavior !== 'passthrough') {
      return result
    }
  }

  // No mode-specific handling needed
  return {
    behavior: 'passthrough',
    message: 'No mode-specific validation required',
  }
}

export function getAutoAllowedCommands(
  mode: ToolPermissionContext['mode'],
): readonly string[] {
  return mode === 'acceptEdits'
    ? [...ACCEPT_EDITS_WRITE_COMMANDS, ...ACCEPT_EDITS_READ_ONLY_COMMANDS]
    : []
}
