import { expect, test, describe } from 'bun:test'
import { extractDraggedFilePaths } from './dragDropPaths.js'

describe('extractDraggedFilePaths', () => {
  // Use paths that actually exist on any system
  const thisFile = import.meta.path
  const packageJson = `${process.cwd()}/package.json`

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
})
