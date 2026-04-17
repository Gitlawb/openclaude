/**
 * Plugin and marketplace subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when `nnc plugin *` or `nnc plugin marketplace *` runs.
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */
import figures from 'figures'
import { basename, dirname } from 'path'
import { setUseCoworkPlugins } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import {
  disableAllPlugins,
  disablePlugin,
  enablePlugin,
  installPlugin,
  uninstallPlugin,
  updatePluginCli,
  VALID_INSTALLABLE_SCOPES,
  VALID_UPDATE_SCOPES,
} from '../../services/plugins/pluginCliCommands.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js'
import { getInstallCounts } from '../../utils/plugins/installCounts.js'
import {
  isPluginInstalled,
  loadInstalledPluginsV2,
} from '../../utils/plugins/installedPluginsManager.js'
import {
  createPluginId,
  loadMarketplacesWithGracefulDegradation,
} from '../../utils/plugins/marketplaceHelpers.js'
import {
  addMarketplaceSource,
  loadKnownMarketplacesConfig,
  refreshAllMarketplaces,
  refreshMarketplace,
  removeMarketplaceSource,
  saveMarketplaceToSettings,
} from '../../utils/plugins/marketplaceManager.js'
import { loadPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { parseMarketplaceInput } from '../../utils/plugins/parseMarketplaceInput.js'
import {
  parsePluginIdentifier,
  scopeToSettingSource,
} from '../../utils/plugins/pluginIdentifier.js'
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js'
import type { PluginSource } from '../../utils/plugins/schemas.js'
import {
  type ValidationResult,
  validateManifest,
  validatePluginContents,
} from '../../utils/plugins/validatePlugin.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { plural } from '../../utils/stringUtils.js'
import { cliError, cliOk } from '../exit.js'

// Re-export for main.tsx to reference in option definitions
export { VALID_INSTALLABLE_SCOPES, VALID_UPDATE_SCOPES }

/**
 * Helper function to handle marketplace command errors consistently.
 */
export function handleMarketplaceError(error: unknown, action: string): never {
  logError(error)
  cliError(`${figures.cross} Не вдалося ${action}: ${errorMessage(error)}`)
}

function printValidationResult(result: ValidationResult): void {
  if (result.errors.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(
      `${figures.cross} Знайдено помилок: ${result.errors.length}:\n`,
    )
    result.errors.forEach(error => {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${figures.pointer} ${error.path}: ${error.message}`)
    })
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('')
  }
  if (result.warnings.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(
      `${figures.warning} Знайдено попереджень: ${result.warnings.length}:\n`,
    )
    result.warnings.forEach(warning => {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${figures.pointer} ${warning.path}: ${warning.message}`)
    })
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('')
  }
}

// plugin validate
export async function pluginValidateHandler(
  manifestPath: string,
  options: { cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    const result = await validateManifest(manifestPath)

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`Перевірка ${result.fileType} маніфесту: ${result.filePath}\n`)
    printValidationResult(result)

    // If this is a plugin manifest located inside a .nnc-plugin directory,
    // also validate the plugin's content files (skills, agents, commands,
    // hooks). Works whether the user passed a directory or the plugin.json
    // path directly.
    let contentResults: ValidationResult[] = []
    if (result.fileType === 'plugin') {
      const manifestDir = dirname(result.filePath)
      if (basename(manifestDir) === '.nnc-plugin') {
        contentResults = await validatePluginContents(dirname(manifestDir))
        for (const r of contentResults) {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`Перевірка ${r.fileType}: ${r.filePath}\n`)
          printValidationResult(r)
        }
      }
    }

    const allSuccess = result.success && contentResults.every(r => r.success)
    const hasWarnings =
      result.warnings.length > 0 ||
      contentResults.some(r => r.warnings.length > 0)

    if (allSuccess) {
      cliOk(
        hasWarnings
          ? `${figures.tick} Перевірку пройдено з попередженнями`
          : `${figures.tick} Перевірку пройдено`,
      )
    } else {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`${figures.cross} Перевірку не пройдено`)
      process.exit(1)
    }
  } catch (error) {
    logError(error)
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.error(
      `${figures.cross} Неочікувана помилка під час перевірки: ${errorMessage(error)}`,
    )
    process.exit(2)
  }
}

