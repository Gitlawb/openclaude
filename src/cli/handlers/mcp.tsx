/**
 * MCP subcommand handlers — extracted from main.tsx for lazy loading.
 * These are dynamically imported only when the corresponding `nnc mcp *` command runs.
 */

import { stat } from 'fs/promises';
import pMap from 'p-map';
import { cwd } from 'process';
import React from 'react';
import { MCPServerDesktopImportDialog } from '../../components/MCPServerDesktopImportDialog.js';
import { render } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import {
  clearMcpClientConfig,
  clearServerTokensFromSecureStorage,
  readClientSecret,
  saveMcpClientSecret,
} from '../../services/mcp/auth.js'
import { doctorAllServers, doctorServer, type McpDoctorReport, type McpDoctorScopeFilter } from '../../services/mcp/doctor.js';
import { connectToServer, getMcpServerConnectionBatchSize } from '../../services/mcp/client.js';
import { addMcpConfig, getAllMcpConfigs, getMcpConfigByName, getMcpConfigsByScope, removeMcpConfig } from '../../services/mcp/config.js';
import type { ConfigScope, ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath, ensureConfigScope, getScopeLabel } from '../../services/mcp/utils.js';
import { AppStateProvider } from '../../state/AppState.js';
import { getCurrentProjectConfig, getGlobalConfig, saveCurrentProjectConfig } from '../../utils/config.js';
import { isFsInaccessible } from '../../utils/errors.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { safeParseJSON } from '../../utils/json.js';
import { getPlatform } from '../../utils/platform.js';
import { cliError, cliOk } from '../exit.js';

function formatDoctorReport(report: McpDoctorReport): string {
  const lines: string[] = []
  lines.push('MCP Діагностика')
  lines.push('')
  lines.push('Підсумок')
  lines.push(`- ${report.summary.totalReports} звітів серверів згенеровано`)
  lines.push(`- ${report.summary.healthy} робочих`)
  lines.push(`- ${report.summary.warnings} попереджень`)
  lines.push(`- ${report.summary.blocking} блокуючих проблем`)

  if (report.targetName) {
    lines.push(`- ціль: ${report.targetName}`)
  }

  for (const server of report.servers) {
    lines.push('')
    lines.push(server.serverName)

    const activeDefinition = server.definitions.find(definition => definition.runtimeActive)
    if (activeDefinition) {
      lines.push(`- Активне джерело: ${activeDefinition.sourceType}`)
      lines.push(`- Транспорт: ${activeDefinition.transport ?? 'невідомо'}`)
    }

    if (server.definitions.length > 1) {
      const extraDefinitions = server.definitions
        .filter(definition => !definition.runtimeActive)
        .map(definition => definition.sourceType)
      if (extraDefinitions.length > 0) {
        lines.push(`- Додаткові визначення: ${extraDefinitions.join(', ')}`)
      }
    }

    if (server.liveCheck.result) {
      const stateLikeResults = new Set(['disabled', 'pending', 'skipped'])
      const label = stateLikeResults.has(server.liveCheck.result)
        ? 'Стан'
        : 'Перевірка онлайн'
      lines.push(`- ${label}: ${server.liveCheck.result}`)
    }

    if (server.liveCheck.error) {
      lines.push(`- Помилка: ${server.liveCheck.error}`)
    }

    for (const finding of server.findings) {
      lines.push(`- ${finding.message}`)
      if (finding.remediation) {
        lines.push(`- Виправлення: ${finding.remediation}`)
      }
    }
  }

  if (report.findings.length > 0) {
    lines.push('')
    lines.push('Глобальні знахідки')
    for (const finding of report.findings) {
      lines.push(`- ${finding.message}`)
      if (finding.remediation) {
        lines.push(`- Виправлення: ${finding.remediation}`)
      }
    }
  }

  return lines.join('\n')
}

