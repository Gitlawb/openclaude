import { quote } from './shellQuote.js'

/**
 * Parses a shell prefix that may contain an executable path and arguments.
 *
 * Examples:
 * - "bash" -> quotes as 'bash'
 * - "/usr/bin/bash -c" -> quotes as '/usr/bin/bash' -c
 * - "C:\Program Files\Git\bin\bash.exe -c" -> quotes as 'C:\Program Files\Git\bin\bash.exe' -c
 *
 * @param prefix The shell prefix string containing executable and optional arguments
 * @param command The command to be executed
 * @returns The properly formatted command string with quoted components
 */
export function formatShellPrefixCommand(
  prefix: string,
  command: string,
): string {
  const lastPathSeparator = Math.max(
    prefix.lastIndexOf('/'),
    prefix.lastIndexOf('\\'),
  )
  let spaceBeforeDash = prefix.indexOf(' -')
  while (spaceBeforeDash > 0 && spaceBeforeDash < lastPathSeparator) {
    spaceBeforeDash = prefix.indexOf(' -', spaceBeforeDash + 2)
  }
  const nextSpaceBeforeDash =
    spaceBeforeDash > 0 ? prefix.indexOf(' -', spaceBeforeDash + 2) : -1
  if (
    nextSpaceBeforeDash > 0 &&
    spaceBeforeDash > lastPathSeparator &&
    prefix[spaceBeforeDash + 2] !== '-' &&
    prefix.indexOf(' ', spaceBeforeDash + 2) === nextSpaceBeforeDash
  ) {
    const firstDashToken = prefix.substring(
      spaceBeforeDash + 2,
      nextSpaceBeforeDash,
    )
    const execCandidate = prefix.substring(0, spaceBeforeDash).toLowerCase()
    const isKnownShell =
      execCandidate.endsWith('/bash') ||
      execCandidate.endsWith('\\bash.exe') ||
      execCandidate.endsWith('/sh') ||
      execCandidate.endsWith('\\sh.exe') ||
      execCandidate.endsWith('/zsh') ||
      execCandidate.endsWith('/fish') ||
      execCandidate.endsWith('/pwsh') ||
      execCandidate.endsWith('\\pwsh.exe') ||
      execCandidate.endsWith('/powershell') ||
      execCandidate.endsWith('\\powershell.exe')
    if (firstDashToken.length > 1 && lastPathSeparator >= 0 && !isKnownShell) {
      spaceBeforeDash = nextSpaceBeforeDash
    }
  }
  if (spaceBeforeDash > 0) {
    const execPath = prefix.substring(0, spaceBeforeDash)
    const args = prefix.substring(spaceBeforeDash + 1)
    return `${quote([execPath])} ${args} ${quote([command])}`
  } else {
    return `${quote([prefix])} ${quote([command])}`
  }
}
