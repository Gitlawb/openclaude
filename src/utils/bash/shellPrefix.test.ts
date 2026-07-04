import { describe, expect, test } from 'bun:test'
import { formatShellPrefixCommand } from './shellPrefix.js'

describe('formatShellPrefixCommand', () => {
  test('bare executable with no args', () => {
    expect(formatShellPrefixCommand('bash', 'echo hi')).toBe("bash 'echo hi'")
  })

  test('single flag prefix', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash -c', 'echo hi')).toBe(
      "/usr/bin/bash -c 'echo hi'",
    )
  })

  test('multi-flag prefix (issue #1849)', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash -l -c', 'echo hi')).toBe(
      "/usr/bin/bash -l -c 'echo hi'",
    )
  })

  test('pwsh with multiple flags', () => {
    expect(
      formatShellPrefixCommand('pwsh -NoProfile -Command', 'echo hi'),
    ).toBe("pwsh -NoProfile -Command 'echo hi'")
  })

  test('windows path with spaces and flag', () => {
    expect(
      formatShellPrefixCommand(
        'C:\\Program Files\\Git\\bin\\bash.exe -c',
        'echo hi',
      ),
    ).toBe("'C:\\Program Files\\Git\\bin\\bash.exe' -c 'echo hi'")
  })

  test('windows path with spaces and multiple flags', () => {
    expect(
      formatShellPrefixCommand(
        'C:\\Program Files\\Git\\bin\\bash.exe -l -c',
        'echo hi',
      ),
    ).toBe("'C:\\Program Files\\Git\\bin\\bash.exe' -l -c 'echo hi'")
  })

  test('prefix with no dash flags returns prefix then quoted command', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash', 'echo hi')).toBe(
      "/usr/bin/bash 'echo hi'",
    )
  })
})
