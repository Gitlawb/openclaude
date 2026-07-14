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

export function hasDangerousSkipFlag(argv: readonly string[]): boolean {
  return argv.some(isDangerousSkipFlag)
}

/** Returns a copy of `argv` with every dangerous-skip token removed. */
export function stripDangerousSkipFlags(argv: readonly string[]): string[] {
  return argv.filter(arg => !isDangerousSkipFlag(arg))
}
