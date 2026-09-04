import { describe, expect, test } from 'bun:test'
import { prepareWindowsBashHookCommand } from './hooks.js'

describe('Windows bash hook commands', () => {
  test('prepends bash only for direct shell-script invocations', () => {
    expect(prepareWindowsBashHookCommand('./hooks/check.sh')).toBe(
      'bash ./hooks/check.sh',
    )
    expect(
      prepareWindowsBashHookCommand('"/c/Program Files/hooks/check.sh" --quiet'),
    ).toBe('bash "/c/Program Files/hooks/check.sh" --quiet')
    expect(prepareWindowsBashHookCommand("'./hooks/check.sh' --quiet")).toBe(
      "bash './hooks/check.sh' --quiet",
    )
    expect(prepareWindowsBashHookCommand('./hooks/my\\ check.sh')).toBe(
      'bash ./hooks/my\\ check.sh',
    )

    expect(prepareWindowsBashHookCommand('bash ./hooks/check.sh')).toBe(
      'bash ./hooks/check.sh',
    )
    expect(prepareWindowsBashHookCommand('sh ./hooks/check.sh')).toBe(
      'sh ./hooks/check.sh',
    )
    expect(
      prepareWindowsBashHookCommand(
        'if [ -f "/c/hooks/check.sh" ]; then /bin/sh "/c/hooks/check.sh"; fi',
      ),
    ).toBe(
      'if [ -f "/c/hooks/check.sh" ]; then /bin/sh "/c/hooks/check.sh"; fi',
    )
    expect(prepareWindowsBashHookCommand('env DEBUG=1 ./hooks/check.sh')).toBe(
      'env DEBUG=1 ./hooks/check.sh',
    )
  })
})
