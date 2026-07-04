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

  test('path containing space-dash before args', () => {
    expect(
      formatShellPrefixCommand('/opt/shell -x64/bin/bash -l -c', 'echo hi'),
    ).toBe("'/opt/shell -x64/bin/bash' -l -c 'echo hi'")
  })

  test('executable basename containing space-dash with single flag', () => {
    expect(formatShellPrefixCommand('/opt/my -shell -c', 'echo hi')).toBe(
      "'/opt/my -shell' -c 'echo hi'",
    )
  })

  test('windows path containing space-dash before args', () => {
    expect(
      formatShellPrefixCommand(
        'C:\\Program Files - x64\\Git\\bin\\bash.exe -l -c',
        'echo hi',
      ),
    ).toBe("'C:\\Program Files - x64\\Git\\bin\\bash.exe' -l -c 'echo hi'")
  })

  test('windows executable basename containing space-dash with single flag', () => {
    expect(
      formatShellPrefixCommand('C:\\Tools\\my -shell.exe -c', 'echo hi'),
    ).toBe("'C:\\Tools\\my -shell.exe' -c 'echo hi'")
  })

  test('path with long double-dash flag still splits before args', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash --login -c', 'echo hi')).toBe(
      "/usr/bin/bash --login -c 'echo hi'",
    )
  })

  test('known shell path with long single-dash flags still splits before args', () => {
    expect(
      formatShellPrefixCommand(
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe -NoProfile -Command',
        'echo hi',
      ),
    ).toBe(
      "'C:\\Program Files\\PowerShell\\7\\pwsh.exe' -NoProfile -Command 'echo hi'",
    )
  })

  test('prefix with no dash flags returns prefix then quoted command', () => {
    expect(formatShellPrefixCommand('/usr/bin/bash', 'echo hi')).toBe(
      "/usr/bin/bash 'echo hi'",
    )
  })
})
