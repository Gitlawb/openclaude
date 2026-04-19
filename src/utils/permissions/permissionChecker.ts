/**
 * Shared permission-checking logic for shell tool permission matching.
 *
 * Both BashTool and PowerShellTool follow the same pattern for
 * `matchingRulesForInput`: fetch deny/ask/allow rule maps, then
 * call a shell-specific filter function on each. This module
 * extracts that shared orchestration logic.
 *
 * Shell-specific `filterRulesByContentsMatchingInput` implementations
 * remain in their respective tool directories — they differ too much
 * in redirection handling, env-var stripping, case sensitivity,
 * and canonical resolution to share directly.
 */

import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionRule } from './PermissionRule.js'
import { getRuleByContentsForToolName } from './permissions.js'

/**
 * Generic signature for shell-specific rule filtering.
 * Each shell tool provides its own implementation that knows
 * how to normalize and match commands against rules.
 */
export type FilterRulesFn = (
  rules: Map<string, PermissionRule>,
  matchMode: 'exact' | 'prefix',
  behavior: 'deny' | 'ask' | 'allow',
) => PermissionRule[]

/**
 * Fetch matching deny/ask/allow rules for a shell tool input.
 *
 * This is the shared logic previously duplicated between
 * bashPermissions.ts and powershellPermissions.ts.
 * Callers provide:
 * - `toolName`: the tool's permission name (e.g. "Bash" or "PowerShell")
 * - `toolPermissionContext`: current permission state
 * - `matchMode`: 'exact' for full-command matching, 'prefix' for subcommand
 * - `filterFn`: shell-specific filter function
 *
 * SECURITY: Deny/ask rules pass `behavior` to the filter so the shell
 * implementation can apply more aggressive stripping (e.g. all env vars
 * for bash, module prefix stripping for PowerShell). Allow rules are
 * intentionally stricter to prevent over-matching.
 */
export function matchingRulesForInput(
  toolName: string,
  toolPermissionContext: ToolPermissionContext,
  matchMode: 'exact' | 'prefix',
  filterFn: FilterRulesFn,
): {
  matchingDenyRules: PermissionRule[]
  matchingAskRules: PermissionRule[]
  matchingAllowRules: PermissionRule[]
} {
  const denyRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    toolName,
    'deny',
  )
  const matchingDenyRules = filterFn(denyRuleByContents, matchMode, 'deny')

  const askRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    toolName,
    'ask',
  )
  const matchingAskRules = filterFn(askRuleByContents, matchMode, 'ask')

  const allowRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    toolName,
    'allow',
  )
  const matchingAllowRules = filterFn(allowRuleByContents, matchMode, 'allow')

  return { matchingDenyRules, matchingAskRules, matchingAllowRules }
}