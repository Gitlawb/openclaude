import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

type InitializationStatus =
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error }

type TestServerConfig = {
  command?: string
  args?: string[]
  extensionToLanguage?: Record<string, string>
}

type TestServerInstance = {
  state?: string
  lastError?: Error
  config?: TestServerConfig
}

type OfficialMarketplaceCheckResult = {
  installed: boolean
  skipped: boolean
  reason?:
    | 'already_attempted'
    | 'already_installed'
    | 'policy_blocked'
    | 'git_unavailable'
    | 'gcs_unavailable'
    | 'unknown'
  configSaveFailed?: boolean
}

let initializationStatus: InitializationStatus = { status: 'not-started' }
let configuredServers: Record<string, TestServerConfig> = {}
let serverInstances = new Map<string, TestServerInstance>()
let candidateCallOptions: unknown[] = []
let candidates: Array<{
  pluginId: string
  pluginName: string
  marketplaceName: string
  description?: string
  isOfficial: boolean
  extensions: string[]
  command: string
  binaryInstalled: boolean
  installed: boolean
}> = []

const installPluginOp = mock(
  async (_plugin: string, _scope?: 'user' | 'local' | 'project') => ({
    success: true,
    message: 'Installed plugin',
    pluginId: 'typescript-lsp@claude-plugins-official',
    scope: 'user' as const,
  }),
)

const refreshActivePlugins = mock(async () => ({
  enabled_count: 1,
  disabled_count: 0,
  command_count: 0,
  agent_count: 0,
  hook_count: 0,
  mcp_count: 0,
  lsp_count: 1,
  error_count: 0,
  agentDefinitions: { activeAgents: [], allAgents: [] },
  pluginCommands: [],
}))

const uninstallPluginOp = mock(
  async (_plugin: string, _scope?: 'user' | 'local' | 'project') => ({
    success: true,
    message: 'Uninstalled plugin',
    pluginId: 'typescript-lsp@claude-plugins-official',
  }),
)

const reinitializeLspServerManager = mock(() => {})
const waitForInitialization = mock(async () => {})
const checkAndInstallOfficialMarketplace = mock(
  async (): Promise<OfficialMarketplaceCheckResult> => ({
    installed: false,
    skipped: true,
    reason: 'already_installed',
  }),
)
const discoverWorkspaceExtensions = async (pathspec?: string) =>
  pathspec === 'src' || pathspec === '.'
    ? ['.ts', '.tsx']
    : pathspec
      ? []
      : ['.ts']

const { discoverWorkspaceExtensions: discoverRealWorkspaceExtensions, runLspCommand } =
  await import('./lsp.js')

const EMPTY_CONTEXT = {
  setAppState: () => {},
} as Parameters<typeof runLspCommand>[1]

const deps = {
  getInitializationStatus: () => initializationStatus,
  getLspServerManager: () =>
    serverInstances.size > 0
      ? {
          getAllServers: () => serverInstances,
        }
      : undefined,
  getAllLspServers: async () => ({ servers: configuredServers }),
  listLspPluginCandidates: async (options: unknown) => {
    candidateCallOptions.push(options)
    return candidates
  },
  checkAndInstallOfficialMarketplace,
  installPluginOp,
  uninstallPluginOp,
  refreshActivePlugins,
  reinitializeLspServerManager,
  waitForInitialization,
  discoverWorkspaceExtensions,
}

beforeEach(() => {
  initializationStatus = { status: 'not-started' }
  configuredServers = {}
  serverInstances = new Map()
  candidateCallOptions = []
  candidates = []
  installPluginOp.mockClear()
  uninstallPluginOp.mockClear()
  refreshActivePlugins.mockClear()
  reinitializeLspServerManager.mockClear()
  waitForInitialization.mockClear()
  checkAndInstallOfficialMarketplace.mockClear()
  checkAndInstallOfficialMarketplace.mockImplementation(async () => ({
    installed: false,
    skipped: true,
    reason: 'already_installed' as const,
  }))
  deps.getInitializationStatus = () => initializationStatus
  deps.listLspPluginCandidates = async (options: unknown) => {
    candidateCallOptions.push(options)
    return candidates
  }
  deps.discoverWorkspaceExtensions = discoverWorkspaceExtensions
})

