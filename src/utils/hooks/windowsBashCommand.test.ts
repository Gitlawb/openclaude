import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWindowsBashHookCommand } from './windowsBashCommand.js'

describe('Windows bash hook commands', () => {
  test.each([
    'if [ -f ./hook.sh ]; then bash ./hook.sh; fi',
    'for script in ./hook.sh; do bash "$script"; done',
    'while false; do ./hook.sh; done',
    'case "$file" in *.sh) echo shell;; esac',
    '(bash ./hook.sh)',
    '{ bash ./hook.sh; }',
    'echo ./hook.sh',
    'echo "./hook.sh"',
    'bash ./hook.sh',
    'bash\t./hook.sh',
    'sh ./hook.sh',
    '/usr/bin/bash ./hook.sh',
    'env bash ./hook.sh',
    'SCRIPT=./hook.sh bash "$SCRIPT"',
    'node ./hook.sh.js',
    './hook.sh.backup',
    'printf "ready\\n"\n./hook.sh',
    '"${HOOK_COMMAND:-./hook.sh}" OK',
    '${HOOK_SCRIPT%.sh}',
    '#hook.sh',
    'hook.sh() { printf done; }',
    'hook.sh () { printf done; }',
  ])('preserves shell command: %s', command => {
    expect(getWindowsBashHookCommand(command)).toBe(command)
  })

  test.each([
    './hook.sh',
    './hook.sh argument',
    '  /c/work/hooks/hook.sh --check',
    '"/c/Program Files/hooks/hook.sh" argument',
    "'/c/Program Files/hooks/hook.sh' argument",
    '"$CLAUDE_PROJECT_DIR/hooks/hook.sh"',
    '${CLAUDE_PROJECT_DIR}/hooks/hook.sh',
    './hooks/my\\ hook.sh argument',
    '"./hooks/my hook".sh argument',
    './hook.sh && printf done',
    './hook.sh; printf done',
    './C#/hooks/hook.sh',
  ])('runs a directly invoked script with bash: %s', command => {
    expect(getWindowsBashHookCommand(command)).toBe(`bash ${command}`)
  })

  test.skipIf(process.platform === 'win32')(
    'executes compound hooks and non-executable script paths with real bash',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'openclaude-hook-command-'))
      try {
        await writeFile(join(directory, 'hook script.sh'), 'printf "{}\\n"\n', {
          mode: 0o600,
        })
        await writeFile(join(directory, 'C# hook.sh'), 'printf "{}\\n"\n', {
          mode: 0o600,
        })
        for (const command of [
          'if [ -f "./hook script.sh" ]; then bash "./hook script.sh"; else printf "missing\\n"; fi',
          '"./hook script.sh"',
          "'./hook script.sh'",
          './hook\\ script.sh',
          'bash "./hook script.sh"',
          './C#\\ hook.sh',
          '"${HOOK_COMMAND:-./hook.sh}" "{}"',
        ]) {
          const child = Bun.spawn(['bash', '-c', getWindowsBashHookCommand(command)], {
            cwd: directory,
            env: { ...process.env, HOOK_COMMAND: '/bin/echo' },
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const [status, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          expect({ command, status, stdout, stderr }).toEqual({
            command,
            status: 0,
            stdout: '{}\n',
            stderr: '',
          })
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
