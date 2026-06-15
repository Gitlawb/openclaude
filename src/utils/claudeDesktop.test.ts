import { afterAll, expect, mock, test } from 'bun:test'
import { win32 } from 'path'

// force the windows code path on any host os so ci exercises these branches.
// mock.module is process-global, so save the real module first and restore
// it in afterAll to avoid breaking other test files.
const realPlatform = await import('./platform.js')

mock.module('./platform.js', () => ({
  getPlatform: () => 'windows' as const,
  SUPPORTED_PLATFORMS: ['macos', 'wsl', 'windows'],
}))

import { getClaudeDesktopConfigPath, readClaudeDesktopMcpServers } from './claudeDesktop.js'

function restoreAppData(original: string | undefined): void {
  if (original === undefined) {
    delete process.env.APPDATA
  } else {
    process.env.APPDATA = original
  }
}

afterAll(() => {
  mock.module('./platform.js', () => realPlatform)
})

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