async function run(args: string): Promise<string> {
  const result = await runLspCommand(args, EMPTY_CONTEXT, deps)
  expect(result.type).toBe('text')
  return result.type === 'text' ? result.value : ''
}

describe('/lsp status', () => {
  test('shows not-started status with no configured servers', async () => {
    const output = await run('status')

    expect(output).toContain('LSP status')
    expect(output).toContain('Initialization: not-started')
    expect(output).toContain('Configured plugin LSP servers: none')
  })

  test('shows success status with zero configured servers', async () => {
    initializationStatus = { status: 'success' }

    const output = await run('status')

    expect(output).toContain('Initialization: success')
    expect(output).toContain('Configured plugin LSP servers: none')
  })

  test('shows success status with configured servers', async () => {
    initializationStatus = { status: 'success' }
    configuredServers = {
      'plugin:typescript-lsp:typescript': {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    }

    const output = await run('status')

    expect(output).toContain('Configured plugin LSP servers: 1')
    expect(output).toContain('state: configured')
    expect(output).toContain('typescript-language-server --stdio')
    expect(output).toContain('extensions: .ts')
  })

  test('explains stopped servers as lazy-started rather than broken', async () => {
    initializationStatus = { status: 'success' }
    configuredServers = {
      'plugin:typescript-lsp:typescript': {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    }
    serverInstances = new Map([
      [
        'plugin:typescript-lsp:typescript',
        {
          state: 'stopped',
          config: configuredServers['plugin:typescript-lsp:typescript'],
        },
      ],
    ])

    const output = await run('status')

    expect(output).toContain(
      'state: stopped (lazy start; starts on first LSP request)',
    )
  })

  test('shows configured server state and initialization error', async () => {
    initializationStatus = {
      status: 'failed',
      error: new Error('startup failed'),
    }
    configuredServers = {
      'plugin:typescript-lsp:typescript': {
        command: 'typescript-language-server',
        extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
      },
    }
    serverInstances = new Map([
      [
        'plugin:typescript-lsp:typescript',
        {
          state: 'error',
          lastError: new Error('server crashed'),
          config: configuredServers['plugin:typescript-lsp:typescript'],
        },
      ],
    ])

    const output = await run('status')

    expect(output).toContain('Initialization: failed')
    expect(output).toContain('startup failed')
    expect(output).toContain('plugin:typescript-lsp:typescript')
    expect(output).toContain('state: error')
    expect(output).toContain('typescript-language-server')
    expect(output).toContain('.ts, .tsx')
    expect(output).toContain('server crashed')
  })
})

describe('/lsp recommend', () => {
  test('lists candidates with binary state and next commands', async () => {
    candidates = [
      {
        pluginId: 'typescript-lsp@claude-plugins-official',
        pluginName: 'typescript-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.ts', '.tsx'],
        command: 'typescript-language-server',
        binaryInstalled: false,
        installed: false,
      },
    ]

    const output = await run('recommend src/main.ts')

    expect(output).toContain('LSP recommendations for .ts')
    expect(output).toContain('typescript-lsp@claude-plugins-official')
    expect(output).toContain('binary: missing')
    expect(output).toContain(
      'npm install -g typescript typescript-language-server',
    )
    expect(output).toContain(
      '/lsp install typescript-lsp@claude-plugins-official',
    )
  })

  test('uses directory paths and bare extensions for recommendation scope', async () => {
    candidates = [
      {
        pluginId: 'typescript-lsp@claude-plugins-official',
        pluginName: 'typescript-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.ts', '.tsx'],
        command: 'typescript-language-server',
        binaryInstalled: true,
        installed: false,
      },
    ]

    expect(await run('recommend src')).toContain(
      'LSP recommendations for .ts, .tsx',
    )
    expect(await run('recommend ts')).toContain('LSP recommendations for .ts')
    expect(await run('recommend .')).toContain(
      'LSP recommendations for .ts, .tsx',
    )
    expect(candidateCallOptions).toContainEqual(
      expect.objectContaining({ extensions: ['.ts', '.tsx'] }),
    )
    expect(candidateCallOptions).toContainEqual(
      expect.objectContaining({ extensions: ['.ts'] }),
    )
  })

  test('does not list every marketplace candidate for a path without extensions', async () => {
    candidates = [
      {
        pluginId: 'typescript-lsp@claude-plugins-official',
        pluginName: 'typescript-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.ts', '.tsx'],
        command: 'typescript-language-server',
        binaryInstalled: true,
        installed: false,
      },
    ]

    const output = await run('recommend missing/path')

    expect(output).toContain('No file extensions found for "missing/path".')
    expect(candidateCallOptions).toEqual([])
  })

  test('quotes dot path when no extensions are found', async () => {
    deps.discoverWorkspaceExtensions = async () => []

    const output = await run('recommend .')

    expect(output).toContain('No file extensions found for ".".')
    expect(output).not.toContain('for ..')
  })

  test('filters noisy workspace extensions and reports matched candidate extensions', async () => {
    deps.discoverWorkspaceExtensions = async () => [
      '.ts',
      '.png',
      '.woff2',
    ]
    candidates = [
      {
        pluginId: 'typescript-lsp@claude-plugins-official',
        pluginName: 'typescript-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.ts', '.tsx'],
        command: 'typescript-language-server',
        binaryInstalled: true,
        installed: false,
      },
    ]

    const output = await run('recommend')

    expect(output).toContain('LSP recommendations for .ts')
    expect(output).not.toContain('.png')
    expect(output).not.toContain('.woff2')
    expect(candidateCallOptions).toContainEqual(
      expect.objectContaining({ extensions: ['.ts'] }),
    )
  })

  test('falls back to filesystem scanning when git cannot enumerate workspace files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'openclaude-lsp-'))
    try {
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'main.ts'), 'export const x = 1\n')
      await writeFile(join(tempDir, 'src', 'style.css'), '.root {}\n')
      await writeFile(join(tempDir, 'logo.png'), '')

      const extensions = await discoverRealWorkspaceExtensions(undefined, tempDir)

      expect(extensions).toContain('.ts')
      expect(extensions).toContain('.css')
      expect(extensions).not.toContain('.png')
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test('installs missing official marketplace and retries candidate lookup', async () => {
    const typescriptCandidate = {
      pluginId: 'typescript-lsp@claude-plugins-official',
      pluginName: 'typescript-lsp',
      marketplaceName: 'claude-plugins-official',
      isOfficial: true,
      extensions: ['.ts', '.tsx'],
      command: 'typescript-language-server',
      binaryInstalled: true,
      installed: false,
    }
    let lookupCount = 0
    deps.listLspPluginCandidates = async (options: unknown) => {
      candidateCallOptions.push(options)
      lookupCount += 1
      return lookupCount === 1 ? [] : [typescriptCandidate]
    }
    checkAndInstallOfficialMarketplace.mockImplementationOnce(async () => ({
      installed: true,
      skipped: false,
    }))

    const output = await run('recommend src/main.ts')

    expect(checkAndInstallOfficialMarketplace).toHaveBeenCalled()
    expect(candidateCallOptions).toHaveLength(2)
    expect(output).toContain(
      'Anthropic marketplace installed for LSP recommendations',
    )
    expect(output).toContain('typescript-lsp@claude-plugins-official')
  })

  test('explains why marketplace repair could not provide candidates', async () => {
    checkAndInstallOfficialMarketplace.mockImplementationOnce(async () => ({
      installed: false,
      skipped: true,
      reason: 'policy_blocked',
    }))

    const output = await run('recommend src/main.ts')

    expect(output).toContain('No LSP plugin candidates found for .ts')
    expect(output).toContain('policy blocks it')
  })
})

