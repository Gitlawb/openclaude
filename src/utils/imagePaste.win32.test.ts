import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type ImagePasteModule = typeof import('./imagePaste.js')
type ExecFileModule = typeof import('./execFileNoThrow.js')
type ExecaModule = typeof import('execa')
type ImageResizerModule = typeof import('./imageResizer.js')
type ExecaCall = [string, ...unknown[]]

const originalPlatform = process.platform
const originalTemp = process.env.TEMP
const originalClaudeCodeTmpdir = process.env.CLAUDE_CODE_TMPDIR

let actualExecFileModule: ExecFileModule | undefined
let actualExecaModule: ExecaModule | undefined
let actualImageResizerModule: ImageResizerModule | undefined
let tempDirs: string[] = []

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
  })
}

async function restoreMocks(): Promise<void> {
  actualExecFileModule ??= await import(
    `./execFileNoThrow.js?actual=${Date.now()}-${Math.random()}`
  )
  actualExecaModule ??= await import(
    `execa?actual=${Date.now()}-${Math.random()}`
  )
  actualImageResizerModule ??= await import(
    `./imageResizer.js?actual=${Date.now()}-${Math.random()}`
  )
  mock.module('./execFileNoThrow.js', () => actualExecFileModule!)
  mock.module('execa', () => actualExecaModule!)
  mock.module('./imageResizer.js', () => actualImageResizerModule!)
}

async function importImagePaste(): Promise<ImagePasteModule> {
  return import(`./imagePaste.js?win32=${Date.now()}-${Math.random()}`)
}

afterEach(async () => {
  setPlatform(originalPlatform)
  if (originalTemp === undefined) {
    delete process.env.TEMP
  } else {
    process.env.TEMP = originalTemp
  }
  if (originalClaudeCodeTmpdir === undefined) {
    delete process.env.CLAUDE_CODE_TMPDIR
  } else {
    process.env.CLAUDE_CODE_TMPDIR = originalClaudeCodeTmpdir
  }
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true })
  }
  tempDirs = []
  await restoreMocks()
  mock.restore()
})

describe('Windows clipboard image handling', () => {
  test('hasImageInClipboard maps PowerShell True and False stdout', async () => {
    setPlatform('win32')
    const execFileNoThrowWithCwd = mock(async () => ({
      code: 0,
      stdout: 'True\r\n',
      stderr: '',
    }))
    mock.module('./execFileNoThrow.js', () => ({
      execFileNoThrowWithCwd,
    }))

    let imagePaste = await importImagePaste()
    expect(await imagePaste.hasImageInClipboard()).toBe(true)
    expect(execFileNoThrowWithCwd).toHaveBeenCalledWith('powershell', [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::ContainsImage()',
    ])

    execFileNoThrowWithCwd.mockResolvedValueOnce({
      code: 0,
      stdout: 'False\r\n',
      stderr: '',
    })
    imagePaste = await importImagePaste()
    expect(await imagePaste.hasImageInClipboard()).toBe(false)
  })

  test('getImageFromClipboard returns null before saving when Windows reports no image', async () => {
    setPlatform('win32')
    const execa = mock(async () => ({
      exitCode: 0,
      stdout: 'False\r\n',
      stderr: '',
    }))
    mock.module('execa', () => ({ execa }))

    const { getImageFromClipboard } = await importImagePaste()

    expect(await getImageFromClipboard()).toBeNull()
    expect(execa).toHaveBeenCalledTimes(1)
    const checkCall = execa.mock.calls[0] as unknown as ExecaCall | undefined
    expect(checkCall?.[0]).toContain('Clipboard]::ContainsImage()')
  })

  test('getImageFromClipboard keeps Windows backslashes and escapes apostrophes in the save path', async () => {
    setPlatform('win32')
    process.env.TEMP = "C:\\Temp\\O'Brien"
    const execa = mock(async () => ({
      exitCode: 0,
      stdout: 'True\r\n',
      stderr: '',
    }))
    execa.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'True\r\n',
      stderr: '',
    })
    execa.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    })
    mock.module('execa', () => ({ execa }))

    const { getImageFromClipboard } = await importImagePaste()

    expect(await getImageFromClipboard()).toBeNull()
    const saveCall = execa.mock.calls[1] as unknown as ExecaCall | undefined
    const saveCommand = String(saveCall?.[0] ?? '')
    expect(saveCommand).toContain("C:\\Temp\\O''Brien")
    expect(saveCommand).not.toContain('C:\\\\Temp')
    expect(saveCommand).toContain(
      '[System.Windows.Forms.Clipboard]::GetImage()',
    )
  })

  test('getImageFromClipboard returns image data when Windows check and save succeed', async () => {
    setPlatform('win32')
    const tempDir = mkdtempSync(join(tmpdir(), 'openclaude-image-paste-'))
    tempDirs.push(tempDir)
    process.env.CLAUDE_CODE_TMPDIR = tempDir
    const screenshotPath = join(tempDir, 'claude_cli_latest_screenshot.png')
    const imageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const execa = mock(async (command: string) => {
      if (command.includes('Clipboard]::GetImage()')) {
        writeFileSync(screenshotPath, imageBuffer)
      }
      return {
        exitCode: 0,
        stdout: 'True\r\n',
        stderr: '',
      }
    })

    actualImageResizerModule ??= await import(
      `./imageResizer.js?actual=${Date.now()}-${Math.random()}`
    )
    const maybeResizeAndDownsampleImageBuffer = mock(async () => ({
      buffer: imageBuffer,
      mediaType: 'png',
      dimensions: {
        originalWidth: 1,
        originalHeight: 1,
        displayWidth: 1,
        displayHeight: 1,
      },
    }))
    mock.module('execa', () => ({ execa }))
    mock.module('./imageResizer.js', () => ({
      ...actualImageResizerModule!,
      maybeResizeAndDownsampleImageBuffer,
    }))

    const { getImageFromClipboard } = await importImagePaste()

    const image = await getImageFromClipboard()
    expect(image?.base64).toEqual(expect.any(String))
    expect(image?.mediaType).toBe('image/png')
    expect(image?.dimensions).toEqual({
      originalWidth: 1,
      originalHeight: 1,
      displayWidth: 1,
      displayHeight: 1,
    })
    expect(maybeResizeAndDownsampleImageBuffer).toHaveBeenCalledWith(
      imageBuffer,
      imageBuffer.length,
      'png',
    )
    expect(image?.base64.length).toBeGreaterThan(0)
    expect(execa).toHaveBeenCalledTimes(3)
    const saveCall = execa.mock.calls[1] as unknown as ExecaCall | undefined
    expect(String(saveCall?.[0] ?? '')).toContain(screenshotPath)
    const deleteCall = execa.mock.calls[2] as unknown as ExecaCall | undefined
    expect(deleteCall?.[0]).toContain('del /f')
  })
})
