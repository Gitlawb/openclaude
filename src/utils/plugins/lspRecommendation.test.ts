import { beforeEach, describe, expect, mock, test } from 'bun:test'

type MarketplaceEntry = {
  name: string
  description?: string
  lspServers?: Record<
    string,
    {
      command: string
      args?: string[]
      extensionToLanguage: Record<string, string>
    }
  >
}

let marketplaces: Record<string, MarketplaceEntry[]> = {}
let installedPlugins = new Set<string>()
let installedBinaries = new Set<string>()
let config = {
  lspRecommendationDisabled: false,
  lspRecommendationNeverPlugins: [] as string[],
  lspRecommendationIgnoredCount: 0,
}
let addMarketplaceSourceFn = mock(() => {})

mock.module('./marketplaceManager.js', () => ({
  loadKnownMarketplacesConfig: async () =>
    Object.fromEntries(
      Object.keys(marketplaces).map(name => [
        name,
        { installLocation: `/tmp/${name}` },
      ]),
    ),
  getMarketplace: async (name: string) => ({
    plugins: marketplaces[name] ?? [],
  }),
  addMarketplaceSource: addMarketplaceSourceFn,
}))

mock.module('../binaryCheck.js', () => ({
  isBinaryInstalled: async (command: string) => installedBinaries.has(command),
}))

mock.module('./installedPluginsManager.js', () => ({
  isPluginInstalled: (pluginId: string) => installedPlugins.has(pluginId),
}))

mock.module('../config.js', () => ({
  getGlobalConfig: () => config,
  saveGlobalConfig: mock((updater: (current: typeof config) => typeof config) => {
    config = updater(config)
  }),
}))

const {
  getMatchingLspPlugins,
  listLspPluginCandidates,
} = await import('./lspRecommendation.js')

function lspPlugin(
  name: string,
  command: string,
  extensions: string[],
  description = `${name} description`,
): MarketplaceEntry {
  return {
    name,
    description,
    lspServers: {
      [name]: {
        command,
        extensionToLanguage: Object.fromEntries(
          extensions.map(ext => [ext, ext.slice(1)]),
        ),
      },
    },
  }
}

beforeEach(() => {
  marketplaces = {
    'claude-plugins-official': [
      lspPlugin('typescript-lsp', 'typescript-language-server', [
        '.ts',
        '.tsx',
        '.js',
      ]),
      lspPlugin('pyright-lsp', 'pyright-langserver', ['.py', '.pyi']),
    ],
    community: [lspPlugin('rust-analyzer-lsp', 'rust-analyzer', ['.rs'])],
  }
  installedPlugins = new Set()
  installedBinaries = new Set(['typescript-language-server'])
  config = {
    lspRecommendationDisabled: false,
    lspRecommendationNeverPlugins: [],
    lspRecommendationIgnoredCount: 0,
  }
  addMarketplaceSourceFn.mockClear()
})

describe('listLspPluginCandidates', () => {
  test('lists matching marketplace LSP plugins including missing binaries', async () => {
    const candidates = await listLspPluginCandidates({
      extensions: ['ts', '.py'],
      includeInstalled: true,
      includeMissingBinaries: true,
    })

    expect(candidates.map(candidate => candidate.pluginId)).toEqual([
      'typescript-lsp@claude-plugins-official',
      'pyright-lsp@claude-plugins-official',
    ])
    expect(candidates[0]).toMatchObject({
      command: 'typescript-language-server',
      binaryInstalled: true,
      installed: false,
      isOfficial: true,
    })
    expect(candidates[1]).toMatchObject({
      command: 'pyright-langserver',
      binaryInstalled: false,
      installed: false,
    })
  })

  test('filters installed and missing-binary candidates unless requested', async () => {
    installedPlugins = new Set(['typescript-lsp@claude-plugins-official'])

    const candidates = await listLspPluginCandidates({
      extensions: ['.ts', '.py', '.rs'],
    })

    expect(candidates).toEqual([])
  })

  test('includes installed candidates when requested', async () => {
    installedPlugins = new Set(['typescript-lsp@claude-plugins-official'])

    const candidates = await listLspPluginCandidates({
      extensions: ['.ts'],
      includeInstalled: true,
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      pluginId: 'typescript-lsp@claude-plugins-official',
      installed: true,
      binaryInstalled: true,
    })
  })
})

describe('getMatchingLspPlugins', () => {
  test('keeps passive recommendations limited to installable non-installed plugins', async () => {
    installedBinaries = new Set([
      'typescript-language-server',
      'rust-analyzer',
    ])
    installedPlugins = new Set(['typescript-lsp@claude-plugins-official'])

    const matches = await getMatchingLspPlugins('src/main.rs')

    expect(matches.map(match => match.pluginId)).toEqual([
      'rust-analyzer-lsp@community',
    ])
    expect(matches[0]?.command).toBe('rust-analyzer')
  })
})

describe('marketplace discovery side effects', () => {
  test('does not mutate marketplace config when none are configured', async () => {
    marketplaces = {}
    installedBinaries = new Set(['typescript-language-server'])

    const candidates = await listLspPluginCandidates({
      extensions: ['.ts'],
      includeInstalled: true,
      includeMissingBinaries: true,
    })

    expect(addMarketplaceSourceFn).not.toHaveBeenCalled()
    expect(candidates).toEqual([])
  })
})