describe('/lsp install', () => {
  test('installs plugin and refreshes active plugins in-session', async () => {
    const output = await run('install typescript-lsp@claude-plugins-official')

    expect(installPluginOp).toHaveBeenCalledWith(
      'typescript-lsp@claude-plugins-official',
      'user',
    )
    expect(refreshActivePlugins).toHaveBeenCalledWith(EMPTY_CONTEXT.setAppState)
    expect(output).toContain(
      'Installed typescript-lsp@claude-plugins-official',
    )
    expect(output).toContain('Activated 1 plugin LSP server')
  })

  test('reports install operation exceptions', async () => {
    installPluginOp.mockImplementationOnce(async () => {
      throw new Error('install exploded')
    })

    const output = await run('install typescript-lsp@claude-plugins-official')

    expect(output).toContain(
      'Failed to install typescript-lsp@claude-plugins-official',
    )
    expect(output).toContain('install exploded')
  })

  test('reports partial success when refresh fails after install', async () => {
    refreshActivePlugins.mockImplementationOnce(async () => {
      throw new Error('refresh exploded')
    })

    const output = await run('install typescript-lsp@claude-plugins-official')

    expect(output).toContain(
      'Installed typescript-lsp@claude-plugins-official',
    )
    expect(output).toContain('plugin refresh failed')
    expect(output).toContain('refresh exploded')
  })
})