export async function mcpDoctorHandler(name: string | undefined, options: {
  scope?: string;
  configOnly?: boolean;
  json?: boolean;
}): Promise<void> {
  try {
    const scopeFilter = options.scope ? ensureConfigScope(options.scope) as McpDoctorScopeFilter : undefined
    const configOnly = !!options.configOnly
    const report = name
      ? await doctorServer(name, { configOnly, scopeFilter })
      : await doctorAllServers({ configOnly, scopeFilter })

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatDoctorReport(report)}\n`)
    }

    // On Windows, exiting immediately after a single failed HTTP MCP health check
    // can trip a libuv assertion while async handle shutdown is still settling.
    // Let the event loop drain briefly before exiting this one-shot command.
    await new Promise(resolve => setTimeout(resolve, 50))
    process.exit(report.summary.blocking > 0 ? 1 : 0)
    return
  } catch (error) {
    cliError((error as Error).message)
  }
}
async function checkMcpServerHealth(name: string, server: ScopedMcpServerConfig): Promise<string> {
  try {
    const result = await connectToServer(name, server);
    if (result.type === 'connected') {
      return '✓ Підключено';
    } else if (result.type === 'needs-auth') {
      return '! Потрібна автентифікація';
    } else {
      return '✗ Не вдалося підключитись';
    }
  } catch (_error) {
    return '✗ Помилка підключення';
  }
}

// mcp serve (lines 4512–4532)
export async function mcpServeHandler({
  debug,
  verbose
}: {
  debug?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const providedCwd = cwd();
  logEvent('tengu_mcp_start', {});
  try {
    await stat(providedCwd);
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(`Помилка: Директорія ${providedCwd} не існує`);
    }
    throw error;
  }
  try {
    const {
      setup
    } = await import('../../setup.js');
    await setup(providedCwd, 'default', false, false, undefined, false);
    const {
      startMCPServer
    } = await import('../../entrypoints/mcp.js');
    await startMCPServer(providedCwd, debug ?? false, verbose ?? false);
  } catch (error) {
    cliError(`Помилка: Не вдалося запустити MCP сервер: ${error}`);
  }
}

// mcp remove (lines 4545–4635)
export async function mcpRemoveHandler(name: string, options: {
  scope?: string;
}): Promise<void> {
  // Look up config before removing so we can clean up secure storage
  const serverBeforeRemoval = getMcpConfigByName(name);
  const cleanupSecureStorage = () => {
    if (serverBeforeRemoval && (serverBeforeRemoval.type === 'sse' || serverBeforeRemoval.type === 'http')) {
      clearServerTokensFromSecureStorage(name, serverBeforeRemoval);
      clearMcpClientConfig(name, serverBeforeRemoval);
    }
  };
  try {
    if (options.scope) {
      const scope = ensureConfigScope(options.scope);
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Видалено MCP сервер ${name} з ${scope} конфігу\n`);
      cliOk(`Файл змінено: ${describeMcpConfigFilePath(scope)}`);
    }

    // If no scope specified, check where the server exists
    const projectConfig = getCurrentProjectConfig();
    const globalConfig = getGlobalConfig();

    // Check if server exists in project scope (.mcp.json)
    const {
      servers: projectServers
    } = getMcpConfigsByScope('project');
    const mcpJsonExists = !!projectServers[name];

    // Count how many scopes contain this server
    const scopes: Array<Exclude<ConfigScope, 'dynamic'>> = [];
    if (projectConfig.mcpServers?.[name]) scopes.push('local');
    if (mcpJsonExists) scopes.push('project');
    if (globalConfig.mcpServers?.[name]) scopes.push('user');
    if (scopes.length === 0) {
      cliError(`MCP сервер з назвою "${name}" не знайдено`);
    } else if (scopes.length === 1) {
      // Server exists in only one scope, remove it
      const scope = scopes[0]!;
      logEvent('tengu_mcp_delete', {
        name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      await removeMcpConfig(name, scope);
      cleanupSecureStorage();
      process.stdout.write(`Видалено MCP сервер "${name}" з ${scope} конфігу\n`);
      cliOk(`Файл змінено: ${describeMcpConfigFilePath(scope)}`);
    } else {
      // Server exists in multiple scopes
      process.stderr.write(`MCP сервер "${name}" існує в кількох областях:\n`);
      scopes.forEach(scope => {
        process.stderr.write(`  - ${getScopeLabel(scope)} (${describeMcpConfigFilePath(scope)})\n`);
      });
      process.stderr.write('\nЩоб видалити з конкретної області, використайте:\n');
      scopes.forEach(scope => {
        process.stderr.write(`  nnc mcp remove "${name}" -s ${scope}\n`);
      });
      cliError();
    }
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp list (lines 4641–4688)
export async function mcpListHandler(): Promise<void> {
  logEvent('tengu_mcp_list', {});
  const {
    servers: configs
  } = await getAllMcpConfigs();
  if (Object.keys(configs).length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('MCP серверів не налаштовано. Використайте `nnc mcp add`, щоб додати сервер.');
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('Перевіряємо стан MCP серверів...\n');

    // Check servers concurrently
    const entries = Object.entries(configs);
    const results = await pMap(entries, async ([name, server]) => ({
      name,
      server,
      status: await checkMcpServerHealth(name, server)
    }), {
      concurrency: getMcpServerConnectionBatchSize()
    });
    for (const {
      name,
      server,
      status
    } of results) {
      // Intentionally excluding sse-ide servers here since they're internal
      if (server.type === 'sse') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (SSE) - ${status}`);
      } else if (server.type === 'http') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} (HTTP) - ${status}`);
      } else if (server.type === 'claudeai-proxy') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.url} - ${status}`);
      } else if (!server.type || server.type === 'stdio') {
        const args = Array.isArray(server.args) ? server.args : [];
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`${name}: ${server.command} ${args.join(' ')} - ${status}`);
      }
    }
  }
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp get (lines 4694–4786)
export async function mcpGetHandler(name: string): Promise<void> {
  logEvent('tengu_mcp_get', {
    name: name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  const server = getMcpConfigByName(name);
  if (!server) {
    cliError(`MCP сервер з назвою ${name} не знайдено`);
  }

  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`${name}:`);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Область: ${getScopeLabel(server.scope)}`);

  // Check server health
  const status = await checkMcpServerHealth(name, server);
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`  Статус: ${status}`);

  // Intentionally excluding sse-ide servers here since they're internal
  if (server.type === 'sse') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Тип: sse`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Заголовки:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('oauth клієнт налаштовано');
      }
      if (server.oauth.callbackPort) parts.push('callback порт налаштовано');
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'http') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Тип: http`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  URL: ${server.url}`);
    if (server.headers) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Заголовки:');
      for (const [key, value] of Object.entries(server.headers)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}: ${value}`);
      }
    }
    if (server.oauth?.clientId || server.oauth?.callbackPort) {
      const parts: string[] = [];
      if (server.oauth.clientId) {
        parts.push('oauth клієнт налаштовано');
      }
      if (server.oauth.callbackPort) parts.push('callback порт налаштовано');
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log(`  OAuth: ${parts.join(', ')}`);
    }
  } else if (server.type === 'stdio') {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Тип: stdio`);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Команда: ${server.command}`);
    const args = Array.isArray(server.args) ? server.args : [];
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`  Аргументи: ${args.join(' ')}`);
    if (server.env) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.log('  Середовище:');
      for (const [key, value] of Object.entries(server.env)) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(`    ${key}=${value}`);
      }
    }
  }
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.log(`\nЩоб видалити цей сервер, запустіть: nnc mcp remove "${name}" -s ${server.scope}`);
  // Use gracefulShutdown to properly clean up MCP server connections
  // (process.exit bypasses cleanup handlers, leaving child processes orphaned)
  await gracefulShutdown(0);
}

