import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── cache-bust helper ──────────────────────────────────────────────────────
// When the full test suite runs, other files may import shellToolUtils /
// platform / settings before us. Those cached modules already have their
// imports resolved to the real modules. mock.module replaces the registry
// entry but can't rewire already-resolved static imports inside cached
// modules. Cache-busting query strings force a fresh module evaluation
// that resolves imports through the mock registry.
let cacheBust = 0
function fresh(file: string) {
  return `${file}?t=${cacheBust++}`
}

// ── env hygiene ────────────────────────────────────────────────────────────
const originalEnv = {
  OPENCLAUDE_USE_POWERSHELL_TOOL: process.env.OPENCLAUDE_USE_POWERSHELL_TOOL,
  CLAUDE_CODE_USE_POWERSHELL_TOOL: process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
  USER_TYPE: process.env.USER_TYPE,
}

beforeEach(() => {
  delete process.env.OPENCLAUDE_USE_POWERSHELL_TOOL
  delete process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL
  delete process.env.USER_TYPE
})

afterEach(() => {
  if (originalEnv.OPENCLAUDE_USE_POWERSHELL_TOOL === undefined) {
    delete process.env.OPENCLAUDE_USE_POWERSHELL_TOOL
  } else {
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = originalEnv.OPENCLAUDE_USE_POWERSHELL_TOOL
  }
  if (originalEnv.CLAUDE_CODE_USE_POWERSHELL_TOOL === undefined) {
    delete process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL
  } else {
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = originalEnv.CLAUDE_CODE_USE_POWERSHELL_TOOL
  }
  if (originalEnv.USER_TYPE === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalEnv.USER_TYPE
  }
})

// ── getPowershellToolEnv ──────────────────────────────────────────────────

describe('getPowershellToolEnv', () => {
  test('returns undefined when neither env var is set', async () => {
    const { getPowershellToolEnv } = await import(fresh('./shellToolUtils.js'))
    expect(getPowershellToolEnv()).toBeUndefined()
  })

  test('returns preferred when OPENCLAUDE_USE_POWERSHELL_TOOL is set', async () => {
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    const { getPowershellToolEnv } = await import(fresh('./shellToolUtils.js'))
    expect(getPowershellToolEnv()).toBe('1')
  })

  test('returns legacy fallback when only CLAUDE_CODE_USE_POWERSHELL_TOOL is set', async () => {
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = 'true'
    const { getPowershellToolEnv } = await import(fresh('./shellToolUtils.js'))
    expect(getPowershellToolEnv()).toBe('true')
  })

  test('preferred wins when both env vars are set', async () => {
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '0'
    const { getPowershellToolEnv } = await import(fresh('./shellToolUtils.js'))
    expect(getPowershellToolEnv()).toBe('1')
  })
})

// ── isPowerShellToolEnabled (Windows) ────────────────────────────────────

describe('isPowerShellToolEnabled (Windows)', () => {
  test('enabled when preferred env var is truthy (external user)', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(true)
  })

  test('enabled when only legacy env var is truthy (external user)', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = 'true'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(true)
  })

  test('disabled when neither env var is set (external user)', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })

  test('disabled when preferred is falsy and legacy is unset (external user)', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '0'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })

  test('enabled for ant user when env var is unset (default-on)', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.USER_TYPE = 'ant'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(true)
  })

  test('disabled for ant user when preferred is explicitly falsy', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.USER_TYPE = 'ant'
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '0'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })

  test('disabled for ant user when legacy is explicitly falsy and preferred is unset', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.USER_TYPE = 'ant'
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = 'false'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })
})

// ── resolveDefaultShell (Windows) ─────────────────────────────────────────
// resolveDefaultShell statically imports getPowershellToolEnv from
// shellToolUtils. If shellToolUtils was cached by a prior test file, its
// static import of platform is already resolved to the real module —
// mock.module can't rewire it. We break the chain by mocking shellToolUtils
// itself with a fresh getPowershellToolEnv closure over process.env.

describe('resolveDefaultShell (Windows)', () => {
  test('returns bash by default on Windows without env var', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({}),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('bash')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })

  test('returns powershell when preferred env var is truthy on Windows', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({}),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('powershell')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })

  test('returns powershell when only legacy env var is truthy on Windows', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = 'true'
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({}),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('powershell')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })

  test('preferred env var wins over legacy for default shell', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '0'
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({}),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('powershell')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })

  test('settings.defaultShell overrides env var', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({ defaultShell: 'bash' as const }),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('bash')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })

  test('settings.defaultShell=powershell wins regardless of env var', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'windows' }))
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({ defaultShell: 'powershell' as const }),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('powershell')
    mock.module('../settings/settings.js', () => ({}))
    mock.module('./shellToolUtils.js', () => ({}))
  })
})

// ── non-Windows tests ─────────────────────────────────────────────────────

describe('isPowerShellToolEnabled (non-Windows)', () => {
  test('returns false on macOS even with env var set', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'macos' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })

  test('returns false on Linux even with legacy env var set', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'linux' }))
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL = '1'
    const { isPowerShellToolEnabled } = await import(fresh('./shellToolUtils.js'))
    expect(isPowerShellToolEnabled()).toBe(false)
  })
})

describe('resolveDefaultShell (non-Windows)', () => {
  test('returns bash on non-Windows even with env var set', async () => {
    mock.module('../platform.js', () => ({ getPlatform: () => 'macos' }))
    process.env.OPENCLAUDE_USE_POWERSHELL_TOOL = '1'
    mock.module('../settings/settings.js', () => ({
      getInitialSettings: () => ({}),
    }))
    mock.module('./shellToolUtils.js', () => ({
      getPowershellToolEnv: () =>
        process.env.OPENCLAUDE_USE_POWERSHELL_TOOL ??
        process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL,
    }))
    const { resolveDefaultShell } = await import(fresh('./resolveDefaultShell.js'))
    expect(resolveDefaultShell()).toBe('bash')
  })
})
