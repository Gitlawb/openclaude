import { describe, expect, it } from 'bun:test'
import { parseGitDiff } from './gitDiff.js'

// Regression for #1645 — parseGitDiff dropped in-hunk content lines whose text
// starts with `--` or `++`. A removed source line `--legacy-peer-deps` appears
// in the unified diff as `---legacy-peer-deps`, and an added source line
// `++count` appears as `+++count`. The metadata-skip block (meant only for the
// per-file header: `--- a/file`, `+++ b/file`, `index ...`) ran for every line,
// so those real changes were silently discarded.

describe('parseGitDiff (#1645)', () => {
  it('keeps a removed line whose content starts with --', () => {
    const diff = [
      'diff --git a/install.sh b/install.sh',
      'index 1111111..2222222 100644',
      '--- a/install.sh',
      '+++ b/install.sh',
      '@@ -1,3 +1,3 @@',
      ' npm install \\',
      '---legacy-peer-deps',
      '+--legacy-peer-deps --force',
      ' echo done',
      '',
    ].join('\n')

    const hunks = parseGitDiff(diff).get('install.sh')
    expect(hunks).toBeDefined()
    const lines = hunks!.flatMap(h => h.lines)
    expect(lines).toContain('---legacy-peer-deps')
    expect(lines).toContain('+--legacy-peer-deps --force')
  })

  it('keeps an added line whose content starts with ++', () => {
    const diff = [
      'diff --git a/counter.c b/counter.c',
      'index 3333333..4444444 100644',
      '--- a/counter.c',
      '+++ b/counter.c',
      '@@ -1,2 +1,2 @@',
      ' int main() {',
      '-  count++;',
      '+++count;',
      '',
    ].join('\n')

    const hunks = parseGitDiff(diff).get('counter.c')
    expect(hunks).toBeDefined()
    const lines = hunks!.flatMap(h => h.lines)
    expect(lines).toContain('+++count;')
    expect(lines).toContain('-  count++;')
  })

  it('still strips the per-file header lines (--- / +++ / index) from hunks', () => {
    const diff = [
      'diff --git a/file.txt b/file.txt',
      'index 5555555..6666666 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')

    const hunks = parseGitDiff(diff).get('file.txt')
    expect(hunks).toBeDefined()
    const lines = hunks!.flatMap(h => h.lines)
    // Header lines must not leak into hunk content.
    expect(lines).not.toContain('--- a/file.txt')
    expect(lines).not.toContain('+++ b/file.txt')
    expect(lines).not.toContain('index 5555555..6666666 100644')
    expect(lines.filter(line => line !== '')).toEqual(['-old', '+new'])
  })
})
