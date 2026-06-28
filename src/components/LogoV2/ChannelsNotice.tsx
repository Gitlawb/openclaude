import { c as _c } from "react-compiler-runtime";
// Conditionally require()'d in LogoV2.tsx behind feature('KAIROS') ||
// feature('KAIROS_CHANNELS'). No feature() guard here — the whole file
// tree-shakes via the require pattern when both flags are false (see
// docs/feature-gating.md). Do NOT import this module statically from
// unguarded code.

import * as React from 'react';
import { useState } from 'react';
import { type ChannelEntry, getAllowedChannels, getHasDevChannels } from '../../bootstrap/state.js';
import { Box, Text } from '../../ink.js';
import { isChannelsEnabled } from '../../services/mcp/channelAllowlist.js';
import { getEffectiveChannelAllowlist } from '../../services/mcp/channelNotification.js';
import { getSubscriptionType } from '../../utils/auth.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { loadInstalledPluginsV2 } from '../../utils/plugins/installedPluginsManager.js';
export function ChannelsNotice() {
  const $ = _c(16);
  const [t0] = useState(_temp);
  const {
    channels,
    disabled,
    list,
    unmatched
  } = t0;
  if (channels.length === 0) {
    return null;
  }
  const hasNonDev = channels.some(_temp2);
  const flag = getHasDevChannels() && hasNonDev ? "Channels" : getHasDevChannels() ? "--dangerously-load-development-channels" : "--channels";
  if (disabled) {
    let t1;
    if ($[0] !== flag || $[1] !== list) {
      t1 = <Text color="error">{flag} ignored ({list})</Text>;
      $[0] = flag;
      $[1] = list;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    let t2;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Text dimColor={true}>Channels are not currently available</Text>;
      $[3] = t2;
    } else {
      t2 = $[3];
    }
    let t3;
    if ($[4] !== t1) {
      t3 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}</Box>;
      $[4] = t1;
      $[5] = t3;
    } else {
      t3 = $[5];
    }
    return t3;
  }
  let t1;
  if ($[6] !== list) {
    t1 = <Text color="error">Listening for channel messages from: {list}</Text>;
    $[6] = list;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  let t2;
  if ($[8] !== flag) {
    t2 = <Text dimColor={true}>Experimental · inbound messages will be pushed into this session, this carries prompt injection risks. Restart OpenClaude without {flag} to disable.</Text>;
    $[8] = flag;
    $[9] = t2;
  } else {
    t2 = $[9];
  }
  let t3;
  if ($[10] !== unmatched) {
    t3 = unmatched.map(_temp4);
    $[10] = unmatched;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  let t4;
  if ($[12] !== t1 || $[13] !== t2 || $[14] !== t3) {
    t4 = <Box paddingLeft={2} flexDirection="column">{t1}{t2}{t3}</Box>;
    $[12] = t1;
    $[13] = t2;
    $[14] = t3;
    $[15] = t4;
  } else {
    t4 = $[15];
  }
  return t4;
}
function _temp4(u_0) {
  return <Text key={`${formatEntry(u_0.entry)}:${u_0.why}`} color="warning">{formatEntry(u_0.entry)} · {u_0.why}</Text>;
}
function _temp2(c) {
  return !c.dev;
}
function _temp() {
  const ch = getAllowedChannels();
  if (ch.length === 0) {
    return {
      channels: ch,
      disabled: false,
      list: "",
      unmatched: [] as Unmatched[]
    };
  }
  const l = ch.map(formatEntry).join(", ");
  const allowlist = getEffectiveChannelAllowlist(getSubscriptionType(), undefined);
  return {
    channels: ch,
    disabled: !isChannelsEnabled(),
    list: l,
    unmatched: findUnmatched(ch, allowlist)
  };
}
function formatEntry(c: ChannelEntry): string {
  return c.kind === 'plugin' ? `plugin:${c.name}@${c.marketplace}` : `server:${c.name}`;
}
type Unmatched = {
  entry: ChannelEntry;
  why: string;
};
function findUnmatched(entries: readonly ChannelEntry[], allowlist: ReturnType<typeof getEffectiveChannelAllowlist>): Unmatched[] {
  // Server-kind: build one Set from all scopes up front. getMcpConfigsByScope
  // is not cached (project scope walks the dir tree); getMcpConfigByName would
  // redo that walk per entry.
  const scopes = ['enterprise', 'user', 'project', 'local'] as const;
  const configured = new Set<string>();
  for (const scope of scopes) {
    for (const name of Object.keys(getMcpConfigsByScope(scope).servers)) {
      configured.add(name);
    }
  }

  // Plugin-kind installed check: installed_plugins.json keys are
  // `name@marketplace`. loadInstalledPluginsV2 is cached.
  const installedPluginIds = new Set(Object.keys(loadInstalledPluginsV2().plugins));

  // Plugin-kind allowlist check: same {marketplace, plugin} test as the
  // gate at channelNotification.ts. entry.dev bypasses (dev flag opts out
  // of the allowlist). Org list replaces ledger when set (team/enterprise).
  // GrowthBook _CACHED_MAY_BE_STALE — cold cache yields [] so every plugin
  // entry warns; same tradeoff the gate already accepts.
  const {
    entries: allowed,
    source
  } = allowlist;

  // Independent ifs — a plugin entry that's both uninstalled AND
  // unlisted shows two lines. Server kind checks config + dev flag.
  const out: Unmatched[] = [];
  for (const entry of entries) {
    if (entry.kind === 'server') {
      if (!configured.has(entry.name)) {
        out.push({
          entry,
          why: 'no MCP server configured with that name'
        });
      }
      if (!entry.dev) {
        out.push({
          entry,
          why: 'server: entries need --dangerously-load-development-channels'
        });
      }
      continue;
    }
    if (!installedPluginIds.has(`${entry.name}@${entry.marketplace}`)) {
      out.push({
        entry,
        why: 'plugin not installed'
      });
    }
    if (!entry.dev && !allowed.some(e => e.plugin === entry.name && e.marketplace === entry.marketplace)) {
      out.push({
        entry,
        why: 'not on the approved channels allowlist'
      });
    }
  }
  return out;
}
