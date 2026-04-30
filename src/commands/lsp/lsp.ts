import { extname } from 'path'
import { getAllLspServers } from '../../services/lsp/config.js'
import {
  getInitializationStatus,
  getLspServerManager,
  reinitializeLspServerManager,
  waitForInitialization,
} from '../../services/lsp/manager.js'
import {
  installPluginOp,
  uninstallPluginOp,
} from '../../services/plugins/pluginOperations.js'
import type {
  LocalCommandCall,
  LocalJSXCommandContext,
} from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { gitExe } from '../../utils/git.js'
import {
  listLspPluginCandidates,
  type LspPluginCandidate,
} from '../../utils/plugins/lspRecommendation.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { plural } from '../../utils/stringUtils.js'

type LspServerConfigLike = {
  command?: string
  args?: string[]
  extensionToLanguage?: Record<string, string>
}

type LspServerInstanceLike = {
  state?: string
  lastError?: Error
  config?: LspServerConfigLike
}

type LspServerManagerLike = {
  getAllServers(): Map<string, LspServerInstanceLike>
}

type InstallPluginResult = Awaited<ReturnType<typeof installPluginOp>>
type UninstallPluginResult = Awaited<ReturnType<typeof uninstallPluginOp>>
type RefreshActivePluginsResult = Awaited<
  ReturnType<typeof refreshActivePlugins>
>

export type LspCommandDeps = {
  getInitializationStatus: typeof getInitializationStatus
  getLspServerManager: () => LspServerManagerLike | undefined
  getAllLspServers: typeof getAllLspServers
  listLspPluginCandidates: typeof listLspPluginCandidates
  installPluginOp: typeof installPluginOp
  uninstallPluginOp: typeof uninstallPluginOp
  refreshActivePlugins: typeof refreshActivePlugins
  reinitializeLspServerManager: typeof reinitializeLspServerManager
  waitForInitialization: typeof waitForInitialization
  discoverWorkspaceExtensions: (pathspec?: string) => Promise<string[]>
}

const DEFAULT_DEPS: LspCommandDeps = {
  getInitializationStatus,
  getLspServerManager,
  getAllLspServers,
  listLspPluginCandidates,
  installPluginOp,
  uninstallPluginOp,
  refreshActivePlugins,
  reinitializeLspServerManager,
  waitForInitialization,
  discoverWorkspaceExtensions,
}

type BinaryInstallHint = {
  install?: {
    archManjaro?: string
    debianUbuntu?: string
    macos?: string
    windows?: string
    generic?: string
  }
  verify?: string
  notes?: string[]
}

const BINARY_INSTALL_HINTS: Record<string, BinaryInstallHint> = {
  clangd: {
    install: {
      archManjaro: 'sudo pacman -S clang',
      debianUbuntu: 'sudo apt install clangd',
      macos: 'brew install llvm',
    },
    verify: 'clangd --version',
  },

  vtsls: {
    install: {
      generic: 'npm install -g @vtsls/language-server typescript',
    },
    verify: 'vtsls --version',
  },

  'typescript-language-server': {
    install: {
      generic: 'npm install -g typescript typescript-language-server',
    },
    verify: 'typescript-language-server --version',
  },

  'pyright-langserver': {
    install: {
      generic: 'npm install -g pyright',
    },
    verify: 'pyright-langserver --help',
  },

  'rust-analyzer': {
    install: {
      generic: 'rustup component add rust-analyzer',
    },
    verify: 'rust-analyzer --version',
  },

  gopls: {
    install: {
      generic: 'go install golang.org/x/tools/gopls@latest',
    },
    verify: 'gopls version',
    notes: ['Ensure $(go env GOPATH)/bin is on PATH.'],
  },

  'csharp-ls': {
    install: {
      generic: 'dotnet tool install --global csharp-ls',
    },
    verify: 'csharp-ls --version',
    notes: ['Ensure ~/.dotnet/tools is on PATH.'],
  },

  jdtls: {
    install: {
      macos: 'brew install jdtls',
      generic: 'Install Eclipse JDT LS/jdtls and ensure jdtls is on PATH',
    },
    verify: 'jdtls --version',
  },

  'kotlin-lsp': {
    install: {
      macos: 'brew install JetBrains/utils/kotlin-lsp',
      generic:
        'Install kotlin-lsp manually and ensure kotlin-lsp is on PATH',
    },
    verify: 'kotlin-lsp --version',
    notes: ['Requires Java 17+.'],
  },

  'lua-language-server': {
    install: {
      macos: 'brew install lua-language-server',
      generic:
        'Install LuaLS/lua-language-server and ensure lua-language-server is on PATH',
    },
    verify: 'lua-language-server --version',
  },

  intelephense: {
    install: {
      generic: 'npm install -g intelephense',
    },
    verify: 'intelephense --version',
  },

  'ruby-lsp': {
    install: {
      generic: 'gem install ruby-lsp',
    },
    verify: 'ruby-lsp --version',
  },

  'sourcekit-lsp': {
    install: {
      macos: 'Install Xcode so sourcekit-lsp is available',
      generic:
        'Install the Swift toolchain and ensure sourcekit-lsp is on PATH',
    },
    verify: 'sourcekit-lsp --help',
  },
}

