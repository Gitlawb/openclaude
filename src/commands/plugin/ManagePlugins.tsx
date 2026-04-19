import figures from 'figures';
import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { MCPRemoteServerMenu } from '../../components/mcp/MCPRemoteServerMenu.js';
import { MCPStdioServerMenu } from '../../components/mcp/MCPStdioServerMenu.js';
import { MCPToolDetailView } from '../../components/mcp/MCPToolDetailView.js';
import { MCPToolListView } from '../../components/mcp/MCPToolListView.js';
import type { ClaudeAIServerInfo, HTTPServerInfo, SSEServerInfo, StdioServerInfo } from '../../components/mcp/types.js';
import { SearchBox } from '../../components/SearchBox.js';
import { useSearchInput } from '../../hooks/useSearchInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
import { Box, Text, useInput, useTerminalFocus } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { getBuiltinPluginDefinition } from '../../plugins/builtinPlugins.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import type { MCPServerConnection, McpClaudeAIProxyServerConfig, McpHTTPServerConfig, McpSSEServerConfig, McpStdioServerConfig } from '../../services/mcp/types.js';
import { filterToolsByServer } from '../../services/mcp/utils.js';
import { disablePluginOp, enablePluginOp, getPluginInstallationFromV2, isInstallableScope, isPluginEnabledAtProjectScope, uninstallPluginOp, updatePluginOp } from '../../services/plugins/pluginOperations.js';
import { useAppState } from '../../state/AppState.js';
import type { Tool } from '../../Tool.js';
import type { LoadedPlugin, PluginError } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { openBrowser } from '../../utils/browser.js';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage, toError } from '../../utils/errors.js';
import { logError } from '../../utils/log.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
import { getMarketplace } from '../../utils/plugins/marketplaceManager.js';
import { isMcpbSource, loadMcpbFile, type McpbNeedsConfigResult, type UserConfigValues } from '../../utils/plugins/mcpbHandler.js';
import { getPluginDataDirSize, pluginDataDirPath } from '../../utils/plugins/pluginDirectories.js';
import { markFlaggedPluginsSeen, removeFlaggedPlugin } from '../../utils/plugins/pluginFlagging.js';
import { type PersistablePluginScope, parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { loadPluginOptions, type PluginOptionSchema, savePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js';
import { isPluginBlockedByPolicy } from '../../utils/plugins/pluginPolicy.js';
import { getSettings_DEPRECATED, getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { jsonParse } from '../../utils/slowOperations.js';
import { plural } from '../../utils/stringUtils.js';
import { formatErrorMessage, getErrorGuidance } from './PluginErrors.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';
import { PluginOptionsFlow } from './PluginOptionsFlow.js';
import type { ViewState as ParentViewState } from './types.js';
import { UnifiedInstalledCell } from './UnifiedInstalledCell.js';
import type { UnifiedInstalledItem } from './unifiedTypes.js';
import { usePagination } from './usePagination.js';
import { useUnifiedItems } from './useUnifiedItems.js';
type Props = {
  setViewState: (state: ParentViewState) => void;
  setResult: (result: string | null) => void;
  onManageComplete?: () => void | Promise<void>;
  onSearchModeChange?: (isActive: boolean) => void;
  targetPlugin?: string;
  targetMarketplace?: string;
  action?: 'enable' | 'disable' | 'uninstall';
};
type FlaggedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  reason: string;
  text: string;
  flaggedAt: string;
};
type FailedPluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  errors: PluginError[];
  scope: PersistablePluginScope;
};
type ViewState = 'plugin-list' | 'plugin-details' | 'configuring' | {
  type: 'plugin-options';
} | {
  type: 'configuring-options';
  schema: PluginOptionSchema;
} | 'confirm-project-uninstall' | {
  type: 'confirm-data-cleanup';
  size: {
    bytes: number;
    human: string;
  };
} | {
  type: 'flagged-detail';
  plugin: FlaggedPluginInfo;
} | {
  type: 'failed-plugin-details';
  plugin: FailedPluginInfo;
} | {
  type: 'mcp-detail';
  client: MCPServerConnection;
} | {
  type: 'mcp-tools';
  client: MCPServerConnection;
} | {
  type: 'mcp-tool-detail';
  client: MCPServerConnection;
  tool: Tool;
};
type MarketplaceInfo = {
  name: string;
  installedPlugins: LoadedPlugin[];
  enabledCount?: number;
  disabledCount?: number;
};
type PluginState = {
  plugin: LoadedPlugin;
  marketplace: string;
  scope?: 'user' | 'project' | 'local' | 'managed' | 'builtin';
  pendingEnable?: boolean; // Toggle enable/disable
  pendingUpdate?: boolean; // Marked for update
};

/**
 * Get list of base file names (without .md extension) from a directory
 * @param dirPath The directory path to list files from
 * @returns Array of base file names without .md extension
 * @example
 * // Given directory contains: agent-sdk-verifier-py.md, agent-sdk-verifier-ts.md, README.txt
 * await getBaseFileNames('/path/to/agents')
 * // Returns: ['agent-sdk-verifier-py', 'agent-sdk-verifier-ts']
 */
async function getBaseFileNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true
    });
    return entries.filter((entry: Dirent) => entry.isFile() && entry.name.endsWith('.md')).map((entry: Dirent) => {
      // Remove .md extension specifically
      const baseName = path.basename(entry.name, '.md');
      return baseName;
    });
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read plugin components from ${dirPath}: ${errorMsg}`, {
      level: 'error'
    });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

/**
 * Get list of skill directory names from a skills directory
 * Skills are directories containing a SKILL.md file
 * @param dirPath The skills directory path to scan
 * @returns Array of skill directory names that contain SKILL.md
 * @example
 * // Given directory contains: my-skill/SKILL.md, another-skill/SKILL.md, README.txt
 * await getSkillDirNames('/path/to/skills')
 * // Returns: ['my-skill', 'another-skill']
 */
async function getSkillDirNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, {
      withFileTypes: true
    });
    const skillNames: string[] = [];
    for (const entry of entries) {
      // Check if it's a directory or symlink (symlinks may point to skill directories)
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        // Check if this directory contains a SKILL.md file
        const skillFilePath = path.join(dirPath, entry.name, 'SKILL.md');
        try {
          const st = await fs.stat(skillFilePath);
          if (st.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md file in this directory, skip it
        }
      }
    }
    return skillNames;
  } catch (error) {
    const errorMsg = errorMessage(error);
    logForDebugging(`Failed to read skill directories from ${dirPath}: ${errorMsg}`, {
      level: 'error'
    });
    logError(toError(error));
    // Return empty array to allow graceful degradation - plugin details can still be shown
    return [];
  }
}

// Component to display installed plugin components
function PluginComponentsDisplay({
  plugin,
  marketplace
}: {
  plugin: LoadedPlugin;
  marketplace: string;
}): React.ReactNode {
  const [components, setComponents] = useState<{
    commands?: string | string[] | Record<string, unknown> | null;
    agents?: string | string[] | Record<string, unknown> | null;
    skills?: string | string[] | Record<string, unknown> | null;
    hooks?: unknown;
    mcpServers?: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    async function loadComponents() {
      try {
        // Built-in plugins don't have a marketplace entry — read from the
        // registered definition directly.
        if (marketplace === 'builtin') {
          const builtinDef = getBuiltinPluginDefinition(plugin.name);
          if (builtinDef) {
            const skillNames = builtinDef.skills?.map(s => s.name) ?? [];
            const hookEvents = builtinDef.hooks ? Object.keys(builtinDef.hooks) : [];
            const mcpServerNames = builtinDef.mcpServers ? Object.keys(builtinDef.mcpServers) : [];
            setComponents({
              commands: null,
              agents: null,
              skills: skillNames.length > 0 ? skillNames : null,
              hooks: hookEvents.length > 0 ? hookEvents : null,
              mcpServers: mcpServerNames.length > 0 ? mcpServerNames : null
            });
          } else {
            setError(`Built-in plugin ${plugin.name} not found`);
          }
          setLoading(false);
          return;
        }
        const marketplaceData = await getMarketplace(marketplace);
        // Find the plugin entry in the array
        const pluginEntry = marketplaceData.plugins.find(p => p.name === plugin.name);
        if (pluginEntry) {
          // Combine commands from both sources
          const commandPathList = [];
          if (plugin.commandsPath) {
            commandPathList.push(plugin.commandsPath);
          }
          if (plugin.commandsPaths) {
            commandPathList.push(...plugin.commandsPaths);
          }

          // Get base file names from all command paths
          const commandList: string[] = [];
          for (const commandPath of commandPathList) {
            if (typeof commandPath === 'string') {
              // commandPath is already a full path
              const baseNames = await getBaseFileNames(commandPath);
              commandList.push(...baseNames);
            }
          }

          // Combine agents from both sources
          const agentPathList = [];
          if (plugin.agentsPath) {
            agentPathList.push(plugin.agentsPath);
          }
          if (plugin.agentsPaths) {
            agentPathList.push(...plugin.agentsPaths);
          }

          // Get base file names from all agent paths
          const agentList: string[] = [];
          for (const agentPath of agentPathList) {
            if (typeof agentPath === 'string') {
              // agentPath is already a full path
              const baseNames_0 = await getBaseFileNames(agentPath);
              agentList.push(...baseNames_0);
            }
          }

          // Combine skills from both sources
          const skillPathList = [];
          if (plugin.skillsPath) {
            skillPathList.push(plugin.skillsPath);
          }
          if (plugin.skillsPaths) {
            skillPathList.push(...plugin.skillsPaths);
          }

          // Get skill directory names from all skill paths
          // Skills are directories containing SKILL.md files
          const skillList: string[] = [];
          for (const skillPath of skillPathList) {
            if (typeof skillPath === 'string') {
              // skillPath is already a full path to a skills directory
              const skillDirNames = await getSkillDirNames(skillPath);
              skillList.push(...skillDirNames);
            }
          }

          // Combine hooks from both sources
          const hooksList = [];
          if (plugin.hooksConfig) {
            hooksList.push(Object.keys(plugin.hooksConfig));
          }
          if (pluginEntry.hooks) {
            hooksList.push(pluginEntry.hooks);
          }

          // Combine MCP servers from both sources
          const mcpServersList = [];
          if (plugin.mcpServers) {
            mcpServersList.push(Object.keys(plugin.mcpServers));
          }
          if (pluginEntry.mcpServers) {
            mcpServersList.push(pluginEntry.mcpServers);
          }
          setComponents({
            commands: commandList.length > 0 ? commandList : null,
            agents: agentList.length > 0 ? agentList : null,
            skills: skillList.length > 0 ? skillList : null,
            hooks: hooksList.length > 0 ? hooksList : null,
            mcpServers: mcpServersList.length > 0 ? mcpServersList : null
          });
        } else {
          setError(`Plugin ${plugin.name} not found in marketplace`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load components');
      } finally {
        setLoading(false);
      }
    }
    void loadComponents();
  }, [plugin.name, plugin.commandsPath, plugin.commandsPaths, plugin.agentsPath, plugin.agentsPaths, plugin.skillsPath, plugin.skillsPaths, plugin.hooksConfig, plugin.mcpServers, marketplace]);
  if (loading) {
    return null; // Don't show loading state for cleaner UI
  }
  if (error) {
    return <Box flexDirection="column" marginBottom={1}>
        <Text bold>Components:</Text>
        <Text dimColor>Error: {error}</Text>
      </Box>;
  }
  if (!components) {
    return null; // No components info available
  }
  const hasComponents = components.commands || components.agents || components.skills || components.hooks || components.mcpServers;
  if (!hasComponents) {
    return null; // No components defined
  }
  return <Box flexDirection="column" marginBottom={1}>
      <Text bold>Installed components:</Text>
      {components.commands ? <Text dimColor>
          • Commands:{' '}
          {typeof components.commands === 'string' ? components.commands : Array.isArray(components.commands) ? components.commands.join(', ') : Object.keys(components.commands).join(', ')}
        </Text> : null}
      {components.agents ? <Text dimColor>
          • Agents:{' '}
          {typeof components.agents === 'string' ? components.agents : Array.isArray(components.agents) ? components.agents.join(', ') : Object.keys(components.agents).join(', ')}
        </Text> : null}
      {components.skills ? <Text dimColor>
          • Skills:{' '}
          {typeof components.skills === 'string' ? components.skills : Array.isArray(components.skills) ? components.skills.join(', ') : Object.keys(components.skills).join(', ')}
        </Text> : null}
      {components.hooks ? <Text dimColor>
          • Hooks:{' '}
          {typeof components.hooks === 'string' ? components.hooks : Array.isArray(components.hooks) ? components.hooks.map(String).join(', ') : typeof components.hooks === 'object' && components.hooks !== null ? Object.keys(components.hooks).join(', ') : String(components.hooks)}
        </Text> : null}
      {components.mcpServers ? <Text dimColor>
          • MCP Servers:{' '}
          {typeof components.mcpServers === 'string' ? components.mcpServers : Array.isArray(components.mcpServers) ? components.mcpServers.map(String).join(', ') : typeof components.mcpServers === 'object' && components.mcpServers !== null ? Object.keys(components.mcpServers).join(', ') : String(components.mcpServers)}
        </Text> : null}
    </Box>;
}

/**
 * Check if a plugin is from a local source and cannot be remotely updated
 * @returns Error message if local, null if remote/updatable
 */
async function checkIfLocalPlugin(pluginName: string, marketplaceName: string): Promise<string | null> {
  const marketplace = await getMarketplace(marketplaceName);
  const entry = marketplace?.plugins.find(p => p.name === pluginName);
  if (entry && typeof entry.source === 'string') {
    return `Local plugins cannot be updated remotely. To update, modify the source at: ${entry.source}`;
  }
  return null;
}

/**
 * Filter out plugins that are force-disabled by org policy (policySettings).
 * These are blocked by the organization and cannot be re-enabled by the user.
 * Checks policySettings directly rather than installation scope, since managed
 * settings don't create installation records with scope 'managed'.
 */
export function filterManagedDisabledPlugins(plugins: LoadedPlugin[]): LoadedPlugin[] {
  return plugins.filter(plugin => {
    const marketplace = plugin.source.split('@')[1] || 'local';
    return !isPluginBlockedByPolicy(`${plugin.name}@${marketplace}`);
  });
}
export function ManagePlugins({
  setViewState: setParentViewState,
  setResult,
  onManageComplete,
  onSearchModeChange,
  targetPlugin,
  targetMarketplace,
  action
}: Props): React.ReactNode {
  // App state for MCP access
  const mcpClients = useAppState(s => s.mcp.clients);
  const mcpTools = useAppState(s_0 => s_0.mcp.tools);
  const pluginErrors = useAppState(s_1 => s_1.plugins.errors);

  // Search state
  const [isSearchMode, setIsSearchModeRaw] = useState(false);
  const setIsSearchMode = useCallback((active: boolean) => {
    setIsSearchModeRaw(active);
    onSearchModeChange?.(active);
  }, [onSearchModeChange]);
  const isTerminalFocused = useTerminalFocus();
  const {
    columns: terminalWidth
  } = useTerminalSize();

  // View state
  const [viewState, setViewState] = useState<ViewState>('plugin-list');
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: viewState === 'plugin-list' && isSearchMode,
    onExit: () => {
      setIsSearchMode(false);
    }
  });
  const [selectedPlugin, setSelectedPlugin] = useState<PluginState | null>(null);

  // Data state
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([]);
  const [pluginStates, setPluginStates] = useState<PluginState[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingToggles, setPendingToggles] = useState<Map<string, 'will-enable' | 'will-disable'>>(new Map());

  // Guard to prevent auto-navigation from re-triggering after the user
  // navigates away (targetPlugin is never cleared by the parent).
  const hasAutoNavigated = useRef(false);
  // Auto-action (enable/disable/uninstall) to fire after auto-navigation lands.
  // Ref, not state: it's consumed by a one-shot effect that already re-runs on
  // viewState/selectedPlugin, so a render-triggering state var would be redundant.
  const pendingAutoActionRef = useRef<'enable' | 'disable' | 'uninstall' | undefined>(undefined);

  // MCP toggle hook
  const toggleMcpServer = useMcpToggleEnabled();

  // Handle escape to go back - viewState-dependent navigation
  const handleBack = React.useCallback(() => {
    if (viewState === 'plugin-details') {
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (viewState === 'configuring') {
      setViewState('plugin-details');
      setConfigNeeded(null);
    } else if (typeof viewState === 'object' && (viewState.type === 'plugin-options' || viewState.type === 'configuring-options')) {
      // Cancel mid-sequence — plugin is already enabled, just bail to list.
      // User can configure later via the Configure options menu if they want.
      setViewState('plugin-list');
      setSelectedPlugin(null);
      setResult('Plugin enabled. Configuration skipped — run /reload-plugins to apply.');
      if (onManageComplete) {
        void onManageComplete();
      }
    } else if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
      setViewState('plugin-list');
      setProcessError(null);
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
      setViewState({
        type: 'mcp-detail',
        client: viewState.client
      });
    } else if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
      setViewState({
        type: 'mcp-tools',
        client: viewState.client
      });
    } else {
      if (pendingToggles.size > 0) {
        setResult('Run /reload-plugins to apply plugin changes.');
        return;
      }
      setParentViewState({
        type: 'menu'
      });
    }
  }, [viewState, setParentViewState, pendingToggles, setResult]);

  // Escape when not in search mode - go back.
  // Excludes confirm-project-uninstall (has its own confirm:no handler in
  // Confirmation context — letting this fire would create competing handlers)
  // and confirm-data-cleanup (uses raw useInput where n and escape are
  // DIFFERENT actions: keep-data vs cancel).
  useKeybinding('confirm:no', handleBack, {
    context: 'Confirmation',
    isActive: (viewState !== 'plugin-list' || !isSearchMode) && viewState !== 'confirm-project-uninstall' && !(typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup')
  });

  // Derive unified items from plugins and MCP servers
  const unifiedItems = useUnifiedItems({
    pluginStates,
    mcpClients,
    pluginErrors,
    pendingToggles,
  });

  // Mark flagged plugins as seen when the Installed view renders them.
  // After 48 hours from seenAt, they auto-clear on next load.
  const flaggedIds = useMemo(() => unifiedItems.filter(item_3 => item_3.type === 'flagged-plugin').map(item_4 => item_4.id), [unifiedItems]);
  useEffect(() => {
    if (flaggedIds.length > 0) {
      void markFlaggedPluginsSeen(flaggedIds);
    }
  }, [flaggedIds]);

  // Filter items based on search query (matches name or description)
  const filteredItems = useMemo(() => {
    if (!searchQuery) return unifiedItems;
    const lowerQuery = searchQuery.toLowerCase();
    return unifiedItems.filter(item_5 => item_5.name.toLowerCase().includes(lowerQuery) || 'description' in item_5 && item_5.description?.toLowerCase().includes(lowerQuery));
  }, [unifiedItems, searchQuery]);

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Pagination for unified list (continuous scrolling)
  const pagination = usePagination<UnifiedInstalledItem>({
    totalItems: filteredItems.length,
    selectedIndex,
    maxVisible: 8
  });

  // Details view state
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // Configuration state
  const [configNeeded, setConfigNeeded] = useState<McpbNeedsConfigResult | null>(null);
  const [_isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [selectedPluginHasMcpb, setSelectedPluginHasMcpb] = useState(false);

  // Detect if selected plugin has MCPB
  // Reads raw marketplace.json to work with old cached marketplaces
  useEffect(() => {
    if (!selectedPlugin) {
      setSelectedPluginHasMcpb(false);
      return;
    }
    async function detectMcpb() {
      // Check plugin manifest first
      const mcpServersSpec = selectedPlugin!.plugin.manifest.mcpServers;
      let hasMcpb = false;
      if (mcpServersSpec) {
        hasMcpb = typeof mcpServersSpec === 'string' && isMcpbSource(mcpServersSpec) || Array.isArray(mcpServersSpec) && mcpServersSpec.some(s_2 => typeof s_2 === 'string' && isMcpbSource(s_2));
      }

      // If not in manifest, read raw marketplace.json directly (bypassing schema validation)
      // This works even with old cached marketplaces from before MCPB support
      if (!hasMcpb) {
        try {
          const marketplaceDir = path.join(selectedPlugin!.plugin.path, '..');
          const marketplaceJsonPath = path.join(marketplaceDir, '.claude-plugin', 'marketplace.json');
          const content = await fs.readFile(marketplaceJsonPath, 'utf-8');
          const marketplace_1 = jsonParse(content);
          const entry_0 = marketplace_1.plugins?.find((p: {
            name: string;
          }) => p.name === selectedPlugin!.plugin.name);
          if (entry_0?.mcpServers) {
            const spec = entry_0.mcpServers;
            hasMcpb = typeof spec === 'string' && isMcpbSource(spec) || Array.isArray(spec) && spec.some((s_3: unknown) => typeof s_3 === 'string' && isMcpbSource(s_3));
          }
        } catch (err) {
          logForDebugging(`Failed to read raw marketplace.json: ${err}`);
        }
      }
      setSelectedPluginHasMcpb(hasMcpb);
    }
    void detectMcpb();
  }, [selectedPlugin]);

  // Load installed plugins grouped by marketplace
  useEffect(() => {
    async function loadInstalledPlugins() {
      setLoading(true);
      try {
        const {
          enabled,
          disabled
        } = await loadAllPlugins();
        const mergedSettings = getSettings_DEPRECATED(); // Use merged settings to respect all layers

        const allPlugins = filterManagedDisabledPlugins([...enabled, ...disabled]);

        // Group plugins by marketplace
        const pluginsByMarketplace: Record<string, LoadedPlugin[]> = {};
        for (const plugin of allPlugins) {
          const marketplace = plugin.source.split('@')[1] || 'local';
          if (!pluginsByMarketplace[marketplace]) {
            pluginsByMarketplace[marketplace] = [];
          }
          pluginsByMarketplace[marketplace]!.push(plugin);
        }

        // Create marketplace info array with enabled/disabled counts
        const marketplaceInfos: MarketplaceInfo[] = [];
        for (const [name, plugins] of Object.entries(pluginsByMarketplace)) {
          const enabledCount = count(plugins, p => {
            const pluginId = `${p.name}@${name}`;
            return mergedSettings?.enabledPlugins?.[pluginId] !== false;
          });
          const disabledCount = plugins.length - enabledCount;
          marketplaceInfos.push({
            name,
            installedPlugins: plugins,
            enabledCount,
            disabledCount
          });
        }

        // Sort marketplaces: claude-plugin-directory first, then alphabetically
        marketplaceInfos.sort((a, b) => {
          if (a.name === 'claude-plugin-directory') return -1;
          if (b.name === 'claude-plugin-directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setMarketplaces(marketplaceInfos);

        // Build flat list of all plugin states
        const allStates: PluginState[] = [];
        for (const marketplace of marketplaceInfos) {
          for (const plugin of marketplace.installedPlugins) {
            const pluginId = `${plugin.name}@${marketplace.name}`;
            // Built-in plugins don't have V2 install entries — skip the lookup.
            const scope = plugin.isBuiltin ? 'builtin' : getPluginInstallationFromV2(pluginId).scope;
            allStates.push({
              plugin,
              marketplace: marketplace.name,
              scope,
              pendingEnable: undefined,
              pendingUpdate: false
            });
          }
        }
        setPluginStates(allStates);
        setSelectedIndex(0);
      } finally {
        setLoading(false);
      }
    }
    void loadInstalledPlugins();
  }, []);

  // Auto-navigate to target plugin if specified (once only)
  useEffect(() => {
    if (hasAutoNavigated.current) return;
    if (targetPlugin && marketplaces.length > 0 && !loading) {
      // targetPlugin may be `name` or `name@marketplace` (parseArgs passes the
      // raw arg through). Parse it so p.name matching works either way.
      const {
        name: targetName,
        marketplace: targetMktFromId
      } = parsePluginIdentifier(targetPlugin);
      const effectiveTargetMarketplace = targetMarketplace ?? targetMktFromId;

      // Use targetMarketplace if provided, otherwise search all
      const marketplacesToSearch = effectiveTargetMarketplace ? marketplaces.filter(m => m.name === effectiveTargetMarketplace) : marketplaces;

      // First check successfully loaded plugins
      for (const marketplace_2 of marketplacesToSearch) {
        const plugin = marketplace_2.installedPlugins.find(p_0 => p_0.name === targetName);
        if (plugin) {
          // Get scope from V2 data for proper operation handling
          const pluginId_2 = `${plugin.name}@${marketplace_2.name}`;
          const {
            scope: scope_4
          } = getPluginInstallationFromV2(pluginId_2);
          const pluginState: PluginState = {
            plugin,
            marketplace: marketplace_2.name,
            scope: scope_4,
            pendingEnable: undefined,
            pendingUpdate: false
          };
          setSelectedPlugin(pluginState);
          setViewState('plugin-details');
          pendingAutoActionRef.current = action;
          hasAutoNavigated.current = true;
          return;
        }
      }

      // Fall back to failed plugins (those with errors but not loaded)
      const failedItem = unifiedItems.find(item_6 => item_6.type === 'failed-plugin' && item_6.name === targetName);
      if (failedItem && failedItem.type === 'failed-plugin') {
        setViewState({
          type: 'failed-plugin-details',
          plugin: {
            id: failedItem.id,
            name: failedItem.name,
            marketplace: failedItem.marketplace,
            errors: failedItem.errors,
            scope: failedItem.scope
          }
        });
        hasAutoNavigated.current = true;
      }

      // No match in loaded OR failed plugins — close the dialog with a
      // message rather than silently landing on the plugin list. Only do
      // this when an action was requested (e.g. /plugin uninstall X);
      // plain navigation (/plugin manage) should still just show the list.
      if (!hasAutoNavigated.current && action) {
        hasAutoNavigated.current = true;
        setResult(`Plugin "${targetPlugin}" is not installed in this project`);
      }
    }
  }, [targetPlugin, targetMarketplace, marketplaces, loading, unifiedItems, action, setResult]);

  // Handle single plugin operations from details view
  const handleSingleOperation = async (operation: 'enable' | 'disable' | 'update' | 'uninstall') => {
    if (!selectedPlugin) return;
    const pluginScope = selectedPlugin.scope || 'user';
    const isBuiltin = pluginScope === 'builtin';

    // Built-in plugins can only be enabled/disabled, not updated/uninstalled.
    if (isBuiltin && (operation === 'update' || operation === 'uninstall')) {
      setProcessError('Built-in plugins cannot be updated or uninstalled.');
      return;
    }

    // Managed scope plugins can only be updated, not enabled/disabled/uninstalled
    if (!isBuiltin && !isInstallableScope(pluginScope) && operation !== 'update') {
      setProcessError('This plugin is managed by your organization. Contact your admin to disable it.');
      return;
    }
    setIsProcessing(true);
    setProcessError(null);
    try {
      const pluginId_3 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      let reverseDependents: string[] | undefined;

      // enable/disable omit scope — pluginScope is the install scope from
      // installed_plugins.json (where files are cached), which can diverge
      // from the settings scope (where enablement lives). Passing it trips
      // the cross-scope guard. Auto-detect finds the right scope. #38084
      switch (operation) {
        case 'enable':
          {
            const enableResult = await enablePluginOp(pluginId_3);
            if (!enableResult.success) {
              throw new Error(enableResult.message);
            }
            break;
          }
        case 'disable':
          {
            const disableResult = await disablePluginOp(pluginId_3);
            if (!disableResult.success) {
              throw new Error(disableResult.message);
            }
            reverseDependents = disableResult.reverseDependents;
            break;
          }
        case 'uninstall':
          {
            if (isBuiltin) break; // guarded above; narrows pluginScope
            if (!isInstallableScope(pluginScope)) break;
            // If the plugin is enabled in .claude/settings.json (shared with the
            // team), divert to a confirmation dialog that offers to disable in
            // settings.local.json instead. Check the settings file directly —
            // `pluginScope` (from installed_plugins.json) can be 'user' even when
            // the plugin is ALSO project-enabled, and uninstalling the user-scope
            // install would leave the project enablement active.
            if (isPluginEnabledAtProjectScope(pluginId_3)) {
              setIsProcessing(false);
              setViewState('confirm-project-uninstall');
              return;
            }
            // If the plugin has persistent data (${CLAUDE_PLUGIN_DATA}) AND this
            // is the last scope, prompt before deleting it. For multi-scope
            // installs, the op's isLastScope check won't delete regardless of
            // the user's y/n — showing the dialog would mislead ("y" → nothing
            // happens). Length check mirrors pluginOperations.ts:513.
            const installs = loadInstalledPluginsV2().plugins[pluginId_3];
            const isLastScope = !installs || installs.length <= 1;
            const dataSize = isLastScope ? await getPluginDataDirSize(pluginId_3) : null;
            if (dataSize) {
              setIsProcessing(false);
              setViewState({
                type: 'confirm-data-cleanup',
                size: dataSize
              });
              return;
            }
            const result_0 = await uninstallPluginOp(pluginId_3, pluginScope);
            if (!result_0.success) {
              throw new Error(result_0.message);
            }
            reverseDependents = result_0.reverseDependents;
            break;
          }
        case 'update':
          {
            if (isBuiltin) break; // guarded above; narrows pluginScope
            const result = await updatePluginOp(pluginId_3, pluginScope);
            if (!result.success) {
              throw new Error(result.message);
            }
            // If already up to date, show message and exit
            if (result.alreadyUpToDate) {
              setResult(`${selectedPlugin.plugin.name} is already at the latest version (${result.newVersion}).`);
              if (onManageComplete) {
                await onManageComplete();
              }
              setParentViewState({
                type: 'menu'
              });
              return;
            }
            // Success - will show standard message below
            break;
          }
      }

      // Operations (enable, disable, uninstall, update) now use centralized functions
      // that handle their own settings updates, so we only need to clear caches here
      clearAllCaches();

      // Prompt for manifest.userConfig + channel userConfig if the plugin ends
      // up enabled. Re-read settings rather than keying on `operation ===
      // 'enable'`: install enables on install, so the menu shows "Disable"
      // first. PluginOptionsFlow itself checks getUnconfiguredOptions — if
      // nothing needs filling, it calls onDone('skipped') immediately.
      const pluginIdNow = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      const settingsAfter = getSettings_DEPRECATED();
      const enabledAfter = settingsAfter?.enabledPlugins?.[pluginIdNow] !== false;
      if (enabledAfter) {
        setIsProcessing(false);
        setViewState({
          type: 'plugin-options'
        });
        return;
      }
      const operationName = operation === 'enable' ? 'Enabled' : operation === 'disable' ? 'Disabled' : operation === 'update' ? 'Updated' : 'Uninstalled';

      // Single-line warning — notification timeout is ~8s, multi-line would scroll off.
      // The persistent record is in the Errors tab (dependency-unsatisfied after reload).
      const depWarn = reverseDependents && reverseDependents.length > 0 ? ` · required by ${reverseDependents.join(', ')}` : '';
      const message = `✓ ${operationName} ${selectedPlugin.plugin.name}${depWarn}. Run /reload-plugins to apply.`;
      setResult(message);
      if (onManageComplete) {
        await onManageComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    } catch (error_0) {
      setIsProcessing(false);
      const errorMessage = error_0 instanceof Error ? error_0.message : String(error_0);
      setProcessError(`Failed to ${operation}: ${errorMessage}`);
      logError(toError(error_0));
    }
  };

  // Latest-ref: lets the auto-action effect call the current closure without
  // adding handleSingleOperation (recreated every render) to its deps.
  const handleSingleOperationRef = useRef(handleSingleOperation);
  handleSingleOperationRef.current = handleSingleOperation;

  // Auto-execute the action prop (/plugin uninstall X, /plugin enable X, etc.)
  // once auto-navigation has landed on plugin-details.
  useEffect(() => {
    if (viewState === 'plugin-details' && selectedPlugin && pendingAutoActionRef.current) {
      const pending = pendingAutoActionRef.current;
      pendingAutoActionRef.current = undefined;
      void handleSingleOperationRef.current(pending);
    }
  }, [viewState, selectedPlugin]);

  // Handle toggle enable/disable
  const handleToggle = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    const item_7 = filteredItems[selectedIndex];
    if (item_7?.type === 'flagged-plugin') return;
    if (item_7?.type === 'plugin') {
      const pluginId_4 = `${item_7.plugin.name}@${item_7.marketplace}`;
      const mergedSettings_0 = getSettings_DEPRECATED();
      const currentPending = pendingToggles.get(pluginId_4);
      const isEnabled_0 = mergedSettings_0?.enabledPlugins?.[pluginId_4] !== false;
      const pluginScope_0 = item_7.scope;
      const isBuiltin_0 = pluginScope_0 === 'builtin';
      if (isBuiltin_0 || isInstallableScope(pluginScope_0)) {
        const newPending = new Map(pendingToggles);
        // Omit scope — see handleSingleOperation's enable/disable comment.
        if (currentPending) {
          // Cancel: reverse the operation back to the original state
          newPending.delete(pluginId_4);
          void (async () => {
            try {
              if (currentPending === 'will-disable') {
                await enablePluginOp(pluginId_4);
              } else {
                await disablePluginOp(pluginId_4);
              }
              clearAllCaches();
            } catch (err_0) {
              logError(err_0);
            }
          })();
        } else {
          newPending.set(pluginId_4, isEnabled_0 ? 'will-disable' : 'will-enable');
          void (async () => {
            try {
              if (isEnabled_0) {
                await disablePluginOp(pluginId_4);
              } else {
                await enablePluginOp(pluginId_4);
              }
              clearAllCaches();
            } catch (err_1) {
              logError(err_1);
            }
          })();
        }
        setPendingToggles(newPending);
      }
    } else if (item_7?.type === 'mcp') {
      void toggleMcpServer(item_7.client.name);
    }
  }, [selectedIndex, filteredItems, pendingToggles, pluginStates, toggleMcpServer]);

  // Handle accept (Enter) in plugin-list
  const handleAccept = React.useCallback(() => {
    if (selectedIndex >= filteredItems.length) return;
    const item_8 = filteredItems[selectedIndex];
    if (item_8?.type === 'plugin') {
      const state_0 = pluginStates.find(s_4 => s_4.plugin.name === item_8.plugin.name && s_4.marketplace === item_8.marketplace);
      if (state_0) {
        setSelectedPlugin(state_0);
        setViewState('plugin-details');
        setDetailsMenuIndex(0);
        setProcessError(null);
      }
    } else if (item_8?.type === 'flagged-plugin') {
      setViewState({
        type: 'flagged-detail',
        plugin: {
          id: item_8.id,
          name: item_8.name,
          marketplace: item_8.marketplace,
          reason: item_8.reason,
          text: item_8.text,
          flaggedAt: item_8.flaggedAt
        }
      });
      setProcessError(null);
    } else if (item_8?.type === 'failed-plugin') {
      setViewState({
        type: 'failed-plugin-details',
        plugin: {
          id: item_8.id,
          name: item_8.name,
          marketplace: item_8.marketplace,
          errors: item_8.errors,
          scope: item_8.scope
        }
      });
      setDetailsMenuIndex(0);
      setProcessError(null);
    } else if (item_8?.type === 'mcp') {
      setViewState({
        type: 'mcp-detail',
        client: item_8.client
      });
      setProcessError(null);
    }
  }, [selectedIndex, filteredItems, pluginStates]);

  // Plugin-list navigation (non-search mode)
  useKeybindings({
    'select:previous': () => {
      if (selectedIndex === 0) {
        setIsSearchMode(true);
      } else {
        pagination.handleSelectionChange(selectedIndex - 1, setSelectedIndex);
      }
    },
    'select:next': () => {
      if (selectedIndex < filteredItems.length - 1) {
        pagination.handleSelectionChange(selectedIndex + 1, setSelectedIndex);
      }
    },
    'select:accept': handleAccept
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });
  useKeybindings({
    'plugin:toggle': handleToggle
  }, {
    context: 'Plugin',
    isActive: viewState === 'plugin-list' && !isSearchMode
  });

  // Handle dismiss action in flagged-detail view
  const handleFlaggedDismiss = React.useCallback(() => {
    if (typeof viewState !== 'object' || viewState.type !== 'flagged-detail') return;
    void removeFlaggedPlugin(viewState.plugin.id);
    setViewState('plugin-list');
  }, [viewState]);
  useKeybindings({
    'select:accept': handleFlaggedDismiss
  }, {
    context: 'Select',
    isActive: typeof viewState === 'object' && viewState.type === 'flagged-detail'
  });

  // Build details menu items (needed for navigation)
  const detailsMenuItems = React.useMemo(() => {
    if (viewState !== 'plugin-details' || !selectedPlugin) return [];
    const mergedSettings_1 = getSettings_DEPRECATED();
    const pluginId_5 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled_1 = mergedSettings_1?.enabledPlugins?.[pluginId_5] !== false;
    const isBuiltin_1 = selectedPlugin.marketplace === 'builtin';
    const menuItems: Array<{
      label: string;
      action: () => void;
    }> = [];
    menuItems.push({
      label: isEnabled_1 ? 'Disable plugin' : 'Enable plugin',
      action: () => void handleSingleOperation(isEnabled_1 ? 'disable' : 'enable')
    });

    // Update/Uninstall options — not available for built-in plugins
    if (!isBuiltin_1) {
      menuItems.push({
        label: selectedPlugin.pendingUpdate ? 'Unmark for update' : 'Mark for update',
        action: async () => {
          try {
            const localError = await checkIfLocalPlugin(selectedPlugin.plugin.name, selectedPlugin.marketplace);
            if (localError) {
              setProcessError(localError);
              return;
            }
            const newStates = [...pluginStates];
            const index = newStates.findIndex(s_5 => s_5.plugin.name === selectedPlugin.plugin.name && s_5.marketplace === selectedPlugin.marketplace);
            if (index !== -1) {
              newStates[index]!.pendingUpdate = !selectedPlugin.pendingUpdate;
              setPluginStates(newStates);
              setSelectedPlugin({
                ...selectedPlugin,
                pendingUpdate: !selectedPlugin.pendingUpdate
              });
            }
          } catch (error_1) {
            setProcessError(error_1 instanceof Error ? error_1.message : 'Failed to check plugin update availability');
          }
        }
      });
      if (selectedPluginHasMcpb) {
        menuItems.push({
          label: 'Configure',
          action: async () => {
            setIsLoadingConfig(true);
            try {
              const mcpServersSpec_0 = selectedPlugin.plugin.manifest.mcpServers;
              let mcpbPath: string | null = null;
              if (typeof mcpServersSpec_0 === 'string' && isMcpbSource(mcpServersSpec_0)) {
                mcpbPath = mcpServersSpec_0;
              } else if (Array.isArray(mcpServersSpec_0)) {
                for (const spec_0 of mcpServersSpec_0) {
                  if (typeof spec_0 === 'string' && isMcpbSource(spec_0)) {
                    mcpbPath = spec_0;
                    break;
                  }
                }
              }
              if (!mcpbPath) {
                setProcessError('No MCPB file found in plugin');
                setIsLoadingConfig(false);
                return;
              }
              const pluginId_6 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
              const result_1 = await loadMcpbFile(mcpbPath, selectedPlugin.plugin.path, pluginId_6, undefined, undefined, true);
              if ('status' in result_1 && result_1.status === 'needs-config') {
                setConfigNeeded(result_1);
                setViewState('configuring');
              } else {
                setProcessError('Failed to load MCPB for configuration');
              }
            } catch (err_2) {
              const errorMsg = errorMessage(err_2);
              setProcessError(`Failed to load configuration: ${errorMsg}`);
            } finally {
              setIsLoadingConfig(false);
            }
          }
        });
      }
      if (selectedPlugin.plugin.manifest.userConfig && Object.keys(selectedPlugin.plugin.manifest.userConfig).length > 0) {
        menuItems.push({
          label: 'Configure options',
          action: () => {
            setViewState({
              type: 'configuring-options',
              schema: selectedPlugin.plugin.manifest.userConfig!
            });
          }
        });
      }
      menuItems.push({
        label: 'Update now',
        action: () => void handleSingleOperation('update')
      });
      menuItems.push({
        label: 'Uninstall',
        action: () => void handleSingleOperation('uninstall')
      });
    }
    if (selectedPlugin.plugin.manifest.homepage) {
      menuItems.push({
        label: 'Open homepage',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.homepage!)
      });
    }
    if (selectedPlugin.plugin.manifest.repository) {
      menuItems.push({
        // Generic label — manifest.repository can be GitLab, Bitbucket,
        // Azure DevOps, etc. (gh-31598). pluginDetailsHelpers.tsx:74 keeps
        // 'View on GitHub' because that path has an explicit isGitHub check.
        label: 'View repository',
        action: () => void openBrowser(selectedPlugin.plugin.manifest.repository!)
      });
    }
    menuItems.push({
      label: 'Back to plugin list',
      action: () => {
        setViewState('plugin-list');
        setSelectedPlugin(null);
        setProcessError(null);
      }
    });
    return menuItems;
  }, [viewState, selectedPlugin, selectedPluginHasMcpb, pluginStates]);

  // Plugin-details navigation
  useKeybindings({
    'select:previous': () => {
      if (detailsMenuIndex > 0) {
        setDetailsMenuIndex(detailsMenuIndex - 1);
      }
    },
    'select:next': () => {
      if (detailsMenuIndex < detailsMenuItems.length - 1) {
        setDetailsMenuIndex(detailsMenuIndex + 1);
      }
    },
    'select:accept': () => {
      if (detailsMenuItems[detailsMenuIndex]) {
        detailsMenuItems[detailsMenuIndex]!.action();
      }
    }
  }, {
    context: 'Select',
    isActive: viewState === 'plugin-details' && !!selectedPlugin
  });

  // Failed-plugin-details: only "Uninstall" option, handle Enter
  useKeybindings({
    'select:accept': () => {
      if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
        void (async () => {
          setIsProcessing(true);
          setProcessError(null);
          const pluginId_7 = viewState.plugin.id;
          const pluginScope_1 = viewState.plugin.scope;
          // Pass scope to uninstallPluginOp so it can find the correct V2
          // installation record and clean up on-disk files. Fall back to
          // default scope if not installable (e.g. 'managed', though that
          // case is guarded by isActive below). deleteDataDir=false: this
          // is a recovery path for a plugin that failed to load — it may
          // be reinstallable, so don't nuke ${CLAUDE_PLUGIN_DATA} silently.
          // The normal uninstall path prompts; this one preserves.
          const result_2 = isInstallableScope(pluginScope_1) ? await uninstallPluginOp(pluginId_7, pluginScope_1, false) : await uninstallPluginOp(pluginId_7, 'user', false);
          let success = result_2.success;
          if (!success) {
            // Plugin was never installed (only in enabledPlugins settings).
            // Remove directly from all editable settings sources.
            const editableSources = ['userSettings' as const, 'projectSettings' as const, 'localSettings' as const];
            for (const source of editableSources) {
              const settings = getSettingsForSource(source);
              if (settings?.enabledPlugins?.[pluginId_7] !== undefined) {
                updateSettingsForSource(source, {
                  enabledPlugins: {
                    ...settings.enabledPlugins,
                    [pluginId_7]: undefined
                  }
                });
                success = true;
              }
            }
            // Clear memoized caches so next loadAllPlugins() picks up settings changes
            clearAllCaches();
          }
          if (success) {
            if (onManageComplete) {
              await onManageComplete();
            }
            setIsProcessing(false);
            // Return to list (don't setResult — that closes the whole dialog)
            setViewState('plugin-list');
          } else {
            setIsProcessing(false);
            setProcessError(result_2.message);
          }
        })();
      }
    }
  }, {
    context: 'Select',
    isActive: typeof viewState === 'object' && viewState.type === 'failed-plugin-details' && viewState.plugin.scope !== 'managed'
  });

  // Confirm-project-uninstall: y/enter disables in settings.local.json, n/escape cancels
  useKeybindings({
    'confirm:yes': () => {
      if (!selectedPlugin) return;
      setIsProcessing(true);
      setProcessError(null);
      const pluginId_8 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
      // Write `false` directly — disablePluginOp's cross-scope guard would
      // reject this (plugin isn't in localSettings yet; the override IS the
      // point).
      const {
        error: error_2
      } = updateSettingsForSource('localSettings', {
        enabledPlugins: {
          ...getSettingsForSource('localSettings')?.enabledPlugins,
          [pluginId_8]: false
        }
      });
      if (error_2) {
        setIsProcessing(false);
        setProcessError(`Failed to write settings: ${error_2.message}`);
        return;
      }
      clearAllCaches();
      setResult(`✓ Disabled ${selectedPlugin.plugin.name} in .claude/settings.local.json. Run /reload-plugins to apply.`);
      if (onManageComplete) void onManageComplete();
      setParentViewState({
        type: 'menu'
      });
    },
    'confirm:no': () => {
      setViewState('plugin-details');
      setProcessError(null);
    }
  }, {
    context: 'Confirmation',
    isActive: viewState === 'confirm-project-uninstall' && !!selectedPlugin && !isProcessing
  });

  // Confirm-data-cleanup: y uninstalls + deletes data dir, n uninstalls + keeps,
  // esc cancels. Raw useInput because: (1) the Confirmation context maps
  // enter→confirm:yes, which would make Enter delete the data directory — a
  // destructive default the UI text ("y to delete · n to keep") doesn't
  // advertise; (2) unlike confirm-project-uninstall (which uses useKeybindings
  // where n and escape both map to confirm:no), here n and escape are DIFFERENT
  // actions (keep-data vs cancel), so this deliberately stays on raw useInput.
  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw y/n/esc; Enter must not trigger destructive delete
  useInput((input, key) => {
    if (!selectedPlugin) return;
    const pluginId_9 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const pluginScope_2 = selectedPlugin.scope;
    // Dialog is only reachable from the uninstall case (which guards on
    // isBuiltin), but TS can't track that across viewState transitions.
    if (!pluginScope_2 || pluginScope_2 === 'builtin' || !isInstallableScope(pluginScope_2)) return;
    const doUninstall = async (deleteDataDir: boolean) => {
      setIsProcessing(true);
      setProcessError(null);
      try {
        const result_3 = await uninstallPluginOp(pluginId_9, pluginScope_2, deleteDataDir);
        if (!result_3.success) throw new Error(result_3.message);
        clearAllCaches();
        const suffix = deleteDataDir ? '' : ' · data preserved';
        setResult(`${figures.tick} ${result_3.message}${suffix}`);
        if (onManageComplete) void onManageComplete();
        setParentViewState({
          type: 'menu'
        });
      } catch (e_0) {
        setIsProcessing(false);
        setProcessError(e_0 instanceof Error ? e_0.message : String(e_0));
      }
    };
    if (input === 'y' || input === 'Y') {
      void doUninstall(true);
    } else if (input === 'n' || input === 'N') {
      void doUninstall(false);
    } else if (key.escape) {
      setViewState('plugin-details');
      setProcessError(null);
    }
  }, {
    isActive: typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup' && !!selectedPlugin && !isProcessing
  });

  // Reset selection when search query changes
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Handle input for entering search mode (text input handled by useSearchInput hook)
  // eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for raw search mode text input
  useInput((input_0, key_0) => {
    const keyIsNotCtrlOrMeta = !key_0.ctrl && !key_0.meta;
    if (isSearchMode) {
      // Text input is handled by useSearchInput hook
      return;
    }

    // Enter search mode with '/' or any printable character (except navigation keys)
    if (input_0 === '/' && keyIsNotCtrlOrMeta) {
      setIsSearchMode(true);
      setSearchQuery('');
      setSelectedIndex(0);
    } else if (keyIsNotCtrlOrMeta && input_0.length > 0 && !/^\s+$/.test(input_0) && input_0 !== 'j' && input_0 !== 'k' && input_0 !== ' ') {
      setIsSearchMode(true);
      setSearchQuery(input_0);
      setSelectedIndex(0);
    }
  }, {
    isActive: viewState === 'plugin-list'
  });

  // Loading state
  if (loading) {
    return <Text>Loading installed plugins…</Text>;
  }

  // No plugins or MCPs installed
  if (unifiedItems.length === 0) {
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Manage plugins</Text>
        </Box>
        <Text>No plugins or MCP servers installed.</Text>
        <Box marginTop={1}>
          <Text dimColor>Esc to go back</Text>
        </Box>
      </Box>;
  }
  if (typeof viewState === 'object' && viewState.type === 'plugin-options' && selectedPlugin) {
    const pluginId_10 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    function finish(msg: string): void {
      setResult(msg);
      // Plugin is enabled regardless of whether config was saved or
      // skipped — onManageComplete → markPluginsChanged → the
      // persistent "run /reload-plugins" notice.
      if (onManageComplete) {
        void onManageComplete();
      }
      setParentViewState({
        type: 'menu'
      });
    }
    return <PluginOptionsFlow plugin={selectedPlugin.plugin} pluginId={pluginId_10} onDone={(outcome, detail) => {
      switch (outcome) {
        case 'configured':
          finish(`✓ Enabled and configured ${selectedPlugin.plugin.name}. Run /reload-plugins to apply.`);
          break;
        case 'skipped':
          finish(`✓ Enabled ${selectedPlugin.plugin.name}. Run /reload-plugins to apply.`);
          break;
        case 'error':
          finish(`Failed to save configuration: ${detail}`);
          break;
      }
    }} />;
  }

  // Configure options (from the Manage menu)
  if (typeof viewState === 'object' && viewState.type === 'configuring-options' && selectedPlugin) {
    const pluginId_11 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    return <PluginOptionsDialog title={`Configure ${selectedPlugin.plugin.name}`} subtitle="Plugin options" configSchema={viewState.schema} initialValues={loadPluginOptions(pluginId_11)} onSave={values => {
      try {
        savePluginOptions(pluginId_11, values, viewState.schema);
        clearAllCaches();
        setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
      } catch (err_3) {
        setProcessError(`Failed to save configuration: ${errorMessage(err_3)}`);
      }
      setViewState('plugin-details');
    }} onCancel={() => setViewState('plugin-details')} />;
  }

  // Configuration view
  if (viewState === 'configuring' && configNeeded && selectedPlugin) {
    const pluginId_12 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    async function handleSave(config: UserConfigValues) {
      if (!configNeeded || !selectedPlugin) return;
      try {
        // Find MCPB path again
        const mcpServersSpec_1 = selectedPlugin.plugin.manifest.mcpServers;
        let mcpbPath_0: string | null = null;
        if (typeof mcpServersSpec_1 === 'string' && isMcpbSource(mcpServersSpec_1)) {
          mcpbPath_0 = mcpServersSpec_1;
        } else if (Array.isArray(mcpServersSpec_1)) {
          for (const spec_1 of mcpServersSpec_1) {
            if (typeof spec_1 === 'string' && isMcpbSource(spec_1)) {
              mcpbPath_0 = spec_1;
              break;
            }
          }
        }
        if (!mcpbPath_0) {
          setProcessError('No MCPB file found');
          setViewState('plugin-details');
          return;
        }

        // Reload with provided config
        await loadMcpbFile(mcpbPath_0, selectedPlugin.plugin.path, pluginId_12, undefined, config);

        // Success - go back to details
        setProcessError(null);
        setConfigNeeded(null);
        setViewState('plugin-details');
        setResult('Configuration saved. Run /reload-plugins for changes to take effect.');
      } catch (err_4) {
        const errorMsg_0 = errorMessage(err_4);
        setProcessError(`Failed to save configuration: ${errorMsg_0}`);
        setViewState('plugin-details');
      }
    }
    function handleCancel() {
      setConfigNeeded(null);
      setViewState('plugin-details');
    }
    return <PluginOptionsDialog title={`Configure ${configNeeded.manifest.name}`} subtitle={`Plugin: ${selectedPlugin.plugin.name}`} configSchema={configNeeded.configSchema} initialValues={configNeeded.existingConfig} onSave={handleSave} onCancel={handleCancel} />;
  }

  // Flagged plugin detail view
  if (typeof viewState === 'object' && viewState.type === 'flagged-detail') {
    const fp = viewState.plugin;
    return <Box flexDirection="column">
        <Box>
          <Text bold>
            {fp.name} @ {fp.marketplace}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color="error">Removed</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color="error">
            Removed from marketplace · reason: {fp.reason}
          </Text>
          <Text>{fp.text}</Text>
          <Text dimColor>
            Flagged on {new Date(fp.flaggedAt).toLocaleDateString()}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text>{figures.pointer} </Text>
            <Text color="suggestion">Dismiss</Text>
          </Box>
        </Box>

        <Byline>
          <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="dismiss" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
        </Byline>
      </Box>;
  }

  // Confirm-project-uninstall: warn about shared .claude/settings.json,
  // offer to disable in settings.local.json instead.
  if (viewState === 'confirm-project-uninstall' && selectedPlugin) {
    return <Box flexDirection="column">
        <Text bold color="warning">
          {selectedPlugin.plugin.name} is enabled in .claude/settings.json
          (shared with your team)
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Disable it just for you in .claude/settings.local.json?</Text>
          <Text dimColor>
            This has the same effect as uninstalling, without affecting other
            contributors.
          </Text>
        </Box>
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}
        <Box marginTop={1}>
          {isProcessing ? <Text dimColor>Disabling…</Text> : <Byline>
              <ConfigurableShortcutHint action="confirm:yes" context="Confirmation" fallback="y" description="disable" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
            </Byline>}
        </Box>
      </Box>;
  }

  // Confirm-data-cleanup: prompt before deleting ${CLAUDE_PLUGIN_DATA} dir
  if (typeof viewState === 'object' && viewState.type === 'confirm-data-cleanup' && selectedPlugin) {
    return <Box flexDirection="column">
        <Text bold>
          {selectedPlugin.plugin.name} has {viewState.size.human} of persistent
          data
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Delete it along with the plugin?</Text>
          <Text dimColor>
            {pluginDataDirPath(`${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`)}
          </Text>
        </Box>
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}
        <Box marginTop={1}>
          {isProcessing ? <Text dimColor>Uninstalling…</Text> : <Text>
              <Text bold>y</Text> to delete · <Text bold>n</Text> to keep ·{' '}
              <Text bold>esc</Text> to cancel
            </Text>}
        </Box>
      </Box>;
  }

  // Plugin details view
  if (viewState === 'plugin-details' && selectedPlugin) {
    const mergedSettings_2 = getSettings_DEPRECATED(); // Use merged settings to respect all layers
    const pluginId_13 = `${selectedPlugin.plugin.name}@${selectedPlugin.marketplace}`;
    const isEnabled_2 = mergedSettings_2?.enabledPlugins?.[pluginId_13] !== false;

    // Compute plugin errors section
    const filteredPluginErrors = pluginErrors.filter(e_1 => 'plugin' in e_1 && e_1.plugin === selectedPlugin.plugin.name || e_1.source === pluginId_13 || e_1.source.startsWith(`${selectedPlugin.plugin.name}@`));
    const pluginErrorsSection = filteredPluginErrors.length === 0 ? null : <Box flexDirection="column" marginBottom={1}>
          <Text bold color="error">
            {filteredPluginErrors.length}{' '}
            {plural(filteredPluginErrors.length, 'error')}:
          </Text>
          {filteredPluginErrors.map((error_3, i_0) => {
        const guidance = getErrorGuidance(error_3);
        return <Box key={i_0} flexDirection="column" marginLeft={2}>
                <Text color="error">{formatErrorMessage(error_3)}</Text>
                {guidance && <Text dimColor italic>
                    {figures.arrowRight} {guidance}
                  </Text>}
              </Box>;
      })}
        </Box>;
    return <Box flexDirection="column">
        <Box>
          <Text bold>
            {selectedPlugin.plugin.name} @ {selectedPlugin.marketplace}
          </Text>
        </Box>

        {/* Scope */}
        <Box>
          <Text dimColor>Scope: </Text>
          <Text>{selectedPlugin.scope || 'user'}</Text>
        </Box>

        {/* Plugin details */}
        {selectedPlugin.plugin.manifest.version && <Box>
            <Text dimColor>Version: </Text>
            <Text>{selectedPlugin.plugin.manifest.version}</Text>
          </Box>}

        {selectedPlugin.plugin.manifest.description && <Box marginBottom={1}>
            <Text>{selectedPlugin.plugin.manifest.description}</Text>
          </Box>}

        {selectedPlugin.plugin.manifest.author && <Box>
            <Text dimColor>Author: </Text>
            <Text>{selectedPlugin.plugin.manifest.author.name}</Text>
          </Box>}

        {/* Current status */}
        <Box marginBottom={1}>
          <Text dimColor>Status: </Text>
          <Text color={isEnabled_2 ? 'success' : 'warning'}>
            {isEnabled_2 ? 'Enabled' : 'Disabled'}
          </Text>
          {selectedPlugin.pendingUpdate && <Text color="suggestion"> · Marked for update</Text>}
        </Box>

        {/* Installed components */}
        <PluginComponentsDisplay plugin={selectedPlugin.plugin} marketplace={selectedPlugin.marketplace} />

        {/* Plugin errors */}
        {pluginErrorsSection}

        {/* Menu */}
        <Box marginTop={1} flexDirection="column">
          {detailsMenuItems.map((item_9, index_0) => {
          const isSelected = index_0 === detailsMenuIndex;
          return <Box key={index_0}>
                {isSelected && <Text>{figures.pointer} </Text>}
                {!isSelected && <Text>{'  '}</Text>}
                <Text bold={isSelected} color={item_9.label.includes('Uninstall') ? 'error' : item_9.label.includes('Update') ? 'suggestion' : undefined}>
                  {item_9.label}
                </Text>
              </Box>;
        })}
        </Box>

        {/* Processing state */}
        {isProcessing && <Box marginTop={1}>
            <Text>Processing…</Text>
          </Box>}

        {/* Error message */}
        {processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              <ConfigurableShortcutHint action="select:previous" context="Select" fallback="↑" description="navigate" />
              <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }

  // Failed plugin detail view
  if (typeof viewState === 'object' && viewState.type === 'failed-plugin-details') {
    const failedPlugin_0 = viewState.plugin;
    const firstError = failedPlugin_0.errors[0];
    const errorMessage_0 = firstError ? formatErrorMessage(firstError) : 'Failed to load';
    return <Box flexDirection="column">
        <Text>
          <Text bold>{failedPlugin_0.name}</Text>
          <Text dimColor> @ {failedPlugin_0.marketplace}</Text>
          <Text dimColor> ({failedPlugin_0.scope})</Text>
        </Text>
        <Text color="error">{errorMessage_0}</Text>

        {failedPlugin_0.scope === 'managed' ? <Box marginTop={1}>
            <Text dimColor>
              Managed by your organization — contact your admin
            </Text>
          </Box> : <Box marginTop={1}>
            <Text color="suggestion">{figures.pointer} </Text>
            <Text bold>Remove</Text>
          </Box>}

        {isProcessing && <Text>Processing…</Text>}
        {processError && <Text color="error">{processError}</Text>}

        <Box marginTop={1}>
          <Text dimColor italic>
            <Byline>
              {failedPlugin_0.scope !== 'managed' && <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="remove" />}
              <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
            </Byline>
          </Text>
        </Box>
      </Box>;
  }

  // MCP detail view
  if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {
    const client_3 = viewState.client;
    const serverToolsCount = filterToolsByServer(mcpTools, client_3.name).length;

    // Common handlers for MCP menus
    const handleMcpViewTools = () => {
      setViewState({
        type: 'mcp-tools',
        client: client_3
      });
    };
    const handleMcpCancel = () => {
      setViewState('plugin-list');
    };
    const handleMcpComplete = (result_4?: string) => {
      if (result_4) {
        setResult(result_4);
      }
      setViewState('plugin-list');
    };

    // Transform MCPServerConnection to appropriate ServerInfo type
    const scope_5 = client_3.config.scope;
    const configType = client_3.config.type;
    if (configType === 'stdio') {
      const server: StdioServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'stdio',
        config: client_3.config as McpStdioServerConfig
      };
      return <MCPStdioServerMenu server={server} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'sse') {
      const server_0: SSEServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_3.config as McpSSEServerConfig
      };
      return <MCPRemoteServerMenu server={server_0} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'http') {
      const server_1: HTTPServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_3.config as McpHTTPServerConfig
      };
      return <MCPRemoteServerMenu server={server_1} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    } else if (configType === 'claudeai-proxy') {
      const server_2: ClaudeAIServerInfo = {
        name: client_3.name,
        client: client_3,
        scope: scope_5,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_3.config as McpClaudeAIProxyServerConfig
      };
      return <MCPRemoteServerMenu server={server_2} serverToolsCount={serverToolsCount} onViewTools={handleMcpViewTools} onCancel={handleMcpCancel} onComplete={handleMcpComplete} borderless />;
    }

    // Fallback - shouldn't happen but handle gracefully
    setViewState('plugin-list');
    return null;
  }

  // MCP tools view
  if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {
    const client_4 = viewState.client;
    const scope_6 = client_4.config.scope;
    const configType_0 = client_4.config.type;

    // Build ServerInfo for MCPToolListView
    let server_3: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType_0 === 'stdio') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'stdio',
        config: client_4.config as McpStdioServerConfig
      };
    } else if (configType_0 === 'sse') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_4.config as McpSSEServerConfig
      };
    } else if (configType_0 === 'http') {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_4.config as McpHTTPServerConfig
      };
    } else {
      server_3 = {
        name: client_4.name,
        client: client_4,
        scope: scope_6,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_4.config as McpClaudeAIProxyServerConfig
      };
    }
    return <MCPToolListView server={server_3} onSelectTool={(tool: Tool) => {
      setViewState({
        type: 'mcp-tool-detail',
        client: client_4,
        tool
      });
    }} onBack={() => setViewState({
      type: 'mcp-detail',
      client: client_4
    })} />;
  }

  // MCP tool detail view
  if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {
    const {
      client: client_5,
      tool: tool_0
    } = viewState;
    const scope_7 = client_5.config.scope;
    const configType_1 = client_5.config.type;

    // Build ServerInfo for MCPToolDetailView
    let server_4: StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo;
    if (configType_1 === 'stdio') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'stdio',
        config: client_5.config as McpStdioServerConfig
      };
    } else if (configType_1 === 'sse') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'sse',
        isAuthenticated: undefined,
        config: client_5.config as McpSSEServerConfig
      };
    } else if (configType_1 === 'http') {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'http',
        isAuthenticated: undefined,
        config: client_5.config as McpHTTPServerConfig
      };
    } else {
      server_4 = {
        name: client_5.name,
        client: client_5,
        scope: scope_7,
        transport: 'claudeai-proxy',
        isAuthenticated: undefined,
        config: client_5.config as McpClaudeAIProxyServerConfig
      };
    }
    return <MCPToolDetailView tool={tool_0} server={server_4} onBack={() => setViewState({
      type: 'mcp-tools',
      client: client_5
    })} />;
  }

  // Plugin list view (main management interface)
  const visibleItems = pagination.getVisibleItems(filteredItems);
  return <Box flexDirection="column">
      {/* Search box */}
      <Box marginBottom={1}>
        <SearchBox query={searchQuery} isFocused={isSearchMode} isTerminalFocused={isTerminalFocused} width={terminalWidth - 4} cursorOffset={searchCursorOffset} />
      </Box>

      {/* No search results */}
      {filteredItems.length === 0 && searchQuery && <Box marginBottom={1}>
          <Text dimColor>No items match &quot;{searchQuery}&quot;</Text>
        </Box>}

      {/* Scroll up indicator */}
      {pagination.scrollPosition.canScrollUp && <Box>
          <Text dimColor> {figures.arrowUp} more above</Text>
        </Box>}

      {/* Unified list of plugins and MCPs grouped by scope */}
      {visibleItems.map((item_10, visibleIndex) => {
      const actualIndex = pagination.toActualIndex(visibleIndex);
      const isSelected_0 = actualIndex === selectedIndex && !isSearchMode;

      // Check if we need to show a scope header
      const prevItem = visibleIndex > 0 ? visibleItems[visibleIndex - 1] : null;
      const showScopeHeader = !prevItem || prevItem.scope !== item_10.scope;

      // Get scope label
      const getScopeLabel = (scope_8: string): string => {
        switch (scope_8) {
          case 'flagged':
            return 'Flagged';
          case 'project':
            return 'Project';
          case 'local':
            return 'Local';
          case 'user':
            return 'User';
          case 'enterprise':
            return 'Enterprise';
          case 'managed':
            return 'Managed';
          case 'builtin':
            return 'Built-in';
          case 'dynamic':
            return 'Built-in';
          default:
            return scope_8;
        }
      };
      return <React.Fragment key={item_10.id}>
            {showScopeHeader && <Box marginTop={visibleIndex > 0 ? 1 : 0} paddingLeft={2}>
                <Text dimColor={item_10.scope !== 'flagged'} color={item_10.scope === 'flagged' ? 'warning' : undefined} bold={item_10.scope === 'flagged'}>
                  {getScopeLabel(item_10.scope)}
                </Text>
              </Box>}
            <UnifiedInstalledCell item={item_10} isSelected={isSelected_0} />
          </React.Fragment>;
    })}

      {/* Scroll down indicator */}
      {pagination.scrollPosition.canScrollDown && <Box>
          <Text dimColor> {figures.arrowDown} more below</Text>
        </Box>}

      {/* Help text */}
      <Box marginTop={1} marginLeft={1}>
        <Text dimColor italic>
          <Byline>
            <Text>type to search</Text>
            <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />
            <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />
          </Byline>
        </Text>
      </Box>

      {/* Reload disclaimer for plugin changes */}
      {pendingToggles.size > 0 && <Box marginLeft={1}>
          <Text dimColor italic>
            Run /reload-plugins to apply changes
          </Text>
        </Box>}
    </Box>;
}
