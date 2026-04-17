import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- useInput needed for marketplace-specific u/r shortcuts and y/n confirmation not in keybinding schema
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LoadedPlugin } from '../../types/plugin.js';
import { count } from '../../utils/array.js';
import { shouldSkipPluginAutoupdate } from '../../utils/config.js';
import { errorMessage } from '../../utils/errors.js';
import { clearAllCaches } from '../../utils/plugins/cacheUtils.js';
import { createPluginId, formatMarketplaceLoadingErrors, getMarketplaceSourceDisplay, loadMarketplacesWithGracefulDegradation } from '../../utils/plugins/marketplaceHelpers.js';
import { loadKnownMarketplacesConfig, refreshMarketplace, removeMarketplaceSource, setMarketplaceAutoUpdate } from '../../utils/plugins/marketplaceManager.js';
import { updatePluginsForMarketplaces } from '../../utils/plugins/pluginAutoupdate.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { isMarketplaceAutoUpdate } from '../../utils/plugins/schemas.js';
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js';
import { plural } from '../../utils/stringUtils.js';
import type { ViewState } from './types.js';
type Props = {
  setViewState: (state: ViewState) => void;
  error?: string | null;
  setError?: (error: string | null) => void;
  setResult: (result: string | null) => void;
  exitState: {
    pending: boolean;
    keyName: 'Ctrl-C' | 'Ctrl-D' | null;
  };
  onManageComplete?: () => void | Promise<void>;
  targetMarketplace?: string;
  action?: 'update' | 'remove';
};
type MarketplaceState = {
  name: string;
  source: string;
  lastUpdated?: string;
  pluginCount?: number;
  installedPlugins?: LoadedPlugin[];
  pendingUpdate?: boolean;
  pendingRemove?: boolean;
  autoUpdate?: boolean;
};
type InternalViewState = 'list' | 'details' | 'confirm-remove';
export function ManageMarketplaces({
  setViewState,
  error,
  setError,
  setResult,
  exitState,
  onManageComplete,
  targetMarketplace,
  action
}: Props): React.ReactNode {
  const [marketplaceStates, setMarketplaceStates] = useState<MarketplaceState[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [internalView, setInternalView] = useState<InternalViewState>('list');
  const [selectedMarketplace, setSelectedMarketplace] = useState<MarketplaceState | null>(null);
  const [detailsMenuIndex, setDetailsMenuIndex] = useState(0);
  const hasAttemptedAutoAction = useRef(false);

  // Load marketplaces and their installed plugins
  useEffect(() => {
    async function loadMarketplaces() {
      try {
        const config = await loadKnownMarketplacesConfig();
        const {
          enabled,
          disabled
        } = await loadAllPlugins();
        const allPlugins = [...enabled, ...disabled];

        // Load marketplaces with graceful degradation
        const {
          marketplaces,
          failures
        } = await loadMarketplacesWithGracefulDegradation(config);
        const states: MarketplaceState[] = [];
        for (const {
          name,
          config: entry,
          data: marketplace
        } of marketplaces) {
          // Get all plugins installed from this marketplace
          const installedFromMarketplace = allPlugins.filter(plugin => plugin.source.endsWith(`@${name}`));
          states.push({
            name,
            source: getMarketplaceSourceDisplay(entry.source),
            lastUpdated: entry.lastUpdated,
            pluginCount: marketplace?.plugins.length,
            installedPlugins: installedFromMarketplace,
            pendingUpdate: false,
            pendingRemove: false,
            autoUpdate: isMarketplaceAutoUpdate(name, entry)
          });
        }

        // Sort: claude-plugin-directory first, then alphabetically
        states.sort((a, b) => {
          if (a.name === 'claude-plugin-directory') return -1;
          if (b.name === 'claude-plugin-directory') return 1;
          return a.name.localeCompare(b.name);
        });
        setMarketplaceStates(states);

        // Handle marketplace loading errors/warnings
        const successCount = count(marketplaces, m => m.data !== null);
        const errorResult = formatMarketplaceLoadingErrors(failures, successCount);
        if (errorResult) {
          if (errorResult.type === 'warning') {
            setProcessError(errorResult.message);
          } else {
            throw new Error(errorResult.message);
          }
        }

        // Auto-execute if target and action provided
        if (targetMarketplace && !hasAttemptedAutoAction.current && !error) {
          hasAttemptedAutoAction.current = true;
          const targetIndex = states.findIndex(s => s.name === targetMarketplace);
          if (targetIndex >= 0) {
            const targetState = states[targetIndex];
            if (action) {
              // Mark the action as pending and execute
              setSelectedIndex(targetIndex + 1); // +1 because "Add Marketplace" is at index 0
              const newStates = [...states];
              if (action === 'update') {
                newStates[targetIndex]!.pendingUpdate = true;
              } else if (action === 'remove') {
                newStates[targetIndex]!.pendingRemove = true;
              }
              setMarketplaceStates(newStates);
              // Apply the change immediately
              setTimeout(applyChanges, 100, newStates);
            } else if (targetState) {
              // No action - just show the details view for this marketplace
              setSelectedIndex(targetIndex + 1); // +1 because "Add Marketplace" is at index 0
              setSelectedMarketplace(targetState);
              setInternalView('details');
            }
          } else if (setError) {
            setError(`Marketplace not found: ${targetMarketplace}`);
          }
        }
      } catch (err) {
        if (setError) {
          setError(err instanceof Error ? err.message : 'Failed to load marketplaces');
        }
        setProcessError(err instanceof Error ? err.message : 'Failed to load marketplaces');
      } finally {
        setLoading(false);
      }
    }
    void loadMarketplaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, [targetMarketplace, action, error]);

  // Check if there are any pending changes
  const hasPendingChanges = () => {
    return marketplaceStates.some(state => state.pendingUpdate || state.pendingRemove);
  };

  // Get count of pending operations
  const getPendingCounts = () => {
    const updateCount = count(marketplaceStates, s => s.pendingUpdate);
    const removeCount = count(marketplaceStates, s => s.pendingRemove);
    return {
      updateCount,
      removeCount
    };
  };

  // Apply all pending changes
  const applyChanges = async (states?: MarketplaceState[]) => {
    const statesToProcess = states || marketplaceStates;
    const wasInDetailsView = internalView === 'details';
    setIsProcessing(true);
    setProcessError(null);
    setSuccessMessage(null);
    setProgressMessage(null);
    try {
      const settings = getSettingsForSource('userSettings');
      let updatedCount = 0;
      let removedCount = 0;
      const refreshedMarketplaces = new Set<string>();
      for (const state of statesToProcess) {
        // Handle remove
        if (state.pendingRemove) {
          // First uninstall all plugins from this marketplace
          if (state.installedPlugins && state.installedPlugins.length > 0) {
            const newEnabledPlugins = {
              ...settings?.enabledPlugins
            };
            for (const plugin of state.installedPlugins) {
              const pluginId = createPluginId(plugin.name, state.name);
              // Mark as disabled/uninstalled
              newEnabledPlugins[pluginId] = false;
            }
            updateSettingsForSource('userSettings', {
              enabledPlugins: newEnabledPlugins
            });
          }

          // Then remove the marketplace
          await removeMarketplaceSource(state.name);
          removedCount++;
          logEvent('tengu_marketplace_removed', {
            marketplace_name: state.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            plugins_uninstalled: state.installedPlugins?.length || 0
          });
          continue;
        }

        // Handle update
        if (state.pendingUpdate) {
          // Refresh individual marketplace for efficiency with progress reporting
          await refreshMarketplace(state.name, (message: string) => {
            setProgressMessage(message);
          });
          updatedCount++;
          refreshedMarketplaces.add(state.name.toLowerCase());
          logEvent('tengu_marketplace_updated', {
            marketplace_name: state.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
        }
      }

      // After marketplace clones are refreshed, bump installed plugins from
      // those marketplaces to the new version. Without this, the loader's
      // cache-on-miss (copyPluginToVersionedCache) creates the new version
      // dir on the next loadAllPlugins() call, but installed_plugins.json
      // stays on the old version — so cleanupOrphanedPluginVersionsInBackground
      // stamps the NEW dir with .orphaned_at on the next startup. See #29512.
      // updatePluginOp (called inside the helper) is what actually writes
      // installed_plugins.json via updateInstallationPathOnDisk.
      let updatedPluginCount = 0;
      if (refreshedMarketplaces.size > 0) {
        const updatedPluginIds = await updatePluginsForMarketplaces(refreshedMarketplaces);
        updatedPluginCount = updatedPluginIds.length;
      }

      // Clear caches after changes
      clearAllCaches();

      // Call completion callback
      if (onManageComplete) {
        await onManageComplete();
      }

      // Reload marketplace data to show updated timestamps
      const config = await loadKnownMarketplacesConfig();
      const {
        enabled,
        disabled
      } = await loadAllPlugins();
      const allPlugins = [...enabled, ...disabled];
      const {
        marketplaces
      } = await loadMarketplacesWithGracefulDegradation(config);
      const newStates: MarketplaceState[] = [];
      for (const {
        name,
        config: entry,
        data: marketplace
      } of marketplaces) {
        const installedFromMarketplace = allPlugins.filter(plugin => plugin.source.endsWith(`@${name}`));
        newStates.push({
          name,
          source: getMarketplaceSourceDisplay(entry.source),
          lastUpdated: entry.lastUpdated,
          pluginCount: marketplace?.plugins.length,
          installedPlugins: installedFromMarketplace,
          pendingUpdate: false,
          pendingRemove: false,
          autoUpdate: isMarketplaceAutoUpdate(name, entry)
        });
      }

      // Sort: claude-plugin-directory first, then alphabetically
      newStates.sort((a, b) => {
        if (a.name === 'claude-plugin-directory') return -1;
        if (b.name === 'claude-plugin-directory') return 1;
        return a.name.localeCompare(b.name);
      });
      setMarketplaceStates(newStates);

      // Update selected marketplace reference with fresh data
      if (wasInDetailsView && selectedMarketplace) {
        const updatedMarketplace = newStates.find(s => s.name === selectedMarketplace.name);
        if (updatedMarketplace) {
          setSelectedMarketplace(updatedMarketplace);
        }
      }

      // Build success message
      const actions: string[] = [];
      if (updatedCount > 0) {
        const pluginPart = updatedPluginCount > 0 ? ` (${updatedPluginCount} ${plural(updatedPluginCount, 'plugin')} bumped)` : '';
        actions.push(`Updated ${updatedCount} ${plural(updatedCount, 'marketplace')}${pluginPart}`);
      }
      if (removedCount > 0) {
        actions.push(`Removed ${removedCount} ${plural(removedCount, 'marketplace')}`);
      }
      if (actions.length > 0) {
        const successMsg = `${figures.tick} ${actions.join(', ')}`;
        // If we were in details view, stay there and show success
        if (wasInDetailsView) {
          setSuccessMessage(successMsg);
        } else {
          // Otherwise show result and exit to menu
          setResult(successMsg);
          setTimeout(setViewState, 2000, {
            type: 'menu' as const
          });
        }
      } else if (!wasInDetailsView) {
        setViewState({
          type: 'menu'
        });
      }
    } catch (err) {
      const errorMsg = errorMessage(err);
      setProcessError(errorMsg);
      if (setError) {
        setError(errorMsg);
      }
    } finally {
      setIsProcessing(false);
      setProgressMessage(null);
    }
  };

  // Handle confirming marketplace removal
  const confirmRemove = async () => {
    if (!selectedMarketplace) return;

    // Mark for removal and apply
    const newStates = marketplaceStates.map(state => state.name === selectedMarketplace.name ? {
      ...state,
      pendingRemove: true
    } : state);
    setMarketplaceStates(newStates);
    await applyChanges(newStates);
  };

  // Build menu options for details view
  const buildDetailsMenuOptions = (marketplace: MarketplaceState | null): Array<{
    label: string;
    secondaryLabel?: string;
    value: string;
  }> => {
    if (!marketplace) return [];
    const options: Array<{
      label: string;
      secondaryLabel?: string;
      value: string;
    }> = [{
      label: `Огляд плагінів (${marketplace.pluginCount ?? 0})`,
      value: 'browse'
    }, {
      label: 'Оновити marketplace',
      secondaryLabel: marketplace.lastUpdated ? `(востаннє оновлено ${new Date(marketplace.lastUpdated).toLocaleDateString()})` : undefined,
      value: 'update'
    }];

    // Only show auto-update toggle if auto-updater is not globally disabled
    if (!shouldSkipPluginAutoupdate()) {
      options.push({
        label: marketplace.autoUpdate ? 'Вимкнути автооновлення' : 'Увімкнути автооновлення',
        value: 'toggle-auto-update'
      });
    }
    options.push({
      label: 'Видалити marketplace',
      value: 'remove'
    });
    return options;
  };

  // Handle toggling auto-update for a marketplace
  const handleToggleAutoUpdate = async (marketplace: MarketplaceState) => {
    const newAutoUpdate = !marketplace.autoUpdate;
    try {
      await setMarketplaceAutoUpdate(marketplace.name, newAutoUpdate);

      // Update local state
      setMarketplaceStates(prev => prev.map(state => state.name === marketplace.name ? {
        ...state,
        autoUpdate: newAutoUpdate
      } : state));

      // Update selected marketplace reference
      setSelectedMarketplace(prev => prev ? {
        ...prev,
        autoUpdate: newAutoUpdate
      } : prev);
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : 'Failed to update setting');
    }
  };

  // Escape in details or confirm-remove view - go back to list
  useKeybinding('confirm:no', () => {
    setInternalView('list');
    setDetailsMenuIndex(0);
  }, {
    context: 'Confirmation',
    isActive: !isProcessing && (internalView === 'details' || internalView === 'confirm-remove')
  });

  // Escape in list view with pending changes - clear pending changes
  useKeybinding('confirm:no', () => {
    setMarketplaceStates(prev => prev.map(state => ({
      ...state,
      pendingUpdate: false,
      pendingRemove: false
    })));
    setSelectedIndex(0);
  }, {
    context: 'Confirmation',
    isActive: !isProcessing && internalView === 'list' && hasPendingChanges()
  });

  // Escape in list view without pending changes - exit to parent menu
  useKeybinding('confirm:no', () => {
    setViewState({
      type: 'menu'
    });
  }, {
    context: 'Confirmation',
    isActive: !isProcessing && internalView === 'list' && !hasPendingChanges()
  });

  // List view — navigation (up/down/enter via configurable keybindings)
  useKeybindings({
    'select:previous': () => setSelectedIndex(prev => Math.max(0, prev - 1)),
    'select:next': () => {
      const totalItems = marketplaceStates.length + 1;
      setSelectedIndex(prev => Math.min(totalItems - 1, prev + 1));
    },
    'select:accept': () => {
      const marketplaceIndex = selectedIndex - 1;
      if (selectedIndex === 0) {
        setViewState({
          type: 'add-marketplace'
        });
      } else if (hasPendingChanges()) {
        void applyChanges();
      } else {
        const marketplace = marketplaceStates[marketplaceIndex];
        if (marketplace) {
          setSelectedMarketplace(marketplace);
          setInternalView('details');
          setDetailsMenuIndex(0);
        }
      }
    }
  }, {
    context: 'Select',
    isActive: !isProcessing && internalView === 'list'
  });

  // List view — marketplace-specific actions (u/r shortcuts)
  useInput(input => {
    const marketplaceIndex = selectedIndex - 1;
    if ((input === 'u' || input === 'U') && marketplaceIndex >= 0) {
      setMarketplaceStates(prev => prev.map((state, idx) => idx === marketplaceIndex ? {
        ...state,
        pendingUpdate: !state.pendingUpdate,
        pendingRemove: state.pendingUpdate ? state.pendingRemove : false
      } : state));
    } else if ((input === 'r' || input === 'R') && marketplaceIndex >= 0) {
      const marketplace = marketplaceStates[marketplaceIndex];
      if (marketplace) {
        setSelectedMarketplace(marketplace);
        setInternalView('confirm-remove');
      }
    }
  }, {
    isActive: !isProcessing && internalView === 'list'
  });

  // Details view — navigation
  useKeybindings({
    'select:previous': () => setDetailsMenuIndex(prev => Math.max(0, prev - 1)),
    'select:next': () => {
      const menuOptions = buildDetailsMenuOptions(selectedMarketplace);
      setDetailsMenuIndex(prev => Math.min(menuOptions.length - 1, prev + 1));
    },
    'select:accept': () => {
      if (!selectedMarketplace) return;
      const menuOptions = buildDetailsMenuOptions(selectedMarketplace);
      const selectedOption = menuOptions[detailsMenuIndex];
      if (selectedOption?.value === 'browse') {
        setViewState({
          type: 'browse-marketplace',
          targetMarketplace: selectedMarketplace.name
        });
      } else if (selectedOption?.value === 'update') {
        const newStates = marketplaceStates.map(state => state.name === selectedMarketplace.name ? {
          ...state,
          pendingUpdate: true
        } : state);
        setMarketplaceStates(newStates);
        void applyChanges(newStates);
      } else if (selectedOption?.value === 'toggle-auto-update') {
        void handleToggleAutoUpdate(selectedMarketplace);
      } else if (selectedOption?.value === 'remove') {
        setInternalView('confirm-remove');
      }
    }
  }, {
    context: 'Select',
    isActive: !isProcessing && internalView === 'details'
  });

  // Confirm-remove view — y/n input
  useInput(input => {
    if (input === 'y' || input === 'Y') {
      void confirmRemove();
    } else if (input === 'n' || input === 'N') {
      setInternalView('list');
      setSelectedMarketplace(null);
    }
  }, {
    isActive: !isProcessing && internalView === 'confirm-remove'
  });
  if (loading) {
    return <Text>Завантаження marketplaces…</Text>;
  }
  if (marketplaceStates.length === 0) {
    return <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Керування marketplaces</Text>
        </Box>

        {/* Add Marketplace option */}
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">{figures.pointer} +</Text>
          <Text bold color="suggestion">
            Додати marketplace
          </Text>
        </Box>

        <Box marginLeft={3}>
          <Text dimColor italic>
            {exitState.pending ? <>Натисніть {exitState.keyName} ще раз для повернення</> : <Byline>
                <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="обрати" />
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="назад" />
              </Byline>}
          </Text>
        </Box>
      </Box>;
  }

  // Show confirmation dialog
  if (internalView === 'confirm-remove' && selectedMarketplace) {
    const pluginCount = selectedMarketplace.installedPlugins?.length || 0;
    return <Box flexDirection="column">
        <Text bold color="warning">
          Видалити marketplace <Text italic>{selectedMarketplace.name}</Text>?
        </Text>
        <Box flexDirection="column">
          {pluginCount > 0 && <Box marginTop={1}>
              <Text color="warning">
                Це також видалить {pluginCount}{' '}
                плагін(ів) з цього marketplace:
              </Text>
            </Box>}
          {selectedMarketplace.installedPlugins && selectedMarketplace.installedPlugins.length > 0 && <Box flexDirection="column" marginTop={1} marginLeft={2}>
                {selectedMarketplace.installedPlugins.map(plugin => <Text key={plugin.name} dimColor>
                    • {plugin.name}
                  </Text>)}
              </Box>}
          <Box marginTop={1}>
            <Text>
              Натисніть <Text bold>y</Text> для підтвердження або <Text bold>n</Text> для
              скасування
            </Text>
          </Box>
        </Box>
      </Box>;
  }

  // Show marketplace details
  if (internalView === 'details' && selectedMarketplace) {
    // Check if this marketplace is currently being processed
    // Check pendingUpdate first so we show updating state immediately when user presses Enter
    const isUpdating = selectedMarketplace.pendingUpdate || isProcessing;
    const menuOptions = buildDetailsMenuOptions(selectedMarketplace);
    return <Box flexDirection="column">
        <Text bold>{selectedMarketplace.name}</Text>
        <Text dimColor>{selectedMarketplace.source}</Text>
        <Box marginTop={1}>
          <Text>
            Доступно {selectedMarketplace.pluginCount || 0} плагін(ів)
          </Text>
        </Box>

        {/* Installed plugins section */}
        {selectedMarketplace.installedPlugins && selectedMarketplace.installedPlugins.length > 0 && <Box flexDirection="column" marginTop={1}>
              <Text bold>
                Встановлені плагіни ({selectedMarketplace.installedPlugins.length}
                ):
              </Text>
              <Box flexDirection="column" marginLeft={1}>
                {selectedMarketplace.installedPlugins.map(plugin => <Box key={plugin.name} flexDirection="row" gap={1}>
                    <Text>{figures.bullet}</Text>
                    <Box flexDirection="column">
                      <Text>{plugin.name}</Text>
                      <Text dimColor>{plugin.manifest.description}</Text>
                    </Box>
                  </Box>)}
              </Box>
            </Box>}

        {/* Processing indicator */}
        {isUpdating && <Box marginTop={1} flexDirection="column">
            <Text color="claude">Оновлення marketplace…</Text>
            {progressMessage && <Text dimColor>{progressMessage}</Text>}
          </Box>}

        {/* Success message */}
        {!isUpdating && successMessage && <Box marginTop={1}>
            <Text color="claude">{successMessage}</Text>
          </Box>}

        {/* Error message */}
        {!isUpdating && processError && <Box marginTop={1}>
            <Text color="error">{processError}</Text>
          </Box>}

        {/* Menu options */}
        {!isUpdating && <Box flexDirection="column" marginTop={1}>
            {menuOptions.map((option, idx) => {
          if (!option) return null;
          const isSelected = idx === detailsMenuIndex;
          return <Box key={option.value}>
                  <Text color={isSelected ? 'suggestion' : undefined}>
                    {isSelected ? figures.pointer : ' '} {option.label}
                  </Text>
                  {option.secondaryLabel && <Text dimColor> {option.secondaryLabel}</Text>}
                </Box>;
        })}
          </Box>}

        {/* Show explanatory text at the bottom when auto-update is enabled */}
        {!isUpdating && !shouldSkipPluginAutoupdate() && selectedMarketplace.autoUpdate && <Box marginTop={1}>
              <Text dimColor>
                Автооновлення увімкнено. Нейромережа автоматично оновлюватиме цей
                marketplace і встановлені з нього плагіни.
              </Text>
            </Box>}

        <Box marginLeft={3}>
          <Text dimColor italic>
            {isUpdating ? <>Зачекайте…</> : <Byline>
                <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="обрати" />
                <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="назад" />
              </Byline>}
          </Text>
        </Box>
      </Box>;
  }

  // Show marketplace list
  const {
    updateCount,
    removeCount
  } = getPendingCounts();
  return <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Керування marketplaces</Text>
      </Box>

      {/* Add Marketplace option */}
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Text color={selectedIndex === 0 ? 'suggestion' : undefined}>
          {selectedIndex === 0 ? figures.pointer : ' '} +
        </Text>
        <Text bold color={selectedIndex === 0 ? 'suggestion' : undefined}>
          Додати marketplace
        </Text>
      </Box>

      {/* Marketplace list */}
      <Box flexDirection="column">
        {marketplaceStates.map((state, idx) => {
        const isSelected = idx + 1 === selectedIndex; // +1 because Add Marketplace is at index 0

        // Build status indicators
        const indicators: string[] = [];
        if (state.pendingUpdate) indicators.push('ОНОВИТИ');
        if (state.pendingRemove) indicators.push('ВИДАЛИТИ');
        return <Box key={state.name} flexDirection="row" gap={1} marginBottom={1}>
              <Text color={isSelected ? 'suggestion' : undefined}>
                {isSelected ? figures.pointer : ' '}{' '}
                {state.pendingRemove ? figures.cross : figures.bullet}
              </Text>
              <Box flexDirection="column" flexGrow={1}>
                <Box flexDirection="row" gap={1}>
                  <Text bold strikethrough={state.pendingRemove} dimColor={state.pendingRemove}>
                    {state.name === 'claude-plugins-official' && <Text color="claude">✻ </Text>}
                    {state.name}
                    {state.name === 'claude-plugins-official' && <Text color="claude"> ✻</Text>}
                  </Text>
                  {indicators.length > 0 && <Text color="warning">[{indicators.join(', ')}]</Text>}
                </Box>
                <Text dimColor>{state.source}</Text>
                <Text dimColor>
                  {state.pluginCount !== undefined && <>{state.pluginCount} доступно</>}
                  {state.installedPlugins && state.installedPlugins.length > 0 && <> • {state.installedPlugins.length} встановлено</>}
                  {state.lastUpdated && <>
                      {' '}
                      • Оновлено{' '}
                      {new Date(state.lastUpdated).toLocaleDateString()}
                    </>}
                </Text>
              </Box>
            </Box>;
      })}
      </Box>

      {/* Pending changes summary */}
      {hasPendingChanges() && <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>Очікувані зміни:</Text>{' '}
            <Text dimColor>Enter — застосувати</Text>
          </Text>
          {updateCount > 0 && <Text>
              • Оновити {updateCount} marketplace(ів)
            </Text>}
          {removeCount > 0 && <Text color="warning">
              • Видалити {removeCount} marketplace(ів)
            </Text>}
        </Box>}

      {/* Processing indicator */}
      {isProcessing && <Box marginTop={1}>
          <Text color="claude">Обробка змін…</Text>
        </Box>}

      {/* Error display */}
      {processError && <Box marginTop={1}>
          <Text color="error">{processError}</Text>
        </Box>}

      <ManageMarketplacesKeyHints exitState={exitState} hasPendingActions={hasPendingChanges()} />
    </Box>;
}
type ManageMarketplacesKeyHintsProps = {
  exitState: Props['exitState'];
  hasPendingActions: boolean;
};
function ManageMarketplacesKeyHints(t0) {
  const $ = _c(18);
  const {
    exitState,
    hasPendingActions
  } = t0;
  if (exitState.pending) {
    let t1;
    if ($[0] !== exitState.keyName) {
      t1 = <Box marginTop={1}><Text dimColor={true} italic={true}>Натисніть {exitState.keyName} ще раз для повернення</Text></Box>;
      $[0] = exitState.keyName;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== hasPendingActions) {
    t1 = hasPendingActions && <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="apply changes" />;
    $[2] = hasPendingActions;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== hasPendingActions) {
    t2 = !hasPendingActions && <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="select" />;
    $[4] = hasPendingActions;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== hasPendingActions) {
    t3 = !hasPendingActions && <KeyboardShortcutHint shortcut="u" action="update" />;
    $[6] = hasPendingActions;
    $[7] = t3;
  } else {
    t3 = $[7];
  }
  let t4;
  if ($[8] !== hasPendingActions) {
    t4 = !hasPendingActions && <KeyboardShortcutHint shortcut="r" action="remove" />;
    $[8] = hasPendingActions;
    $[9] = t4;
  } else {
    t4 = $[9];
  }
  const t5 = hasPendingActions ? "cancel" : "go back";
  let t6;
  if ($[10] !== t5) {
    t6 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description={t5} />;
    $[10] = t5;
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  let t7;
  if ($[12] !== t1 || $[13] !== t2 || $[14] !== t3 || $[15] !== t4 || $[16] !== t6) {
    t7 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t1}{t2}{t3}{t4}{t6}</Byline></Text></Box>;
    $[12] = t1;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
    $[16] = t6;
    $[17] = t7;
  } else {
    t7 = $[17];
  }
  return t7;
}
