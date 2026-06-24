import { describe, expect, it } from 'bun:test'
import { parseGitDiff } from './gitDiff.js'

describe('parseGitDiff', () => {
  it('keeps hunk content lines whose text starts with -- or ++', () => {
    // A removed line whose content is "--legacy-peer-deps" appears in the diff
    // as "---legacy-peer-deps"; an added line "++quiet-flag" appears as
    // "+++quiet-flag". Both must be retained as hunk content, not mistaken for
    // the "---"/"+++" file-header lines.
    const diff = [
      'diff --git a/run.sh b/run.sh',
      'index abc1234..def5678 100644',
      '--- a/run.sh',
      '+++ b/run.sh',
      '@@ -1,3 +1,3 @@',
      ' npm install \\',
      '---legacy-peer-deps',
      '+++quiet-flag',
      ' echo done',
      '',
    ].join('\n')

    const hunks = parseGitDiff(diff).get('run.sh')
    expect(hunks).toBeDefined()
    const lines = hunks![0]!.lines
    expect(lines).toContain('---legacy-peer-deps')
    expect(lines).toContain('+++quiet-flag')
    expect(lines).toContain(' npm install \\')
    expect(lines).toContain(' echo done')
  })

  it('still drops the file-header --- / +++ / index lines from hunk content', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1111111..2222222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')

    const lines = parseGitDiff(diff).get('a.txt')![0]!.lines
    expect(lines).toContain('-old')
    expect(lines).toContain('+new')
    expect(lines).not.toContain('--- a/a.txt')
    expect(lines).not.toContain('+++ b/a.txt')
    expect(lines).not.toContain('index 1111111..2222222 100644')
  })

  it('parses a normal hunk with added, removed and context lines', () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      'index 1111111..2222222 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      ' const c = 4',
      '',
    ].join('\n')

    const hunks = parseGitDiff(diff).get('src/x.ts')
    expect(hunks).toBeDefined()
    expect(hunks![0]!.oldStart).toBe(1)
    expect(hunks![0]!.newStart).toBe(1)
    const lines = hunks![0]!.lines
    expect(lines).toContain('-const b = 2')
    expect(lines).toContain('+const b = 3')
    expect(lines).toContain(' const a = 1')
  })
})
