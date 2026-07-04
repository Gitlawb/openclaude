import { afterEach, describe, expect, mock, test } from 'bun:test'

type ImagePasteModule = typeof import('./imagePaste.js')
type ExecFileModule = typeof import('./execFileNoThrow.js')
type ExecaModule = typeof import('execa')
type ExecaCall = [string, ...unknown[]]

const originalPlatform = process.platform
const originalTemp = process.env.TEMP

let actualExecFileModule: ExecFileModule | undefined
let actualExecaModule: ExecaModule | undefined

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
  mock.module('./execFileNoThrow.js', () => actualExecFileModule!)
  mock.module('execa', () => actualExecaModule!)
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
})
