import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractDraggedFilePaths } from './dragDropPaths.js'

describe('extractDraggedFilePaths', () => {
  // Use paths that actually exist on any system
  const thisFile = import.meta.path
  const packageJson = `${process.cwd()}/package.json`

  // Temp dir with a file whose name contains a space, for Finder-drag
  // backslash-escape tests.
  let tmpDir: string
  let spacedFile: string
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dragdrop-test-'))
    spacedFile = join(tmpDir, 'my file.txt')
    writeFileSync(spacedFile, 'test')
  })
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('detects a single absolute file path', () => {
    const result = extractDraggedFilePaths(thisFile)
    expect(result).toEqual([thisFile])
  })

  test('detects newline-separated file paths', () => {
    const result = extractDraggedFilePaths(`${thisFile}\n${packageJson}`)
    expect(result).toEqual([thisFile, packageJson])
  })

  test('detects space-separated absolute paths (Finder drag)', () => {
    const result = extractDraggedFilePaths(`${thisFile} ${packageJson}`)
    expect(result).toEqual([thisFile, packageJson])
  })

  test('returns empty for non-absolute paths', () => {
    expect(extractDraggedFilePaths('relative/path/file.ts')).toEqual([])
  })

  test('returns empty for image file paths', () => {
    expect(extractDraggedFilePaths('/Users/foo/image.png')).toEqual([])
  })

  test('returns empty for regular text', () => {
    expect(extractDraggedFilePaths('hello world this is text')).toEqual([])
  })

  test('returns empty when file does not exist', () => {
    expect(
      extractDraggedFilePaths('/definitely/nonexistent/file.ts'),
    ).toEqual([])
  })

  test('returns empty for empty string', () => {
    expect(extractDraggedFilePaths('')).toEqual([])
  })

  test('returns empty for whitespace only', () => {
    expect(extractDraggedFilePaths('   \n  ')).toEqual([])
  })

  test('returns empty if any path does not exist', () => {
    expect(
      extractDraggedFilePaths(`${thisFile}\n/nonexistent/file.ts`),
    ).toEqual([])
  })

  test('strips outer double quotes from paths', () => {
    const result = extractDraggedFilePaths(`"${thisFile}"`)
    expect(result).toEqual([thisFile])
  })

  test('strips outer single quotes from paths', () => {
    const result = extractDraggedFilePaths(`'${thisFile}'`)
    expect(result).toEqual([thisFile])
  })

  test('returns empty for a double-quoted image path', () => {
    // Regression guard: image detection must see through outer quotes so
    // quoted image drops still route to the image paste handler.
    expect(extractDraggedFilePaths('"/Users/foo/shot.png"')).toEqual([])
  })

  test('returns empty for a single-quoted image path', () => {
    expect(extractDraggedFilePaths("'/Users/foo/shot.jpg'")).toEqual([])
  })

  test('returns empty for an uppercase image extension', () => {
    expect(extractDraggedFilePaths('/Users/foo/SHOT.PNG')).toEqual([])
  })

  if (process.platform !== 'win32') {
    test('returns empty for a backslash-escaped image path', () => {
      // Finder drags escape spaces with backslashes; the image check must
      // apply after escape stripping.
      expect(
        extractDraggedFilePaths('/Users/foo/my\\ shot.png'),
      ).toEqual([])
    })

    test('resolves a backslash-escaped path to a real file on disk', () => {
      // `spacedFile` is an existing file with a space in its name; the
      // raw form matches what a terminal delivers on Finder drag.
      const escaped = spacedFile.replace(/ /g, '\\ ')
      expect(extractDraggedFilePaths(escaped)).toEqual([spacedFile])
    })
  }

  test('returns empty when mixed segments include an image file', () => {
    // All-or-nothing: one image in the group disqualifies the whole paste
    // so it can be handled by the image paste handler instead.
    expect(
      extractDraggedFilePaths(`${thisFile}\n/Users/foo/shot.png`),
    ).toEqual([])
  })

  test('returns empty for a single-quoted nonexistent path', () => {
    // Quoted but nonexistent — exists check still runs after unquoting.
    expect(extractDraggedFilePaths("'/definitely/nonexistent.ts'")).toEqual(
      [],
    )
  })

  test('trims surrounding whitespace from the whole paste', () => {
    expect(extractDraggedFilePaths(`  ${thisFile}  `)).toEqual([thisFile])
  })
})
