import type { QueryGuardLeaseInput } from '../../utils/QueryGuard.js'
import { getEffectiveBashTimeoutMs } from '../../utils/timeouts.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getShellTimeoutMs(input: Record<string, unknown>): number {
  // PowerShell already shares the Bash timeout helpers and env vars; keep that
  // compatibility surface stable here.
  return getEffectiveBashTimeoutMs(input.timeout)
}

export function createToolQueryLeaseInput(
  toolName: string,
  toolUseID: string,
  input: unknown,
): QueryGuardLeaseInput | null {
  if (!isRecord(input)) {
    return null
  }

  if (
    toolName !== BASH_TOOL_NAME &&
    toolName !== POWERSHELL_TOOL_NAME
  ) {
    return null
  }

  if (input.run_in_background === true) {
    return null
  }

  return {
    owner: toolName === BASH_TOOL_NAME ? 'bash' : 'powershell',
    id: toolUseID,
    timeoutMs: getShellTimeoutMs(input),
    description: toolName,
  }
}
