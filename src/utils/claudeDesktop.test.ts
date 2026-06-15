import { expect, test } from 'bun:test'
import { win32 } from 'path'

const isWindows = process.platform === 'win32'

function restoreAppData(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.APPDATA
  } else {
    process.env.APPDATA = original
  }
}

test('win32.join constructs correct Windows APPDATA path for Claude Desktop config', () => {
  const appData = 'C:\\Users\\test\\AppData\\Roaming'
  const result = win32.join(appData, 'Claude', 'claude_desktop_config.json')
  expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
})

if (isWindows) {
  const { getClaudeDesktopConfigPath, readClaudeDesktopMcpServers } = await import('./claudeDesktop.js')

  test('getClaudeDesktopConfigPath returns APPDATA path on Windows when APPDATA is set', async () => {
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

  test('getClaudeDesktopConfigPath throws when APPDATA is unset on Windows', async () => {
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
