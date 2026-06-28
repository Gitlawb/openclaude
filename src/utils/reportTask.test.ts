import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildTaskReport,
  collectTaskReportGitMetadata,
  formatTaskReportAsJson,
  type TaskReportGitMetadata,
} from './taskReport.js'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const cwd = '/workspace/openclaude'

function withTempTranscript(
  entries: Array<Record<string, unknown> | string>,
  fn: (path: string) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), 'openclaude-task-report-'))
  const file = join(dir, `${sessionId}.jsonl`)
  writeFileSync(
    file,
    entries
      .map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join('\n'),
  )

  return fn(file).finally(() => {
    rmSync(dir, { recursive: true, force: true })
  })
}

function userMessage(uuid: string, content: unknown, timestamp: string) {
  return {
    type: 'user',
    uuid,
    parentUuid: null,
    isSidechain: false,
    cwd,
    sessionId,
    timestamp,
    version: 'test',
    gitBranch: 'feat/source-branch',
    userType: 'external',
    message: {
      role: 'user',
      content,
    },
  }
}

function assistantToolMessage(
  uuid: string,
  toolUse: Record<string, unknown>,
  timestamp: string,
) {
  return {
    type: 'assistant',
    uuid,
    parentUuid: null,
    isSidechain: false,
    cwd,
    sessionId,
    timestamp,
    version: 'test',
    gitBranch: 'feat/source-branch',
    message: {
      role: 'assistant',
      id: `msg-${uuid}`,
      model: 'gpt-5-test',
      content: [
        {
          type: 'tool_use',
          ...toolUse,
        },
      ],
    },
  }
}

function toolResultMessage(
  uuid: string,
  toolUseId: string,
  content: unknown,
  timestamp: string,
  toolUseResult?: unknown,
  isError = false,
) {
  return {
    type: 'user',
    uuid,
    parentUuid: null,
    isSidechain: false,
    cwd,
    sessionId,
    timestamp,
    version: 'test',
    userType: 'external',
    sourceToolAssistantUUID: 'assistant-source',
    toolUseResult,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: isError,
        },
      ],
    },
  }
}

function gitMetadata(
  overrides: Partial<TaskReportGitMetadata> = {},
): TaskReportGitMetadata {
  return {
    status: 'available',
    cwd,
    branch: 'feat/session-task-report-json',
    head: '13cf30af',
    dirty: true,
    changedFiles: ['src/report.ts'],
    ...overrides,
  }
}

