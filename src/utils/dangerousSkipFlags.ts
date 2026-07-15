/**
 * `--yolo` is registered as a native commander alias of
 * `--dangerously-skip-permissions`, so the pre-commander argv scanners in
 * main.tsx (the direct-connect `cc://` and `ssh` rewrites) and the bypass
 * safety notice must recognize either spelling. Both rewrites strip every
 * dangerous-skip token before handing the argv to the main command, so a
 * shared, tested helper is used rather than ad-hoc single-token removal
 * (which previously let a second token survive and silently re-enable bypass).
 *
 * These scanners run BEFORE commander and detect the flag by presence alone.
 * That is deliberately an approximation — fully matching commander (which can
 * consume `--yolo` as a required option value, or a `--` as a variadic value)
 * would mean re-implementing commander's option-arity state machine, the exact
 * fragile simulation this feature was reworked to delete. So the helper simply
 * mirrors the long-standing behavior of the canonical `--dangerously-skip-
 * permissions` scanning: `--yolo` and the canonical flag behave identically,
 * no better and no worse.
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