export const call: LocalCommandCall = (args, context) =>
  runLspCommand(args, context, DEFAULT_DEPS)

export async function runLspCommand(
  args: string,
  context: Pick<LocalJSXCommandContext, 'setAppState'>,
  deps: LspCommandDeps = DEFAULT_DEPS,
) {
  const { command, rest } = parseCommand(args)

  switch (command) {
    case '':
    case 'help':
      return text(helpText())
    case 'status':
      return text(await renderStatus(deps))
    case 'recommend':
      return text(await renderRecommendations(rest, deps))
    case 'install':
      return text(await installLspPlugin(rest, context, deps))
    case 'uninstall':
      return text(await uninstallLspPlugin(rest, context, deps))
    case 'restart':
      return text(await restartLsp(deps))
    default:
      return text(`Unknown /lsp command "${command}".\n\n${helpText()}`)
  }
}

function text(value: string): { type: 'text'; value: string } {
  return { type: 'text', value }
}

function parseCommand(args: string): { command: string; rest: string } {
  const trimmed = args.trim()
  if (!trimmed) return { command: '', rest: '' }
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  return {
    command: match?.[1]?.toLowerCase() ?? '',
    rest: match?.[2]?.trim() ?? '',
  }
}

function helpText(): string {
  return [
    'Usage:',
    '  /lsp status',
    '  /lsp recommend [path-or-extension]',
    '  /lsp install <plugin-id>',
    '  /lsp uninstall <plugin-id>',
    '  /lsp restart',
    '',
    'Examples:',
    '  /lsp status',
    '  /lsp recommend .',
    '  /lsp recommend src/main.ts',
    '  /lsp recommend .ts',
    '  /lsp install typescript-lsp@claude-plugins-official',
    '  /lsp uninstall typescript-lsp@claude-plugins-official',
    '  /lsp restart',
    '',
    'Tip:',
    '  Run /lsp recommend first and copy the plugin id from the recommendation output.',
  ].join('\n')
}

async function renderStatus(deps: LspCommandDeps): Promise<string> {
  const status = deps.getInitializationStatus()
  const { servers } = await deps.getAllLspServers()
  const manager = deps.getLspServerManager()
  const instances = manager?.getAllServers() ?? new Map()

  const lines = ['LSP status', `Initialization: ${status.status}`]

  if (status.status === 'failed') {
    lines.push(`Initialization error: ${status.error.message}`)
  }

  const serverNames = Object.keys(servers).sort()
  if (serverNames.length === 0) {
    lines.push('Configured plugin LSP servers: none')
    return lines.join('\n')
  }

  lines.push(`Configured plugin LSP servers: ${serverNames.length}`)
  for (const name of serverNames) {
    const instance = instances.get(name)
    const config = (instance?.config ?? servers[name]) as LspServerConfigLike
    const state = formatServerState(instance?.state ?? 'configured')
    const command = [config.command, ...(config.args ?? [])]
      .filter(Boolean)
      .join(' ')
    const extensions = Object.keys(config.extensionToLanguage ?? {}).sort()

    lines.push(`- ${name} (state: ${state})`)
    if (command) lines.push(`  command: ${command}`)
    if (extensions.length > 0) {
      lines.push(`  extensions: ${extensions.join(', ')}`)
    }
    if (instance?.lastError) {
      lines.push(`  last error: ${instance.lastError.message}`)
    }
  }

  return lines.join('\n')
}

