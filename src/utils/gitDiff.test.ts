import { describe, expect, it } from 'bun:test'
import { parseGitDiff, parseRawDiffToToolUseDiff } from './gitDiff.js'

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

  it('skips a file whose diff exceeds the 1MB cap in bytes, not UTF-16 units', () => {
    // A per-file diff that is under the cap in UTF-16 code units but well over
    // it in real UTF-8 bytes (each `一` is 1 code unit but 3 bytes). Before the
    // fix the char-length check let this multi-MB diff through.
    const cjkLine = '+' + '一'.repeat(100)
    const body = ['a/big.txt b/big.txt', '@@ -1,1 +1,5000 @@']
    for (let i = 0; i < 5000; i++) body.push(cjkLine)
    const fileChunk = body.join('\n')
    const stdout = 'diff --git ' + fileChunk

    expect(fileChunk.length).toBeLessThan(1_000_000)
    expect(Buffer.byteLength(fileChunk, 'utf8')).toBeGreaterThan(1_000_000)

    expect(parseGitDiff(stdout).has('big.txt')).toBe(false)
  })
})

describe('parseRawDiffToToolUseDiff', () => {
  it('counts hunk content lines whose text starts with -- or ++', () => {
    // Same class as the parseGitDiff regression above: a removed line whose
    // content is "--legacy-peer-deps" shows as "---legacy-peer-deps", and an
    // added line "++quiet-flag" shows as "+++quiet-flag". The `+++`/`---`
    // file-header lines only appear before the first @@, so guarding on them
    // inside a hunk dropped these real additions/deletions from the counts.
    const raw = [
      '--- a/run.sh',
      '+++ b/run.sh',
      '@@ -1,2 +1,2 @@',
      '-npm install',
      '---legacy-peer-deps',
      '+npm ci',
      '+++quiet-flag',
    ].join('\n')

    const diff = parseRawDiffToToolUseDiff('run.sh', raw, 'modified')
    expect(diff.additions).toBe(2)
    expect(diff.deletions).toBe(2)
    expect(diff.changes).toBe(4)
    // The header lines before the first @@ are not part of the counted hunk.
    expect(diff.patch).toContain('---legacy-peer-deps')
    expect(diff.patch).toContain('+++quiet-flag')
    expect(diff.patch.startsWith('@@')).toBe(true)
  })

  it('counts a plain modification without over/under-counting', () => {
    const raw = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '-const b = 2',
      '+const b = 3',
    ].join('\n')
    const diff = parseRawDiffToToolUseDiff('a.ts', raw, 'modified')
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    expect(diff.changes).toBe(2)
  })
})
