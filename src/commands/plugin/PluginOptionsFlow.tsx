/**
 * Post-install/post-enable config prompt.
 *
 * Given a LoadedPlugin, checks both the top-level manifest.userConfig and the
 * channel-specific userConfig. Walks PluginOptionsDialog through each
 * unconfigured item, saving via the appropriate storage function. Calls
 * onDone('skipped') immediately if nothing needs filling.
 */

import * as React from 'react';
import type { LoadedPlugin } from '../../types/plugin.js';
import { errorMessage } from '../../utils/errors.js';
import { loadMcpServerUserConfig, saveMcpServerUserConfig } from '../../utils/plugins/mcpbHandler.js';
import { getUnconfiguredChannels, type UnconfiguredChannel } from '../../utils/plugins/mcpPluginIntegration.js';
import { loadAllPlugins } from '../../utils/plugins/pluginLoader.js';
import { getUnconfiguredOptions, loadPluginOptions, type PluginOptionSchema, type PluginOptionValues, savePluginOptions } from '../../utils/plugins/pluginOptionsStorage.js';
import { PluginOptionsDialog } from './PluginOptionsDialog.js';

/**
 * Post-install lookup: return the LoadedPlugin for the just-installed
 * pluginId so the caller can divert to PluginOptionsFlow. Returns undefined
 * if the plugin somehow didn't make it into the fresh load — callers treat
 * undefined as "carry on closing."
 *
 * Install should have cleared caches already; loadAllPlugins reads fresh.
 */
export async function findPluginOptionsTarget(pluginId: string): Promise<LoadedPlugin | undefined> {
  const {
    enabled,
    disabled
  } = await loadAllPlugins();
  return [...enabled, ...disabled].find(p => p.repository === pluginId || p.source === pluginId);
}

/**
 * A single dialog step in the walk. Top-level options and channels both
 * collapse to this shape — the only difference is which save function runs.
 */
type ConfigStep = {
  key: string;
  title: string;
  subtitle: string;
  schema: PluginOptionSchema;
  /** Returns any already-saved values so PluginOptionsDialog can pre-fill and
   *  skip unchanged sensitive fields on reconfigure. */
  load: () => PluginOptionValues | undefined;
  save: (values: PluginOptionValues) => void;
};
type Props = {
  plugin: LoadedPlugin;
  /** `name@marketplace` — the savePluginOptions / saveMcpServerUserConfig key. */
  pluginId: string;
  /**
   * `configured` = user filled all fields. `skipped` = nothing needed
   * configuring, or user hit cancel. `error` = save threw.
   */
  onDone: (outcome: 'configured' | 'skipped' | 'error', detail?: string) => void;
};
export function PluginOptionsFlow({
  plugin,
  pluginId,
  onDone
}: Props): React.ReactNode {
  // Build the step list once at mount. Re-calling after a save would drop the
  // item we just configured.
  const [steps] = React.useState<ConfigStep[]>(() => {
    const result: ConfigStep[] = [];

    // Top-level manifest.userConfig
    const unconfigured = getUnconfiguredOptions(plugin);
    if (Object.keys(unconfigured).length > 0) {
      result.push({
        key: 'top-level',
        title: `Налаштувати ${plugin.name}`,
        subtitle: 'Опції плагіна',
        schema: unconfigured,
        load: () => loadPluginOptions(pluginId),
        save: values => savePluginOptions(pluginId, values, plugin.manifest.userConfig!)
      });
    }

    // Per-channel userConfig (assistant-mode channels)
    const channels: UnconfiguredChannel[] = getUnconfiguredChannels(plugin);
    for (const channel of channels) {
      result.push({
        key: `channel:${channel.server}`,
        title: `Налаштувати ${channel.displayName}`,
        subtitle: `Плагін: ${plugin.name}`,
        schema: channel.configSchema,
        load: () => loadMcpServerUserConfig(pluginId, channel.server) ?? undefined,
        save: values_0 => saveMcpServerUserConfig(pluginId, channel.server, values_0, channel.configSchema)
      });
    }
    return result;
  });
  const [index, setIndex] = React.useState(0);

  // Latest-ref: lets the effect close over the current onDone without
  // re-running when the parent re-renders.
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  // Nothing to configure → tell the caller and render nothing. Effect,
  // not inline call: calling setState in the parent during our render
  // is a React rules-of-hooks violation.
  React.useEffect(() => {
    if (steps.length === 0) {
      onDoneRef.current('skipped');
    }
  }, [steps.length]);
  if (steps.length === 0) {
    return null;
  }
  const current = steps[index]!;
  function handleSave(values_1: PluginOptionValues): void {
    try {
      current.save(values_1);
    } catch (err) {
      onDone('error', errorMessage(err));
      return;
    }
    const next = index + 1;
    if (next < steps.length) {
      setIndex(next);
    } else {
      onDone('configured');
    }
  }

  // key forces a remount when advancing to the next step — React would
  // otherwise reuse the instance and carry PluginOptionsDialog's
  // internal useState (field index, typed values) over.
  return <PluginOptionsDialog key={current.key} title={current.title} subtitle={current.subtitle} configSchema={current.schema} initialValues={current.load()} onSave={handleSave} onCancel={() => onDone('skipped')} />;
}
