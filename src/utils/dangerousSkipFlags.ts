/**
 * `--yolo` is registered as a native commander alias of
 * `--dangerously-skip-permissions`, so the pre-commander argv scanners in
 * main.tsx (the direct-connect `cc://` and `ssh` rewrites) must recognize
 * either spelling. Both rewrites strip every dangerous-skip token before
 * handing the argv to the main command, so a shared, tested helper is used
 * rather than ad-hoc single-token removal (which previously let a second
 * token survive and silently re-enable bypass).
 */

const DANGEROUS_SKIP_FLAGS = ['--dangerously-skip-permissions', '--yolo']

export function isDangerousSkipFlag(arg: string): boolean {
  return DANGEROUS_SKIP_FLAGS.includes(arg)
}

// Tokens at or after the first `--` (end-of-options marker) are positional
// data, not options — commander never parses them as flags. The index of that
// marker, or argv.length when absent.
function endOfOptions(argv: readonly string[]): number {
  const marker = argv.indexOf('--')
  return marker === -1 ? argv.length : marker
}

/**
 * True when a dangerous-skip flag appears in an option position (before any
 * `--`). A `--yolo` after `--` is a positional/prompt token — e.g.
 * `openclaude -p -- --yolo` — and must not count as the bypass flag.
 */
export function hasDangerousSkipFlag(argv: readonly string[]): boolean {
  const end = endOfOptions(argv)
  for (let i = 0; i < end; i += 1) {
    if (isDangerousSkipFlag(argv[i]!)) return true
  }
  return false
}

/**
 * Returns a copy of `argv` with every dangerous-skip token in an option
 * position removed. Tokens at or after the first `--` are preserved verbatim.
 */
export function stripDangerousSkipFlags(argv: readonly string[]): string[] {
  const end = endOfOptions(argv)
  return argv.filter((arg, i) => i >= end || !isDangerousSkipFlag(arg))
}
