/**
 * Detects the boolean `-p, --print` flag in raw argv, including the forms
 * commander accepts for a boolean option: `-p`, `--print`, `--print=prompt`,
 * and attached short-option values like `-pprompt`.
 *
 * Stops at `--` so positional values after the end-of-options marker are not
 * mistaken for flags.
 */
export function hasPrintFlag(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (arg === '--') break
    if (
      arg === '-p' ||
      arg === '--print' ||
      arg.startsWith('--print=') ||
      (arg.startsWith('-p') && arg.length > 2)
    ) {
      return true
    }
  }
  return false
}
