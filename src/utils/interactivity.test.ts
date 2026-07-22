import { expect, test, describe } from 'bun:test'
import { isInteractiveSession } from './interactivity.js'

describe('isInteractiveSession', () => {
  test('returns true when stdout is TTY', () => {
    expect(
      isInteractiveSession({
        stdoutIsTTY: true,
        args: [],
        env: {},
      }),
    ).toBe(true)
  })

  test('returns false when stdout is not TTY and no SSH env vars', () => {
    expect(
      isInteractiveSession({
        stdoutIsTTY: false,
        args: [],
        env: {},
      }),
    ).toBe(false)
  })

  test('returns true when in SSH session even if stdout is not TTY (SSH_TTY)', () => {
    expect(
      isInteractiveSession({
        stdoutIsTTY: false,
        args: [],
        env: { SSH_TTY: '/dev/pts/0' },
      }),
    ).toBe(true)
  })

  test('returns false when in SSH session without TTY allocation (SSH_CONNECTION only)', () => {
    // Regression test for piped-stdin-over-ssh case
    expect(
      isInteractiveSession({
        stdoutIsTTY: false,
        args: [],
        env: { SSH_CONNECTION: '192.168.1.1 56789 192.168.1.100 22' },
      }),
    ).toBe(false)
  })

  test('returns false when explicit non-interactive flags are present even with SSH', () => {
    expect(
      isInteractiveSession({
        stdoutIsTTY: true,
        args: ['-p'],
        env: { SSH_TTY: '/dev/pts/0' },
      }),
    ).toBe(false)

    expect(
      isInteractiveSession({
        stdoutIsTTY: true,
        args: ['--print'],
        env: { SSH_TTY: '/dev/pts/0' },
      }),
    ).toBe(false)

    expect(
      isInteractiveSession({
        stdoutIsTTY: true,
        args: ['--init-only'],
        env: { SSH_TTY: '/dev/pts/0' },
      }),
    ).toBe(false)

    expect(
      isInteractiveSession({
        stdoutIsTTY: true,
        args: ['--sdk-url=ws://localhost'],
        env: { SSH_TTY: '/dev/pts/0' },
      }),
    ).toBe(false)
  })
})

describe('isInteractiveSession — post-`--` print positional (PR #1939 review P1)', () => {
  test('stays interactive for the argv the ssh rewrite produces', () => {
    // `openclaude ssh host -- --print` is deliberately NOT headless; the ssh
    // flow rewrites argv to ['--','--print']. A token scan saw `--print` and
    // classified the session non-interactive, so the main action took the
    // headless branch instead of the SSH REPL branch.
    const base = { stdoutIsTTY: true, env: {} as NodeJS.ProcessEnv }
    expect(isInteractiveSession({ ...base, args: ['--', '--print'] })).toBe(true)
    expect(isInteractiveSession({ ...base, args: ['--', '-p'] })).toBe(true)

    // …while genuine print requests stay non-interactive, bundled shorts too.
    expect(isInteractiveSession({ ...base, args: ['--print'] })).toBe(false)
    expect(isInteractiveSession({ ...base, args: ['-p'] })).toBe(false)
    expect(isInteractiveSession({ ...base, args: ['-pv'] })).toBe(false)
  })

  test('the same holds for --init-only and --sdk-url', () => {
    // These were still raw token scans after the --print migration, so the same
    // rewritten argv misclassified the session. One commander parse now resolves
    // all three together.
    const base = { stdoutIsTTY: true, env: {} as NodeJS.ProcessEnv }
    expect(isInteractiveSession({ ...base, args: ['--', '--init-only'] })).toBe(true)
    expect(isInteractiveSession({ ...base, args: ['--', '--sdk-url', 'x'] })).toBe(true)

    expect(isInteractiveSession({ ...base, args: ['--init-only'] })).toBe(false)
    expect(isInteractiveSession({ ...base, args: ['--sdk-url', 'x'] })).toBe(false)
    // `=` form, which the old startsWith() scan caught and commander also does
    expect(isInteractiveSession({ ...base, args: ['--sdk-url=x'] })).toBe(false)
  })
})