describe('/lsp uninstall', () => {
  test('uninstalls plugin, refreshes plugins, and reports remaining servers', async () => {
    configuredServers = {
      'plugin:typescript-lsp:typescript': {
        command: 'typescript-language-server',
      },
    }

    const output = await run('uninstall typescript-lsp@claude-plugins-official')

    expect(uninstallPluginOp).toHaveBeenCalledWith(
      'typescript-lsp@claude-plugins-official',
      'user',
    )
    expect(refreshActivePlugins).toHaveBeenCalledWith(EMPTY_CONTEXT.setAppState)
    expect(reinitializeLspServerManager).not.toHaveBeenCalled()
    expect(waitForInitialization).toHaveBeenCalled()
    expect(output).toContain('Uninstalled typescript-lsp@claude-plugins-official')
    expect(output).toContain('1 plugin LSP server still active')
  })

  test('reports usage when no plugin-id given', async () => {
    const output = await run('uninstall')

    expect(output).toContain('Usage: /lsp uninstall')
    expect(uninstallPluginOp).not.toHaveBeenCalled()
  })

  test('reports uninstall failure', async () => {
    uninstallPluginOp.mockImplementationOnce(async () => ({
      success: false,
      message: 'Plugin not found',
      pluginId: 'nonexistent@marketplace',
    }))

    const output = await run('uninstall nonexistent@marketplace')

    expect(output).toContain('Failed to uninstall')
    expect(output).toContain('Plugin not found')
  })

  test('reports uninstall operation exceptions', async () => {
    uninstallPluginOp.mockImplementationOnce(async () => {
      throw new Error('uninstall exploded')
    })

    const output = await run('uninstall typescript-lsp@claude-plugins-official')

    expect(output).toContain('Failed to uninstall')
    expect(output).toContain('uninstall exploded')
  })

  test('reports partial success when refresh fails after uninstall', async () => {
    refreshActivePlugins.mockImplementationOnce(async () => {
      throw new Error('refresh exploded')
    })

    const output = await run('uninstall typescript-lsp@claude-plugins-official')

    expect(output).toContain('Uninstalled typescript-lsp@claude-plugins-official')
    expect(output).toContain('plugin refresh failed')
    expect(output).toContain('refresh exploded')
  })
})

