import { expect, test } from 'bun:test'
import { win32 } from 'path'
import { getWindowsClaudeDesktopConfigPath } from './claudeDesktop.js'

const isWindows = process.platform === 'win32'

function restoreAppData(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.APPDATA
  } else {
    process.env.APPDATA = original
  }
}

test('getWindowsClaudeDesktopConfigPath constructs correct APPDATA path', () => {
  const result = getWindowsClaudeDesktopConfigPath('C:\\Users\\test\\AppData\\Roaming')
  expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
})

test('getWindowsClaudeDesktopConfigPath throws when APPDATA is not set', () => {
  expect(() => getWindowsClaudeDesktopConfigPath(undefined)).toThrow(
    'APPDATA environment variable is not set.',
  )
})

if (isWindows) {
  const { getClaudeDesktopConfigPath, readClaudeDesktopMcpServers } = await import('./claudeDesktop.js')

  test('getClaudeDesktopConfigPath delegates to helper when APPDATA is set', async () => {
    const original = process.env.APPDATA
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming'
    try {
      const result = await getClaudeDesktopConfigPath()
      expect(result).toBe(
        win32.join('C:\\Users\\test\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'),
      )
    } finally {
      restoreAppData(original)
    }
  })

  test('getClaudeDesktopConfigPath throws via helper when APPDATA is unset', async () => {
    const original = process.env.APPDATA
    try {
      delete process.env.APPDATA
      await expect(getClaudeDesktopConfigPath()).rejects.toThrow(
        'APPDATA environment variable is not set.',
      )
    } finally {
      restoreAppData(original)
    }
  })

  test('readClaudeDesktopMcpServers rethrows APPDATA error instead of swallowing it', async () => {
    const original = process.env.APPDATA
    try {
      delete process.env.APPDATA
      await expect(readClaudeDesktopMcpServers()).rejects.toThrow(
        'APPDATA environment variable is not set.',
      )
    } finally {
      restoreAppData(original)
    }
  })
}