// plugin list (lines 5217–5416)
export async function pluginListHandler(options: {
  json?: boolean
  available?: boolean
  cowork?: boolean
}): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  logEvent('tengu_plugin_list_command', {})

  const installedData = loadInstalledPluginsV2()
  const { getPluginEditableScopes } = await import(
    '../../utils/plugins/pluginStartupCheck.js'
  )
  const enabledPlugins = getPluginEditableScopes()

  const pluginIds = Object.keys(installedData.plugins)

  // Load all plugins once. The JSON and human paths both need:
  //  - loadErrors (to show load failures per plugin)
  //  - inline plugins (session-only via --plugin-dir, source='name@inline')
  //    which are NOT in installedData.plugins (V2 bookkeeping) — they must
  //    be surfaced separately or `plugin list` silently ignores --plugin-dir.
  const {
    enabled: loadedEnabled,
    disabled: loadedDisabled,
    errors: loadErrors,
  } = await loadAllPlugins()
  const allLoadedPlugins = [...loadedEnabled, ...loadedDisabled]
  const inlinePlugins = allLoadedPlugins.filter(p =>
    p.source.endsWith('@inline'),
  )
  // Path-level inline failures (dir doesn't exist, parse error before
  // manifest is read) use source='inline[N]'. Plugin-level errors after
  // manifest read use source='name@inline'. Collect both for the session
  // section — these are otherwise invisible since they have no pluginId.
  const inlineLoadErrors = loadErrors.filter(
    e => e.source.endsWith('@inline') || e.source.startsWith('inline['),
  )

  if (options.json) {
    // Create a map of plugin source to loaded plugin for quick lookup
    const loadedPluginMap = new Map(allLoadedPlugins.map(p => [p.source, p]))

    const plugins: Array<{
      id: string
      version: string
      scope: string
      enabled: boolean
      installPath: string
      installedAt?: string
      lastUpdated?: string
      projectPath?: string
      mcpServers?: Record<string, unknown>
      errors?: string[]
    }> = []

    for (const pluginId of pluginIds.sort()) {
      const installations = installedData.plugins[pluginId]
      if (!installations || installations.length === 0) continue

      // Find loading errors for this plugin
      const pluginName = parsePluginIdentifier(pluginId).name
      const pluginErrors = loadErrors
        .filter(
          e =>
            e.source === pluginId || ('plugin' in e && e.plugin === pluginName),
        )
        .map(getPluginErrorMessage)

      for (const installation of installations) {
        // Try to find the loaded plugin to get MCP servers
        const loadedPlugin = loadedPluginMap.get(pluginId)
        let mcpServers: Record<string, unknown> | undefined

        if (loadedPlugin) {
          // Load MCP servers if not already cached
          const servers =
            loadedPlugin.mcpServers ||
            (await loadPluginMcpServers(loadedPlugin))
          if (servers && Object.keys(servers).length > 0) {
            mcpServers = servers
          }
        }

        plugins.push({
          id: pluginId,
          version: installation.version || 'unknown',
          scope: installation.scope,
          enabled: enabledPlugins.has(pluginId),
          installPath: installation.installPath,
          installedAt: installation.installedAt,
          lastUpdated: installation.lastUpdated,
          projectPath: installation.projectPath,
          mcpServers,
          errors: pluginErrors.length > 0 ? pluginErrors : undefined,
        })
      }
    }

    // Session-only plugins: scope='session', no install metadata.
    // Filter from inlineLoadErrors (not loadErrors) so an installed plugin
    // with the same manifest name doesn't cross-contaminate via e.plugin.
    // The e.plugin fallback catches the dirName≠manifestName case:
    // createPluginFromPath tags errors with `${dirName}@inline` but
    // plugin.source is reassigned to `${manifest.name}@inline` afterward
    // (pluginLoader.ts loadInlinePlugins), so e.source !== p.source when
    // a dev checkout dir like ~/code/my-fork/ has manifest name 'cool-plugin'.
    for (const p of inlinePlugins) {
      const servers = p.mcpServers || (await loadPluginMcpServers(p))
      const pErrors = inlineLoadErrors
        .filter(
          e => e.source === p.source || ('plugin' in e && e.plugin === p.name),
        )
        .map(getPluginErrorMessage)
      plugins.push({
        id: p.source,
        version: p.manifest.version ?? 'unknown',
        scope: 'session',
        enabled: p.enabled !== false,
        installPath: p.path,
        mcpServers:
          servers && Object.keys(servers).length > 0 ? servers : undefined,
        errors: pErrors.length > 0 ? pErrors : undefined,
      })
    }
    // Path-level inline failures (--plugin-dir /nonexistent): no LoadedPlugin
    // exists so the loop above can't surface them. Mirror the human-path
    // handling so JSON consumers see the failure instead of silent omission.
    for (const e of inlineLoadErrors.filter(e =>
      e.source.startsWith('inline['),
    )) {
      plugins.push({
        id: e.source,
        version: 'unknown',
        scope: 'session',
        enabled: false,
        installPath: 'path' in e ? e.path : '',
        errors: [getPluginErrorMessage(e)],
      })
    }

    // If --available is set, also load available plugins from marketplaces
    if (options.available) {
      const available: Array<{
        pluginId: string
        name: string
        description?: string
        marketplaceName: string
        version?: string
        source: PluginSource
        installCount?: number
      }> = []

      try {
        const [config, installCounts] = await Promise.all([
          loadKnownMarketplacesConfig(),
          getInstallCounts(),
        ])
        const { marketplaces } =
          await loadMarketplacesWithGracefulDegradation(config)

        for (const {
          name: marketplaceName,
          data: marketplace,
        } of marketplaces) {
          if (marketplace) {
            for (const entry of marketplace.plugins) {
              const pluginId = createPluginId(entry.name, marketplaceName)
              // Only include plugins that are not already installed
              if (!isPluginInstalled(pluginId)) {
                available.push({
                  pluginId,
                  name: entry.name,
                  description: entry.description,
                  marketplaceName,
                  version: entry.version,
                  source: entry.source,
                  installCount: installCounts?.get(pluginId),
                })
              }
            }
          }
        }
      } catch {
        // Silently ignore marketplace loading errors
      }

      cliOk(jsonStringify({ installed: plugins, available }, null, 2))
    } else {
      cliOk(jsonStringify(plugins, null, 2))
    }
  }

  if (pluginIds.length === 0 && inlinePlugins.length === 0) {
    // inlineLoadErrors can exist with zero inline plugins (e.g. --plugin-dir
    // points at a nonexistent path). Don't early-exit over them — fall
    // through to the session section so the failure is visible.
    if (inlineLoadErrors.length === 0) {
      cliOk(
        'Плагіни не встановлено. Використайте `nnc plugin install` для встановлення плагіна.',
      )
    }
  }

  if (pluginIds.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Встановлені плагіни:\n')
  }

  for (const pluginId of pluginIds.sort()) {
    const installations = installedData.plugins[pluginId]
    if (!installations || installations.length === 0) continue

    // Find loading errors for this plugin
    const pluginName = parsePluginIdentifier(pluginId).name
    const pluginErrors = loadErrors.filter(
      e => e.source === pluginId || ('plugin' in e && e.plugin === pluginName),
    )

    for (const installation of installations) {
      const isEnabled = enabledPlugins.has(pluginId)
      const status =
        pluginErrors.length > 0
          ? `${figures.cross} не вдалося завантажити`
          : isEnabled
            ? `${figures.tick} увімкнено`
            : `${figures.cross} вимкнено`
      const version = installation.version || 'невідомо'
      const scope = installation.scope

      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${figures.pointer} ${pluginId}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Версія: ${version}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Область: ${scope}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Статус: ${status}`)
      for (const error of pluginErrors) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    Помилка: ${getPluginErrorMessage(error)}`)
      }
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('')
    }
  }

  if (inlinePlugins.length > 0 || inlineLoadErrors.length > 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Плагіни лише для сесії (--plugin-dir):\n')
    for (const p of inlinePlugins) {
      // Same dirName≠manifestName fallback as the JSON path above — error
      // sources use the dir basename but p.source uses the manifest name.
      const pErrors = inlineLoadErrors.filter(
        e => e.source === p.source || ('plugin' in e && e.plugin === p.name),
      )
      const status =
        pErrors.length > 0
          ? `${figures.cross} завантажено з помилками`
          : `${figures.tick} завантажено`
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${figures.pointer} ${p.source}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Версія: ${p.manifest.version ?? 'невідомо'}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Шлях: ${p.path}`)
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`    Статус: ${status}`)
      for (const e of pErrors) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    Помилка: ${getPluginErrorMessage(e)}`)
      }
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('')
    }
    // Path-level failures: no LoadedPlugin object exists. Show them so
    // `--plugin-dir /typo` doesn't just silently produce nothing.
    for (const e of inlineLoadErrors.filter(e =>
      e.source.startsWith('inline['),
    )) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(
        `  ${figures.pointer} ${e.source}: ${figures.cross} ${getPluginErrorMessage(e)}\n`,
      )
    }
  }

  cliOk()
}