describe('/lsp restart', () => {
  test('reinitializes and reports server count', async () => {
    initializationStatus = { status: 'success' }
    configuredServers = {
      'plugin:typescript-lsp:typescript': {
        command: 'typescript-language-server',
      },
    }

    const output = await run('restart')

    expect(reinitializeLspServerManager).toHaveBeenCalled()
    expect(waitForInitialization).toHaveBeenCalled()
    expect(output).toContain('LSP restarted')
    expect(output).toContain('1 server configured')
  })

  test('refuses to restart when LSP not initialized', async () => {
    initializationStatus = { status: 'not-started' }

    const output = await run('restart')

    expect(reinitializeLspServerManager).not.toHaveBeenCalled()
    expect(output).toContain('not been initialized')
  })

  test('reports restart failure', async () => {
    initializationStatus = { status: 'success' }

    // After restart, status becomes failed
    const statuses: InitializationStatus[] = [
      { status: 'success' },
      { status: 'failed', error: new Error('server crash') },
    ]
    deps.getInitializationStatus = () => statuses.shift()!

    const output = await run('restart')

    expect(output).toContain('LSP restart failed')
    expect(output).toContain('server crash')

    // Restore original behavior
    deps.getInitializationStatus = () => initializationStatus
  })
})

describe('/lsp help', () => {
  test('shows usage for all commands with examples', async () => {
    const output = await run('help')

    expect(output).toContain('/lsp status')
    expect(output).toContain('/lsp recommend')
    expect(output).toContain('/lsp install')
    expect(output).toContain('/lsp uninstall')
    expect(output).toContain('/lsp restart')
    expect(output).toContain('Tip:')
  })

  test('shows help for unknown subcommands', async () => {
    const output = await run('bogus')

    expect(output).toContain('Unknown /lsp command "bogus"')
    expect(output).toContain('/lsp status')
    expect(output).toContain('/lsp restart')
  })
})

describe('binary install hints', () => {
  test('shows OS-specific install instructions for known binaries', async () => {
    candidates = [
      {
        pluginId: 'clangd-lsp@claude-plugins-official',
        pluginName: 'clangd-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.c', '.cpp'],
        command: 'clangd',
        binaryInstalled: false,
        installed: false,
      },
    ]

    const output = await run('recommend src/main.cpp')

    expect(output).toContain('Binary missing: clangd')
    expect(output).toContain('Arch/Manjaro:')
    expect(output).toContain('sudo pacman -S clang')
    expect(output).toContain('Debian/Ubuntu:')
    expect(output).toContain('macOS:')
    expect(output).toContain('Verify:')
    expect(output).toContain('clangd --version')
  })

  test('shows generic fallback for unknown binaries', async () => {
    candidates = [
      {
        pluginId: 'unknown-lsp@marketplace',
        pluginName: 'unknown-lsp',
        marketplaceName: 'marketplace',
        isOfficial: false,
        extensions: ['.xyz'],
        command: 'some-unknown-binary',
        binaryInstalled: false,
        installed: false,
      },
    ]

    const output = await run('recommend file.xyz')

    expect(output).toContain('Binary missing: some-unknown-binary')
    expect(output).toContain('Install some-unknown-binary and ensure it is on PATH')
    expect(output).toContain('some-unknown-binary --version')
  })

  test('shows notes for binaries that have them', async () => {
    candidates = [
      {
        pluginId: 'gopls-lsp@claude-plugins-official',
        pluginName: 'gopls-lsp',
        marketplaceName: 'claude-plugins-official',
        isOfficial: true,
        extensions: ['.go'],
        command: 'gopls',
        binaryInstalled: false,
        installed: false,
      },
    ]

    const output = await run('recommend main.go')

    expect(output).toContain('Notes:')
    expect(output).toContain('Ensure $(go env GOPATH)/bin is on PATH')
  })
})