function formatServerState(state: string): string {
  if (state === 'stopped') {
    return 'stopped (lazy start; starts on first LSP request)'
  }
  return state
}

async function renderRecommendations(
  target: string,
  deps: LspCommandDeps,
): Promise<string> {
  const trimmedTarget = target.trim()
  const extensions = await resolveRecommendationExtensions(target, deps)
  if (extensions.length === 0) {
    return trimmedTarget
      ? `No file extensions found for ${JSON.stringify(trimmedTarget)}.`
      : 'No file extensions found in this workspace.'
  }

  const candidates = await deps.listLspPluginCandidates({
    extensions,
    includeInstalled: true,
    includeMissingBinaries: true,
  })
  const scope = formatExtensionScope(extensions)

  if (candidates.length === 0) {
    return `No LSP plugin candidates found for ${scope}.`
  }

  const matchedScope = formatExtensionScope(
    getCandidateMatchedExtensions(extensions, candidates),
  )
  const lines = [`LSP recommendations for ${matchedScope || scope}`]
  for (const candidate of candidates) {
    lines.push(...renderCandidate(candidate))
  }
  return lines.join('\n')
}

function renderCandidate(candidate: LspPluginCandidate): string[] {
  const status = [
    candidate.installed ? 'installed' : 'not installed',
    candidate.binaryInstalled ? 'binary: found' : 'binary: missing',
  ].join(', ')
  const lines = [
    `- ${candidate.pluginId} (${status})`,
    `  command: ${candidate.command}`,
    `  extensions: ${candidate.extensions.join(', ')}`,
  ]

  if (candidate.description) {
    lines.push(`  description: ${candidate.description}`)
  }
  if (!candidate.binaryInstalled) {
    lines.push('  next: install the language server binary')
    for (const hintLine of binaryInstallHint(candidate.command).split('\n')) {
      lines.push(hintLine ? `    ${hintLine}` : '    ')
    }
  }
  if (!candidate.installed) {
    lines.push(`  next: /lsp install ${candidate.pluginId}`)
  }

  return lines
}

function binaryInstallHint(command: string): string {
  const hint = BINARY_INSTALL_HINTS[command]

  if (!hint) {
    return [
      `Binary missing: ${command}`,
      '',
      'Install:',
      `  Install ${command} and ensure it is on PATH`,
      '',
      'Verify:',
      `  ${command} --version`,
    ].join('\n')
  }

  const lines: string[] = [
    `Binary missing: ${command}`,
    '',
    'Install:',
  ]

  if (hint.install?.archManjaro) {
    lines.push(`  Arch/Manjaro: ${hint.install.archManjaro}`)
  }

  if (hint.install?.debianUbuntu) {
    lines.push(`  Debian/Ubuntu: ${hint.install.debianUbuntu}`)
  }

  if (hint.install?.macos) {
    lines.push(`  macOS: ${hint.install.macos}`)
  }

  if (hint.install?.windows) {
    lines.push(`  Windows: ${hint.install.windows}`)
  }

  if (hint.install?.generic) {
    lines.push(`  ${hint.install.generic}`)
  }

  if (hint.verify) {
    lines.push('', 'Verify:', `  ${hint.verify}`)
  }

  if (hint.notes?.length) {
    lines.push('', 'Notes:')
    for (const note of hint.notes) {
      lines.push(`  - ${note}`)
    }
  }

  return lines.join('\n')
}

async function installLspPlugin(
  pluginId: string,
  context: Pick<LocalJSXCommandContext, 'setAppState'>,
  deps: LspCommandDeps,
): Promise<string> {
  if (!pluginId) {
    return 'Usage: /lsp install <plugin-id>'
  }

  let result: InstallPluginResult
  try {
    result = await deps.installPluginOp(pluginId, 'user')
  } catch (error) {
    return `Failed to install ${pluginId}: ${errorMessage(error)}`
  }

  if (!result.success) {
    return `Failed to install ${pluginId}: ${result.message}`
  }

  const installedId = result.pluginId ?? pluginId
  let refresh: RefreshActivePluginsResult
  try {
    refresh = await deps.refreshActivePlugins(context.setAppState)
  } catch (error) {
    return `Installed ${installedId}, but plugin refresh failed: ${errorMessage(
      error,
    )}. Run /reload-plugins after fixing the error.`
  }

  let message = `Installed ${installedId}. Activated ${refresh.lsp_count} ${plural(
    refresh.lsp_count,
    'plugin LSP server',
  )}.`

  if (refresh.error_count > 0) {
    message += ` ${refresh.error_count} ${plural(
      refresh.error_count,
      'error',
    )} during plugin refresh; run /doctor for details.`
  }

  return message
}

