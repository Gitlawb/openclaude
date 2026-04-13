import { c as _c } from "react-compiler-runtime";
/**
 * Shared helper functions and types for plugin details views
 *
 * Used by both DiscoverPlugins and BrowseMarketplace components.
 */

import * as React from 'react';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { Byline } from '../../components/design-system/Byline.js';
import { Box, Text } from '../../ink.js';
import type { PluginMarketplaceEntry } from '../../utils/plugins/schemas.js';

/**
 * Represents a plugin available for installation from a marketplace
 */
export type InstallablePlugin = {
  entry: PluginMarketplaceEntry;
  marketplaceName: string;
  pluginId: string;
  isInstalled: boolean;
};

/**
 * Menu option for plugin details view
 */
export type PluginDetailsMenuOption = {
  label: string;
  action: string;
};

/**
 * Extract GitHub repo info from a plugin's source
 */
export function extractGitHubRepo(plugin: InstallablePlugin): string | null {
  const isGitHub = plugin.entry.source && typeof plugin.entry.source === 'object' && 'source' in plugin.entry.source && plugin.entry.source.source === 'github';
  if (isGitHub && typeof plugin.entry.source === 'object' && 'repo' in plugin.entry.source) {
    return plugin.entry.source.repo;
  }
  return null;
}

/**
 * Build menu options for plugin details view with scoped installation options
 */
export function buildPluginDetailsMenuOptions(hasHomepage: string | undefined, githubRepo: string | null): PluginDetailsMenuOption[] {
  const options: PluginDetailsMenuOption[] = [{
    label: 'Install for you (user scope)',
    action: 'install-user'
  }, {
    label: 'Install for all collaborators on this repository (project scope)',
    action: 'install-project'
  }, {
    label: 'Install for you, in this repo only (local scope)',
    action: 'install-local'
  }];
  if (hasHomepage) {
    options.push({
      label: 'Open homepage',
      action: 'homepage'
    });
  }
  if (githubRepo) {
    options.push({
      label: 'View on GitHub',
      action: 'github'
    });
  }
  options.push({
    label: 'Back to plugin list',
    action: 'back'
  });
  return options;
}

/**
 * Key hint component for plugin selection screens
 */
export function PluginSelectionKeyHint(t0) {
  const $ = _c(7);
  const {
    hasSelection
  } = t0;
  let t1;
  if ($[0] !== hasSelection) {
    t1 = hasSelection && <ConfigurableShortcutHint action="plugin:install" context="Plugin" fallback="i" description="install" bold={true} />;
    $[0] = hasSelection;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  let t3;
  let t4;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <ConfigurableShortcutHint action="plugin:toggle" context="Plugin" fallback="Space" description="toggle" />;
    t3 = <ConfigurableShortcutHint action="select:accept" context="Select" fallback="Enter" description="details" />;
    t4 = <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="back" />;
    $[2] = t2;
    $[3] = t3;
    $[4] = t4;
  } else {
    t2 = $[2];
    t3 = $[3];
    t4 = $[4];
  }
  let t5;
  if ($[5] !== t1) {
    t5 = <Box marginTop={1}><Text dimColor={true} italic={true}><Byline>{t1}{t2}{t3}{t4}</Byline></Text></Box>;
    $[5] = t1;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}
