import { beforeEach, describe, expect, test } from 'bun:test'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import {
  DIAGNOSTIC_DELIVERY_DEBOUNCE_MS,
  getPendingLSPDiagnosticCount,
  registerPendingLSPDiagnostic,
  resetAllLSPDiagnosticState,
} from '../services/lsp/LSPDiagnosticRegistry.js'
import type { DiagnosticFile } from '../services/diagnosticTracking.js'
import {
  __test,
  extractAtMentionedFiles,
  extractMcpResourceMentions,
  shouldIncludeSkillListingAttachment,
} from './attachments.js'

function lspDiagnosticFile(message = 'stable diagnostic'): DiagnosticFile {
  return {
    uri: '/repo/a.ts',
    diagnostics: [
      {
        message,
        severity: 'Error',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        source: 'typescript',
        code: 'TS1000',
      },
    ],
  }
}

// Contract tests for the two @-mention extractors.
//
// Scope: the narrow contract between `extractAtMentionedFiles` and
// `extractMcpResourceMentions` where both are called on the same input
// and must not both claim the same token. The motivating bug is that
// `extractMcpResourceMentions`'s `\b` anchor lets it backtrack over the
// closing quote of a quoted file mention, producing a ghost match for
// `@"C:\Users\..."`. These tests pin the boundary so any regression in
// the MCP regex is caught immediately.
describe('extractor contract', () => {
  describe('extractMcpResourceMentions must return empty for', () => {
    const cases: Array<[string, string]> = [
      // Primary bug: the quoted form that PromptInput emits for Windows
      // paths today. `\b` backtracks past the trailing `"` and produces
      // a ghost MCP match on current HEAD.
      ['a quoted Windows drive-letter path', '@"C:\\Users\\me\\file.txt"'],
      // Even if the quote layer were stripped, a bare drive letter
      // followed by a path separator is never an MCP resource.
      ['an unquoted Windows drive-letter path', '@C:\\Users\\me\\file.txt'],
      // Sanity: quoted POSIX paths with no `:` at all never matched the
      // MCP regex and must keep not matching after the fix.
      ['a quoted POSIX path with a space', '@"/Users/foo/my file.ts"'],
      ['an unquoted POSIX path', '@/Users/foo/bar.ts'],
      // Quoted POSIX path that embeds a `:` in the filename — the quote
      // layer must shield it from MCP matching, same as the Windows case.
      ['a quoted POSIX path with a colon in the name', '@"/tmp/weird:name.txt"'],
    ]
    test.each(cases)('%s', (_label, input) => {
      expect(extractMcpResourceMentions(input)).toEqual([])
    })
  })

  describe('extractMcpResourceMentions still matches legitimate MCP mentions', () => {
    // Regression guard for the fix. If someone tightens the MCP regex
    // too aggressively, these break and the intent is clear.
    const cases: Array<[string, string, string[]]> = [
      [
        'a simple server:resource token',
        '@server:resource/path',
        ['server:resource/path'],
      ],
      [
        'a plugin-scoped server name with a dash',
        '@asana-plugin:project-status/123',
        ['asana-plugin:project-status/123'],
      ],
      [
        'an MCP mention inline in prose',
        'please check @server:res here',
        ['server:res'],
      ],
    ]
    test.each(cases)('%s', (_label, input, expected) => {
      expect(extractMcpResourceMentions(input)).toEqual(expected)
    })
  })

  describe('extractAtMentionedFiles extracts the file paths it should', () => {
    // Asserted separately from the MCP side: the bug is purely in the
    // MCP extractor over-matching, so these assertions are the
    // "baseline still works" half of the contract.
    const cases: Array<[string, string, string[]]> = [
      [
        'a quoted Windows drive-letter path',
        '@"C:\\Users\\me\\file.txt"',
        ['C:\\Users\\me\\file.txt'],
      ],
      [
        'a quoted POSIX path with a space',
        '@"/Users/foo/my file.ts"',
        ['/Users/foo/my file.ts'],
      ],
      ['an unquoted POSIX path', '@/Users/foo/bar.ts', ['/Users/foo/bar.ts']],
    ]
    test.each(cases)('%s', (_label, input, expected) => {
      expect(extractAtMentionedFiles(input)).toEqual(expected)
    })
  })
})

describe('skill listing attachment policy', () => {
  test.each(['extract_memories', 'session_memory', 'compact'])(
    'suppresses skill listings for %s utility forks',
    querySource => {
      expect(shouldIncludeSkillListingAttachment(querySource)).toBe(false)
    },
  )

  test.each([undefined, 'repl_main_thread', 'agent:builtin:general-purpose', 'side_question'])(
    'keeps skill listings available for %s',
    querySource => {
      expect(shouldIncludeSkillListingAttachment(querySource)).toBe(true)
    },
  )
})

describe('LSP diagnostic attachments', () => {
  beforeEach(() => {
    resetAllLSPDiagnosticState()
  })

  test('waits once for debounced diagnostics at the query boundary', async () => {
    const file = lspDiagnosticFile()
    let now = 100
    const waits: number[] = []

    registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
      timestamp: 0,
    })

    const attachments = await __test.getLSPDiagnosticAttachments(
      {
        options: {
          tools: [{ name: BASH_TOOL_NAME }],
        },
        abortController: new AbortController(),
      } as unknown as Parameters<typeof __test.getLSPDiagnosticAttachments>[0],
      {
        now: () => now,
        wait: async ms => {
          waits.push(ms)
          now += ms
        },
      },
    )

    expect(waits).toEqual([150])
    expect(attachments).toEqual([
      {
        type: 'diagnostics',
        files: [file],
        isNew: true,
      },
    ])
    expect(getPendingLSPDiagnosticCount()).toBe(0)
  })

  test('caps the query-boundary wait when the next ready delay is longer', async () => {
    const file = lspDiagnosticFile('future diagnostic')
    let now = 0
    const waits: number[] = []

    registerPendingLSPDiagnostic({
      serverName: 'typescript',
      files: [file],
      timestamp: 500,
    })

    const attachments = await __test.getLSPDiagnosticAttachments(
      {
        options: {
          tools: [{ name: BASH_TOOL_NAME }],
        },
        abortController: new AbortController(),
      } as unknown as Parameters<typeof __test.getLSPDiagnosticAttachments>[0],
      {
        now: () => now,
        wait: async ms => {
          waits.push(ms)
          now += ms
        },
      },
    )

    expect(waits).toEqual([DIAGNOSTIC_DELIVERY_DEBOUNCE_MS])
    expect(attachments).toEqual([])
    expect(getPendingLSPDiagnosticCount()).toBe(1)
  })
})