async function uninstallLspPlugin(
  pluginId: string,
  context: Pick<LocalJSXCommandContext, 'setAppState'>,
  deps: LspCommandDeps,
): Promise<string> {
  if (!pluginId) {
    return 'Usage: /lsp uninstall <plugin-id>'
  }

  let result: UninstallPluginResult
  try {
    result = await deps.uninstallPluginOp(pluginId, 'user')
  } catch (error) {
    return `Failed to uninstall ${pluginId}: ${errorMessage(error)}`
  }

  if (!result.success) {
    return `Failed to uninstall ${pluginId}: ${result.message}`
  }

  const uninstalledId = result.pluginId ?? pluginId
  let refresh: RefreshActivePluginsResult
  try {
    refresh = await deps.refreshActivePlugins(context.setAppState)
  } catch (error) {
    return `Uninstalled ${uninstalledId}, but plugin refresh failed: ${errorMessage(error)}. Run /reload-plugins after fixing the error.`
  }

  await deps.waitForInitialization()

  let message = `Uninstalled ${uninstalledId}. ${refresh.lsp_count} ${plural(
    refresh.lsp_count,
    'plugin LSP server',
  )} still active.`

  if (refresh.error_count > 0) {
    message += ` ${refresh.error_count} ${plural(
      refresh.error_count,
      'error',
    )} during plugin refresh.`
  }

  return message
}

async function restartLsp(deps: LspCommandDeps): Promise<string> {
  const statusBefore = deps.getInitializationStatus()
  if (statusBefore.status === 'not-started') {
    return 'LSP has not been initialized. Nothing to restart.'
  }

  deps.reinitializeLspServerManager()
  await deps.waitForInitialization()

  const statusAfter = deps.getInitializationStatus()
  if (statusAfter.status === 'success') {
    const servers = await deps.getAllLspServers()
    const count = Object.keys(servers.servers).length
    return `LSP restarted. ${count} ${plural(count, 'server')} configured.`
  }

  if (statusAfter.status === 'failed') {
    return `LSP restart failed: ${statusAfter.error.message}`
  }

  return 'LSP restart in progress.'
}

async function resolveRecommendationExtensions(
  target: string,
  deps: Pick<LspCommandDeps, 'discoverWorkspaceExtensions'>,
): Promise<string[]> {
  const trimmed = target.trim()
  if (!trimmed) {
    return deps.discoverWorkspaceExtensions()
  }

  if (isExtensionLiteral(trimmed)) {
    return [trimmed.toLowerCase()]
  }

  const ext = extname(trimmed).toLowerCase()
  if (ext) return [ext]

  const pathExtensions = await deps.discoverWorkspaceExtensions(trimmed)
  if (pathExtensions.length > 0) {
    return pathExtensions
  }

  if (/^[a-z0-9_+-]+$/i.test(trimmed)) {
    return [`.${trimmed.toLowerCase()}`]
  }

  return []
}

function isExtensionLiteral(value: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9_+-]*$/.test(value)
}

function formatExtensionScope(extensions: string[]): string {
  return [...extensions].sort().join(', ')
}

function getCandidateMatchedExtensions(
  requestedExtensions: string[],
  candidates: LspPluginCandidate[],
): string[] {
  const requested = new Set(requestedExtensions)
  const matched = new Set<string>()
  for (const candidate of candidates) {
    for (const ext of candidate.extensions) {
      if (requested.has(ext)) {
        matched.add(ext)
      }
    }
  }
  return Array.from(matched)
}

export async function discoverWorkspaceExtensions(pathspec?: string): Promise<string[]> {
  const args = pathspec ? ['ls-files', '--', pathspec] : ['ls-files']
  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    cwd: getCwd(),
    timeout: 5_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.code !== 0) return []
  return rankFileExtensions(result.stdout.split('\n'))
}

function rankFileExtensions(files: string[]): string[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    const ext = extname(file.trim()).toLowerCase()
    if (!ext) continue
    counts.set(ext, (counts.get(ext) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([ext]) => ext)
}