describe('task report generation', () => {
  test('uses an empty validation list and explicit warning when no validation was observed', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000001',
          'Generate a task report for issue #123.',
          '2026-06-27T08:00:00.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.schemaVersion).toBe(1)
        expect(report.session.id).toBe(sessionId)
        expect(report.session.cwd).toBe(cwd)
        expect(report.session.initialRequest).toBe(
          'Generate a task report for issue #123.',
        )
        expect(report.validations).toEqual([])
        expect(report.warnings).toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })

  test('captures passing validation commands from observed Bash results', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000002',
          'Run the checks.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000003',
          {
            id: 'tool-validation-pass',
            name: 'Bash',
            input: {
              command: 'bun run typecheck',
              description: 'Run TypeScript checks',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000004',
          'tool-validation-pass',
          'Typecheck passed',
          '2026-06-27T08:01:03.000Z',
          { stdout: 'Typecheck passed\n', stderr: '', interrupted: false },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-validation-pass',
            command: 'bun run typecheck',
            description: 'Run TypeScript checks',
            status: 'success',
          }),
        ])
        expect(report.validations).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-validation-pass',
            command: 'bun run typecheck',
            status: 'success',
          }),
        ])
        expect(report.warnings).not.toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })

  test('captures passing validation commands from observed PowerShell results', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000045',
          'Run the Windows checks.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000046',
          {
            id: 'tool-powershell-validation-pass',
            name: 'PowerShell',
            input: {
              command: 'bun run typecheck',
              description: 'Run TypeScript checks',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000047',
          'tool-powershell-validation-pass',
          'Typecheck passed',
          '2026-06-27T08:01:03.000Z',
          { stdout: 'Typecheck passed\n', stderr: '', interrupted: false },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-powershell-validation-pass',
            command: 'bun run typecheck',
            description: 'Run TypeScript checks',
            status: 'success',
          }),
        ])
        expect(report.validations).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-powershell-validation-pass',
            command: 'bun run typecheck',
            status: 'success',
          }),
        ])
        expect(report.warnings).not.toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })

  test('captures failing validation commands with exit code when it is persisted', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000005',
          'Run the failing test.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000006',
          {
            id: 'tool-validation-fail',
            name: 'Bash',
            input: {
              command: 'bun test src/utils/reportTask.test.ts',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000007',
          'tool-validation-fail',
          'Error calling tool (Bash): tests failed\nExit code 1',
          '2026-06-27T08:01:03.000Z',
          'Error calling tool (Bash): tests failed\nExit code 1',
          true,
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-validation-fail',
            command: 'bun test src/utils/reportTask.test.ts',
            status: 'error',
            exitCode: 1,
          }),
        ])
        expect(report.validations).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-validation-fail',
            command: 'bun test src/utils/reportTask.test.ts',
            status: 'error',
            exitCode: 1,
          }),
        ])
        expect(report.errors).toEqual([
          expect.objectContaining({
            source: 'tool',
            toolUseId: 'tool-validation-fail',
            toolName: 'Bash',
          }),
        ])
      },
    )
  })

  test('treats nonzero observed exit code as an error status', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000025',
          'Run a command.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000026',
          {
            id: 'tool-command-nonzero',
            name: 'Bash',
            input: {
              command: 'node missing.js',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000027',
          'tool-command-nonzero',
          'Exit code 1',
          '2026-06-27T08:01:03.000Z',
          'Exit code 1',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.toolUses).toEqual([
          expect.objectContaining({
            id: 'tool-command-nonzero',
            status: 'error',
          }),
        ])
        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-command-nonzero',
            status: 'error',
            exitCode: 1,
          }),
        ])
      },
    )
  })

  test('captures numeric structured exit codes from observed Bash results', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000028',
          'Run a structured command.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000029',
          {
            id: 'tool-command-structured-exit',
            name: 'Bash',
            input: {
              command: 'node missing.js',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000030',
          'tool-command-structured-exit',
          'No textual exit code here',
          '2026-06-27T08:01:03.000Z',
          { stdout: '', stderr: 'missing\n', exitCode: 2 },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-command-structured-exit',
            status: 'error',
            exitCode: 2,
          }),
        ])
      },
    )
  })

  test('reports backgrounded validation commands with unknown status', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000048',
          'Run tests in the background.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000049',
          {
            id: 'tool-background-validation',
            name: 'Bash',
            input: {
              command: 'bun test src/utils/reportTask.test.ts',
              run_in_background: true,
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000050',
          'tool-background-validation',
          'Command running in background with ID: bg-report-tests.',
          '2026-06-27T08:01:03.000Z',
          {
            stdout: '',
            stderr: '',
            interrupted: false,
            backgroundTaskId: 'bg-report-tests',
          },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.commands).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-background-validation',
            command: 'bun test src/utils/reportTask.test.ts',
            status: 'unknown',
          }),
        ])
        expect(report.validations).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-background-validation',
            command: 'bun test src/utils/reportTask.test.ts',
            status: 'unknown',
          }),
        ])
        expect(report.warnings).not.toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })

  test('classifies validation commands from the raw Bash command before truncation', async () => {
    const longPrefix = 'echo setup && '.repeat(20)
    const rawCommand = `${longPrefix}bun test src/utils/reportTask.test.ts`

    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000019',
          'Run the long validation command.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000020',
          {
            id: 'tool-validation-long',
            name: 'Bash',
            input: {
              command: rawCommand,
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000021',
          'tool-validation-long',
          'tests passed',
          '2026-06-27T08:01:03.000Z',
          { stdout: 'tests passed\n', stderr: '', interrupted: false },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
          maxPreviewChars: 32,
        })

        expect(report.commands[0]?.command).not.toContain('bun test')
        expect(report.validations).toEqual([
          expect.objectContaining({
            toolUseId: 'tool-validation-long',
            status: 'success',
          }),
        ])
        expect(report.warnings).not.toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })

  test('classifies validation commands inside quoted shell wrappers', async () => {
    const commands = [
      "bash -lc 'bun run check'",
      'powershell -NoProfile -Command "bun run typecheck"',
    ]

    for (const [index, command] of commands.entries()) {
      await withTempTranscript(
        [
          userMessage(
            `00000000-0000-4000-8000-${String(78 + index * 3).padStart(12, '0')}`,
            `Run ${command}.`,
            '2026-06-27T08:00:00.000Z',
          ),
          assistantToolMessage(
            `00000000-0000-4000-8000-${String(79 + index * 3).padStart(12, '0')}`,
            {
              id: `tool-wrapper-validation-${index}`,
              name: 'Bash',
              input: {
                command,
              },
            },
            '2026-06-27T08:01:00.000Z',
          ),
          toolResultMessage(
            `00000000-0000-4000-8000-${String(80 + index * 3).padStart(12, '0')}`,
            `tool-wrapper-validation-${index}`,
            'passed',
            '2026-06-27T08:01:03.000Z',
            { stdout: 'passed\n', stderr: '', exitCode: 0 },
          ),
        ],
        async transcriptPath => {
          const report = await buildTaskReport({
            transcriptPath,
            git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
          })

          expect(report.validations).toEqual([
            expect.objectContaining({
              command,
              status: 'success',
            }),
          ])
          expect(report.warnings).not.toContain(
            'No validation commands were observed in this transcript.',
          )
        },
      )
    }
  })

  test('classifies documented package checks as validations', async () => {
    const commands = [
      'bun run web:typecheck',
      'bun run web:build',
      'bun run integrations:check',
      'bun run verify:privacy',
      'bun run doctor:runtime',
      'bun run doctor:runtime:json',
      'bun run build:verified',
      'bun run hardening:check',
      'bun run hardening:strict',
    ]

    for (const [index, command] of commands.entries()) {
      await withTempTranscript(
        [
          userMessage(
            `00000000-0000-4000-8000-${String(51 + index * 3).padStart(12, '0')}`,
            `Run ${command}.`,
            '2026-06-27T08:00:00.000Z',
          ),
          assistantToolMessage(
            `00000000-0000-4000-8000-${String(52 + index * 3).padStart(12, '0')}`,
            {
              id: `tool-${command.replaceAll(/[^A-Za-z0-9]/g, '-')}`,
              name: 'Bash',
              input: {
                command,
              },
            },
            '2026-06-27T08:01:00.000Z',
          ),
          toolResultMessage(
            `00000000-0000-4000-8000-${String(53 + index * 3).padStart(12, '0')}`,
            `tool-${command.replaceAll(/[^A-Za-z0-9]/g, '-')}`,
            'passed',
            '2026-06-27T08:01:03.000Z',
            { stdout: 'passed\n', stderr: '', exitCode: 0 },
          ),
        ],
        async transcriptPath => {
          const report = await buildTaskReport({
            transcriptPath,
            git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
          })

          expect(report.validations).toEqual([
            expect.objectContaining({
              command,
              status: 'success',
            }),
          ])
          expect(report.warnings).not.toContain(
            'No validation commands were observed in this transcript.',
          )
        },
      )
    }
  })

  test('captures file changes and branch metadata when available', async () => {
    await withTempTranscript(
      [
        {
          type: 'custom-title',
          sessionId,
          customTitle: 'Generate deterministic task reports',
        },
        {
          type: 'worktree-state',
          sessionId,
          worktreeSession: {
            originalCwd: cwd,
            worktreePath: '/workspace/openclaude-report',
            worktreeName: 'openclaude-report',
            worktreeBranch: 'feat/session-task-report-json',
            originalBranch: 'main',
            originalHeadCommit: '13cf30af',
            sessionId,
          },
        },
        {
          type: 'pr-link',
          sessionId,
          prNumber: 456,
          prUrl: 'https://github.com/Gitlawb/openclaude/pull/456',
          prRepository: 'Gitlawb/openclaude',
          timestamp: '2026-06-27T08:01:00.000Z',
        },
        userMessage(
          '00000000-0000-4000-8000-000000000008',
          'Update src/report.ts for https://github.com/Gitlawb/openclaude/issues/123.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000009',
          {
            id: 'tool-edit',
            name: 'Edit',
            input: {
              file_path: `${cwd}/src/report.ts`,
              old_string: 'old',
              new_string: 'new',
            },
          },
          '2026-06-27T08:02:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000010',
          'tool-edit',
          'Updated src/report.ts',
          '2026-06-27T08:02:02.000Z',
          { filePath: `${cwd}/src/report.ts` },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () =>
            gitMetadata({
              changedFiles: ['src/report.ts', 'src/report.test.ts'],
            }),
        })

        expect(report.session.name).toBe('Generate deterministic task reports')
        expect(report.branch.transcriptBranch).toBe('feat/source-branch')
        expect(report.branch.worktree).toEqual(
          expect.objectContaining({
            branch: 'feat/session-task-report-json',
            originalBranch: 'main',
            originalHead: '13cf30af',
          }),
        )
        expect(report.branch.pullRequest).toEqual({
          number: 456,
          repository: 'Gitlawb/openclaude',
          url: 'https://github.com/Gitlawb/openclaude/pull/456',
        })
        expect(report.git).toEqual(
          expect.objectContaining({
            status: 'available',
            branch: 'feat/session-task-report-json',
            head: '13cf30af',
            dirty: true,
            changedFiles: ['src/report.test.ts', 'src/report.ts'],
          }),
        )
        expect(report.changedFiles).toEqual([
          { path: 'src/report.test.ts', sources: ['git'] },
          { path: 'src/report.ts', sources: ['git', 'tool'] },
        ])
        expect(report.linkedReferences).toEqual([
          {
            kind: 'issue',
            number: 123,
            repository: 'Gitlawb/openclaude',
            url: 'https://github.com/Gitlawb/openclaude/issues/123',
          },
          {
            kind: 'pull_request',
            number: 456,
            repository: 'Gitlawb/openclaude',
            url: 'https://github.com/Gitlawb/openclaude/pull/456',
          },
        ])
      },
    )
  })

  test('normalizes in-repo paths whose relative path starts with dots', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000037',
          'Update a dot-prefixed fixture path.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000038',
          {
            id: 'tool-dot-fixture',
            name: 'Edit',
            input: {
              file_path: `${cwd}/..fixtures/report.ts`,
              old_string: 'old',
              new_string: 'new',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000039',
          'tool-dot-fixture',
          'Updated fixture',
          '2026-06-27T08:01:02.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.changedFiles).toEqual([
          { path: '..fixtures/report.ts', sources: ['tool'] },
        ])
      },
    )
  })

  test('normalizes Windows-style tool paths before merging with git paths', async () => {
    const windowsCwd = 'C:\\workspace\\openclaude'

    await withTempTranscript(
      [
        {
          ...userMessage(
            '00000000-0000-4000-8000-000000000040',
            'Update Windows paths.',
            '2026-06-27T08:00:00.000Z',
          ),
          cwd: windowsCwd,
        },
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000041',
          {
            id: 'tool-windows-path',
            name: 'Edit',
            input: {
              file_path: 'C:\\workspace\\openclaude\\src\\report.ts',
              old_string: 'old',
              new_string: 'new',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000042',
          'tool-windows-path',
          'Updated report',
          '2026-06-27T08:01:02.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000043',
          {
            id: 'tool-windows-dot-path',
            name: 'Edit',
            input: {
              file_path: 'C:\\workspace\\openclaude\\..fixtures\\report.ts',
              old_string: 'old',
              new_string: 'new',
            },
          },
          '2026-06-27T08:02:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000044',
          'tool-windows-dot-path',
          'Updated fixture',
          '2026-06-27T08:02:02.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () =>
            gitMetadata({
              cwd: windowsCwd,
              changedFiles: ['src/report.ts'],
            }),
        })

        expect(report.changedFiles).toEqual([
          { path: '..fixtures/report.ts', sources: ['tool'] },
          { path: 'src/report.ts', sources: ['git', 'tool'] },
        ])
      },
    )
  })

  test('prefers transcript cwd over caller cwd for git metadata', async () => {
    const callerCwd = '/workspace/different-project'
    const observedGitCwds: string[] = []

    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000015',
          'Report the session.',
          '2026-06-27T08:00:00.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          cwd: callerCwd,
          git: async gitCwd => {
            observedGitCwds.push(gitCwd)
            return gitMetadata({
              cwd: gitCwd,
              branch: 'feat/session-cwd',
              dirty: false,
              changedFiles: [],
            })
          },
        })

        expect(observedGitCwds).toEqual([cwd])
        expect(report.git).toEqual(
          expect.objectContaining({
            cwd,
            branch: 'feat/session-cwd',
            dirty: false,
          }),
        )
      },
    )
  })

  test('does not serialize file read result content in tool summaries', async () => {
    const fileBody = 'PRIVATE_FILE_BODY_SHOULD_NOT_APPEAR'

    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000016',
          'Inspect a file.',
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000017',
          {
            id: 'tool-read',
            name: 'Read',
            input: {
              file_path: 'src/secret.ts',
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000018',
          'tool-read',
          fileBody,
          '2026-06-27T08:01:01.000Z',
          { filePath: 'src/secret.ts', content: fileBody },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })
        const serialized = formatTaskReportAsJson(report)

        expect(serialized).not.toContain(fileBody)
        expect(report.toolUses).toEqual([
          expect.objectContaining({
            id: 'tool-read',
            name: 'Read',
            files: ['src/secret.ts'],
          }),
        ])
        expect(report.toolUses[0]).not.toHaveProperty('resultSummary')
      },
    )
  })

  test('does not collect linked references from tool result content', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000022',
          'Summarize the session.',
          '2026-06-27T08:00:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000023',
          'tool-read',
          'File body mentions https://github.com/Gitlawb/openclaude/issues/999.',
          '2026-06-27T08:01:01.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
        })

        expect(report.linkedReferences).toEqual([])
      },
    )
  })

  test('redacts credential-shaped strings and truncates large outputs deterministically', async () => {
    const secret = 'sk-ant-secret-token'
    const longOutput = `${'x'.repeat(200)} ${secret}`

    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000011',
          `Please use token ghp_1234567890abcdef to test redaction.`,
          '2026-06-27T08:00:00.000Z',
        ),
        assistantToolMessage(
          '00000000-0000-4000-8000-000000000012',
          {
            id: 'tool-secret',
            name: 'Bash',
            input: {
              command: `curl -H "Authorization: Bearer ${secret}" https://example.test`,
            },
          },
          '2026-06-27T08:01:00.000Z',
        ),
        toolResultMessage(
          '00000000-0000-4000-8000-000000000013',
          'tool-secret',
          longOutput,
          '2026-06-27T08:01:01.000Z',
          { stdout: longOutput, stderr: '', interrupted: false },
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => gitMetadata({ dirty: false, changedFiles: [] }),
          maxPreviewChars: 64,
        })
        const serialized = formatTaskReportAsJson(report)

        expect(report.redaction).toEqual({
          mode: 'best_effort',
          maxPreviewChars: 64,
        })
        expect(serialized).toBe(formatTaskReportAsJson(report))
        expect(serialized.endsWith('\n')).toBe(false)
        expect(serialized).not.toContain(secret)
        expect(serialized).not.toContain('ghp_1234567890abcdef')
        expect(serialized).toContain('[redacted]')
        expect(report.commands[0]?.stdout?.preview.length).toBeLessThanOrEqual(
          64,
        )
        expect(report.commands[0]?.stdout?.truncated).toBe(true)
      },
    )
  })

  test('normalizes max preview chars in report metadata', async () => {
    await withTempTranscript(
      [
        userMessage(
          '00000000-0000-4000-8000-000000000024',
          'abcdef',
          '2026-06-27T08:00:00.000Z',
        ),
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: false,
          maxPreviewChars: 0,
        })

        expect(report.redaction.maxPreviewChars).toBe(1)
        expect(report.session.initialRequest).toBe('a')
      },
    )
  })

  test('omits dirty status when git status cannot be collected', async () => {
    const repoDir = join(homedir(), 'openclaude-task-report-git-repo')
    const calls: string[] = []

    const metadata = await collectTaskReportGitMetadata(
      repoDir,
      async (gitCwd, args) => {
        expect(gitCwd).toBe(repoDir)
        const command = args.join(' ')
        calls.push(command)

        switch (command) {
          case '--no-optional-locks rev-parse --is-inside-work-tree':
            return { stdout: 'true', stderr: '', code: 0 }
          case '--no-optional-locks branch --show-current':
            return { stdout: 'feat/report', stderr: '', code: 0 }
          case '--no-optional-locks rev-parse --short=12 HEAD':
            return { stdout: '13cf30afa469', stderr: '', code: 0 }
          case '--no-optional-locks status --porcelain=v1':
            return { stdout: '', stderr: 'status failed', code: 1 }
          default:
            return {
              stdout: '',
              stderr: `unexpected command: ${command}`,
              code: 2,
            }
        }
      }
    )

    expect(calls).toEqual(
      expect.arrayContaining([
        '--no-optional-locks rev-parse --is-inside-work-tree',
        '--no-optional-locks branch --show-current',
        '--no-optional-locks rev-parse --short=12 HEAD',
        '--no-optional-locks status --porcelain=v1',
      ]),
    )
    expect(metadata).toEqual({
      status: 'available',
      cwd: join('~', 'openclaude-task-report-git-repo'),
      branch: 'feat/report',
      head: '13cf30afa469',
      changedFiles: [],
      error: 'status failed',
    })
    expect(metadata).not.toHaveProperty('dirty')
  })

  test('degrades gracefully for malformed and old transcripts', async () => {
    await withTempTranscript(
      [
        '{not valid json',
        {
          type: 'summary',
          leafUuid: '00000000-0000-4000-8000-000000000014',
          summary: 'old transcript metadata',
        },
      ],
      async transcriptPath => {
        const report = await buildTaskReport({
          transcriptPath,
          git: async () => ({
            status: 'unavailable',
            cwd,
            changedFiles: [],
            error: 'not a git repository',
          }),
        })

        expect(report.session.id).toBe(sessionId)
        expect(report.toolUses).toEqual([])
        expect(report.commands).toEqual([])
        expect(report.warnings).toContain(
          'Skipped 1 malformed transcript line.',
        )
        expect(report.warnings).toContain(
          'No validation commands were observed in this transcript.',
        )
      },
    )
  })
})
