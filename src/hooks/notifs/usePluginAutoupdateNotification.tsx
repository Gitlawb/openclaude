import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { Text } from '../../ink.js';
import { logForDebugging } from '../../utils/debug.js';
import { onPluginsAutoUpdated } from '../../utils/plugins/pluginAutoupdate.js';

/**
 * Hook that displays a notification when plugins have been auto-updated.
 * The notification tells the user to run /reload-plugins to apply the updates.
 */
export function usePluginAutoupdateNotification() {
  const $ = _c(7);
  const {
    addNotification
  } = useNotifications();
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = [];
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const [updatedPlugins, setUpdatedPlugins] = useState(t0);
  let t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      const unsubscribe = onPluginsAutoUpdated(plugins => {
        logForDebugging(`Plugin autoupdate notification: ${plugins.length} plugin(s) updated`);
        setUpdatedPlugins(plugins);
      });
      return unsubscribe;
    };
    t2 = [];
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
  if ($[3] !== addNotification || $[4] !== updatedPlugins) {
    t3 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (updatedPlugins.length === 0) {
        return;
      }
      const pluginNames = updatedPlugins.map(_temp);
      const displayNames = pluginNames.length <= 2 ? pluginNames.join(" and ") : `${pluginNames.length} plugins`;
      addNotification({
        key: "plugin-autoupdate-restart",
        jsx: <><Text color="success">{pluginNames.length === 1 ? "Plugin" : "Plugins"} updated:{" "}{displayNames}</Text><Text dimColor={true}> · Run /reload-plugins to apply</Text></>,
        priority: "low",
        timeoutMs: 10000
      });
      logForDebugging(`Showing plugin autoupdate notification for: ${pluginNames.join(", ")}`);
    };
    t4 = [updatedPlugins, addNotification];
    $[3] = addNotification;
    $[4] = updatedPlugins;
    $[5] = t3;
    $[6] = t4;
  } else {
    t3 = $[5];
    t4 = $[6];
  }
  useEffect(t3, t4);
}
function _temp(id) {
  const atIndex = id.indexOf("@");
  return atIndex > 0 ? id.substring(0, atIndex) : id;
}