// mcp add-json (lines 4801–4870)
export async function mcpAddJsonHandler(name: string, json: string, options: {
  scope?: string;
  clientSecret?: true;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const parsedJson = safeParseJSON(json);

    // Read secret before writing config so cancellation doesn't leave partial state
    const needsSecret = options.clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string' && 'oauth' in parsedJson && parsedJson.oauth && typeof parsedJson.oauth === 'object' && 'clientId' in parsedJson.oauth;
    const clientSecret = needsSecret ? await readClientSecret() : undefined;
    await addMcpConfig(name, parsedJson, scope);
    const transportType = parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson ? String(parsedJson.type || 'stdio') : 'stdio';
    if (clientSecret && parsedJson && typeof parsedJson === 'object' && 'type' in parsedJson && (parsedJson.type === 'sse' || parsedJson.type === 'http') && 'url' in parsedJson && typeof parsedJson.url === 'string') {
      saveMcpClientSecret(name, {
        type: parsedJson.type,
        url: parsedJson.url
      }, clientSecret);
    }
    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'json' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      type: transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    cliOk(`Додано ${transportType} MCP сервер ${name} у ${scope} конфіг`);
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp add-from-claude-desktop (lines 4881–4927)
export async function mcpAddFromDesktopHandler(options: {
  scope?: string;
}): Promise<void> {
  try {
    const scope = ensureConfigScope(options.scope);
    const platform = getPlatform();
    logEvent('tengu_mcp_add', {
      scope: scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      platform: platform as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source: 'desktop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    const {
      readClaudeDesktopMcpServers
    } = await import('../../utils/claudeDesktop.js');
    const servers = await readClaudeDesktopMcpServers();
    if (Object.keys(servers).length === 0) {
      cliOk('У конфігурації Claude Desktop не знайдено MCP серверів або файл конфігурації не існує.');
    }
    const {
      unmount
    } = await render(<AppStateProvider>
        <KeybindingSetup>
          <MCPServerDesktopImportDialog servers={servers} scope={scope} onDone={() => {
          unmount();
        }} />
        </KeybindingSetup>
      </AppStateProvider>, {
      exitOnCtrlC: true
    });
  } catch (error) {
    cliError((error as Error).message);
  }
}

// mcp reset-project-choices (lines 4935–4952)
export async function mcpResetChoicesHandler(): Promise<void> {
  logEvent('tengu_mcp_reset_mcpjson_choices', {});
  saveCurrentProjectConfig(current => ({
    ...current,
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    enableAllProjectMcpServers: false
  }));
  cliOk('Усі підтвердження та відмови серверів проєктного рівня (.mcp.json) було скинуто.\n' + 'При наступному запуску Нейромережі ви отримаєте запит на підтвердження.');
}
