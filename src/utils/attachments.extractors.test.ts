import { describe, expect, test } from 'bun:test'
import {
  extractAtMentionedFiles,
  extractMcpResourceMentions,
} from './attachments.js'

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