// marketplace add (lines 5433–5487)
export async function marketplaceAddHandler(
  source: string,
  options: { cowork?: boolean; sparse?: string[]; scope?: string },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    const parsed = await parseMarketplaceInput(source)

    if (!parsed) {
      cliError(
        `${figures.cross} Невірний формат джерела marketplace. Спробуйте: owner/repo, https://..., або ./path`,
      )
    }

    if ('error' in parsed) {
      cliError(`${figures.cross} ${parsed.error}`)
    }

    // Validate scope
    const scope = options.scope ?? 'user'
    if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
      cliError(
        `${figures.cross} Невірна область '${scope}'. Використайте: user, project, або local`,
      )
    }
    const settingSource = scopeToSettingSource(scope)

    let marketplaceSource = parsed

    if (options.sparse && options.sparse.length > 0) {
      if (
        marketplaceSource.source === 'github' ||
        marketplaceSource.source === 'git'
      ) {
        marketplaceSource = {
          ...marketplaceSource,
          sparsePaths: options.sparse,
        }
      } else {
        cliError(
          `${figures.cross} --sparse підтримується лише для github та git джерел marketplace (отримано: ${marketplaceSource.source})`,
        )
      }
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Додаємо marketplace...')

    const { name, alreadyMaterialized, resolvedSource } =
      await addMarketplaceSource(marketplaceSource, message => {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(message)
      })

    // Write intent to settings at the requested scope
    saveMarketplaceToSettings(name, { source: resolvedSource }, settingSource)

    clearAllCaches()

    let sourceType = marketplaceSource.source
    if (marketplaceSource.source === 'github') {
      sourceType =
        marketplaceSource.repo as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
    logEvent('tengu_marketplace_added', {
      source_type:
        sourceType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    cliOk(
      alreadyMaterialized
        ? `${figures.tick} Marketplace '${name}' вже на диску — оголошено у ${scope} налаштуваннях`
        : `${figures.tick} Успішно додано marketplace: ${name} (оголошено у ${scope} налаштуваннях)`,
    )
  } catch (error) {
    handleMarketplaceError(error, 'додати marketplace')
  }
}

// marketplace list (lines 5497–5565)
export async function marketplaceListHandler(options: {
  json?: boolean
  cowork?: boolean
}): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    const config = await loadKnownMarketplacesConfig()
    const names = Object.keys(config)

    if (options.json) {
      const marketplaces = names.sort().map(name => {
        const marketplace = config[name]
        const source = marketplace?.source
        return {
          name,
          source: source?.source,
          ...(source?.source === 'github' && { repo: source.repo }),
          ...(source?.source === 'git' && { url: source.url }),
          ...(source?.source === 'url' && { url: source.url }),
          ...(source?.source === 'directory' && { path: source.path }),
          ...(source?.source === 'file' && { path: source.path }),
          installLocation: marketplace?.installLocation,
        }
      })
      cliOk(jsonStringify(marketplaces, null, 2))
    }

    if (names.length === 0) {
      cliOk('Marketplaces не налаштовано')
    }

    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Налаштовані marketplaces:\n')
    names.forEach(name => {
      const marketplace = config[name]
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  ${figures.pointer} ${name}`)

      if (marketplace?.source) {
        const src = marketplace.source
        if (src.source === 'github') {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`    Джерело: GitHub (${src.repo})`)
        } else if (src.source === 'git') {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`    Джерело: Git (${src.url})`)
        } else if (src.source === 'url') {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`    Джерело: URL (${src.url})`)
        } else if (src.source === 'directory') {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`    Джерело: Директорія (${src.path})`)
        } else if (src.source === 'file') {
          // biome-ignore lint/suspicious/noConsole:: intentional console output
          console.log(`    Джерело: Файл (${src.path})`)
        }
      }
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('')
    })

    cliOk()
  } catch (error) {
    handleMarketplaceError(error, 'отримати список marketplaces')
  }
}

// marketplace remove (lines 5576–5598)
export async function marketplaceRemoveHandler(
  name: string,
  options: { cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    await removeMarketplaceSource(name)
    clearAllCaches()

    logEvent('tengu_marketplace_removed', {
      marketplace_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    cliOk(`${figures.tick} Успішно видалено marketplace: ${name}`)
  } catch (error) {
    handleMarketplaceError(error, 'видалити marketplace')
  }
}

// marketplace update (lines 5609–5672)
export async function marketplaceUpdateHandler(
  name: string | undefined,
  options: { cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  try {
    if (name) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`Оновлюємо marketplace: ${name}...`)

      await refreshMarketplace(name, message => {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(message)
      })

      clearAllCaches()

      logEvent('tengu_marketplace_updated', {
        marketplace_name:
          name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      cliOk(`${figures.tick} Успішно оновлено marketplace: ${name}`)
    } else {
      const config = await loadKnownMarketplacesConfig()
      const marketplaceNames = Object.keys(config)

      if (marketplaceNames.length === 0) {
        cliOk('Marketplaces не налаштовано')
      }

      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`Оновлюємо ${marketplaceNames.length} marketplace(s)...`)

      await refreshAllMarketplaces()
      clearAllCaches()

      logEvent('tengu_marketplace_updated_all', {
        count:
          marketplaceNames.length as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      cliOk(
        `${figures.tick} Успішно оновлено ${marketplaceNames.length} marketplace(s)`,
      )
    }
  } catch (error) {
    handleMarketplaceError(error, 'оновити marketplace(s)')
  }
}

// plugin install (lines 5690–5721)
export async function pluginInstallHandler(
  plugin: string,
  options: { scope?: string; cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  const scope = options.scope || 'user'
  if (options.cowork && scope !== 'user') {
    cliError('--cowork можна використовувати лише з user scope')
  }
  if (
    !VALID_INSTALLABLE_SCOPES.includes(
      scope as (typeof VALID_INSTALLABLE_SCOPES)[number],
    )
  ) {
    cliError(
      `Невірна область: ${scope}. Має бути одне з: ${VALID_INSTALLABLE_SCOPES.join(', ')}.`,
    )
  }
  // _PROTO_* routes to PII-tagged plugin_name/marketplace_name BQ columns.
  // Unredacted plugin arg was previously logged to general-access
  // additional_metadata for all users — dropped in favor of the privileged
  // column route. marketplace may be undefined (fires before resolution).
  const { name, marketplace } = parsePluginIdentifier(plugin)
  logEvent('tengu_plugin_install_command', {
    _PROTO_plugin_name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    ...(marketplace && {
      _PROTO_marketplace_name:
        marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    }),
    scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  await installPlugin(plugin, scope as 'user' | 'project' | 'local')
}

// plugin uninstall (lines 5738–5769)
export async function pluginUninstallHandler(
  plugin: string,
  options: { scope?: string; cowork?: boolean; keepData?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  const scope = options.scope || 'user'
  if (options.cowork && scope !== 'user') {
    cliError('--cowork можна використовувати лише з user scope')
  }
  if (
    !VALID_INSTALLABLE_SCOPES.includes(
      scope as (typeof VALID_INSTALLABLE_SCOPES)[number],
    )
  ) {
    cliError(
      `Невірна область: ${scope}. Має бути одне з: ${VALID_INSTALLABLE_SCOPES.join(', ')}.`,
    )
  }
  const { name, marketplace } = parsePluginIdentifier(plugin)
  logEvent('tengu_plugin_uninstall_command', {
    _PROTO_plugin_name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    ...(marketplace && {
      _PROTO_marketplace_name:
        marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    }),
    scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  await uninstallPlugin(
    plugin,
    scope as 'user' | 'project' | 'local',
    options.keepData,
  )
}

// plugin enable (lines 5783–5818)
export async function pluginEnableHandler(
  plugin: string,
  options: { scope?: string; cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  let scope: (typeof VALID_INSTALLABLE_SCOPES)[number] | undefined
  if (options.scope) {
    if (
      !VALID_INSTALLABLE_SCOPES.includes(
        options.scope as (typeof VALID_INSTALLABLE_SCOPES)[number],
      )
    ) {
      cliError(
        `Невірна область "${options.scope}". Допустимі області: ${VALID_INSTALLABLE_SCOPES.join(', ')}`,
      )
    }
    scope = options.scope as (typeof VALID_INSTALLABLE_SCOPES)[number]
  }
  if (options.cowork && scope !== undefined && scope !== 'user') {
    cliError('--cowork can only be used with user scope')
  }

  // --cowork always operates at user scope
  if (options.cowork && scope === undefined) {
    scope = 'user'
  }

  const { name, marketplace } = parsePluginIdentifier(plugin)
  logEvent('tengu_plugin_enable_command', {
    _PROTO_plugin_name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    ...(marketplace && {
      _PROTO_marketplace_name:
        marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    }),
    scope: (scope ??
      'auto') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  await enablePlugin(plugin, scope)
}

// plugin disable (lines 5833–5902)
export async function pluginDisableHandler(
  plugin: string | undefined,
  options: { scope?: string; cowork?: boolean; all?: boolean },
): Promise<void> {
  if (options.all && plugin) {
    cliError('Не можна використовувати --all з конкретним плагіном')
  }

  if (!options.all && !plugin) {
    cliError('Вкажіть назву плагіна або використайте --all, щоб вимкнути всі плагіни')
  }

  if (options.cowork) setUseCoworkPlugins(true)

  if (options.all) {
    if (options.scope) {
      cliError('Не можна використовувати --scope з --all')
    }

    // No _PROTO_plugin_name here — --all disables all plugins.
    // Distinguishable from the specific-plugin branch by plugin_name IS NULL.
    logEvent('tengu_plugin_disable_command', {})

    await disableAllPlugins()
    return
  }

  let scope: (typeof VALID_INSTALLABLE_SCOPES)[number] | undefined
  if (options.scope) {
    if (
      !VALID_INSTALLABLE_SCOPES.includes(
        options.scope as (typeof VALID_INSTALLABLE_SCOPES)[number],
      )
    ) {
      cliError(
        `Невірна область "${options.scope}". Допустимі області: ${VALID_INSTALLABLE_SCOPES.join(', ')}`,
      )
    }
    scope = options.scope as (typeof VALID_INSTALLABLE_SCOPES)[number]
  }
  if (options.cowork && scope !== undefined && scope !== 'user') {
    cliError('--cowork can only be used with user scope')
  }

  // --cowork always operates at user scope
  if (options.cowork && scope === undefined) {
    scope = 'user'
  }

  const { name, marketplace } = parsePluginIdentifier(plugin!)
  logEvent('tengu_plugin_disable_command', {
    _PROTO_plugin_name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    ...(marketplace && {
      _PROTO_marketplace_name:
        marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    }),
    scope: (scope ??
      'auto') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  await disablePlugin(plugin!, scope)
}

// plugin update (lines 5918–5948)
export async function pluginUpdateHandler(
  plugin: string,
  options: { scope?: string; cowork?: boolean },
): Promise<void> {
  if (options.cowork) setUseCoworkPlugins(true)
  const { name, marketplace } = parsePluginIdentifier(plugin)
  logEvent('tengu_plugin_update_command', {
    _PROTO_plugin_name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    ...(marketplace && {
      _PROTO_marketplace_name:
        marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    }),
  })

  let scope: (typeof VALID_UPDATE_SCOPES)[number] = 'user'
  if (options.scope) {
    if (
      !VALID_UPDATE_SCOPES.includes(
        options.scope as (typeof VALID_UPDATE_SCOPES)[number],
      )
    ) {
      cliError(
        `Невірна область "${options.scope}". Допустимі області: ${VALID_UPDATE_SCOPES.join(', ')}`,
      )
    }
    scope = options.scope as (typeof VALID_UPDATE_SCOPES)[number]
  }
  if (options.cowork && scope !== 'user') {
    cliError('--cowork можна використовувати лише з user scope')
  }

  await updatePluginCli(plugin, scope)
}
