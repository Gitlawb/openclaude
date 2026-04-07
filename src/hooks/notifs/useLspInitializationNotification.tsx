import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useInterval } from 'usehooks-ts';
import { getIsRemoteMode, getIsScrollDraining } from '../../bootstrap/state.js';
import { useNotifications } from '../../context/notifications.js';
import { Text } from '../../ink.js';
import { getInitializationStatus, getLspServerManager } from '../../services/lsp/manager.js';
import { useSetAppState } from '../../state/AppState.js';
import { logForDebugging } from '../../utils/debug.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
const LSP_POLL_INTERVAL_MS = 5000;

/**
 * Hook that polls LSP status and shows a notification when:
 * 1. Manager initialization fails
 * 2. Any LSP server enters an error state
 *
 * Also adds errors to appState.plugins.errors for /doctor display.
 *
 * Only active when ENABLE_LSP_TOOL is set.
 */
export function useLspInitializationNotification() {
  const $ = _c(10);
  const {
    addNotification
  } = useNotifications();
  const setAppState = useSetAppState();
  const [shouldPoll, setShouldPoll] = React.useState(_temp);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = new Set();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const notifiedErrorsRef = React.useRef(t0);
  let t1;
  if ($[1] !== addNotification || $[2] !== setAppState) {
    t1 = (source, errorMessage) => {
      const errorKey = `${source}:${errorMessage}`;
      if (notifiedErrorsRef.current.has(errorKey)) {
        return;
      }
      notifiedErrorsRef.current.add(errorKey);
      logForDebugging(`LSP error: ${source} - ${errorMessage}`);
      setAppState(prev => {
        const existingKeys = new Set(prev.plugins.errors.map(_temp2));
        const stateErrorKey = `generic-error:${source}:${errorMessage}`;
        if (existingKeys.has(stateErrorKey)) {
          return prev;
        }
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            errors: [...prev.plugins.errors, {
              type: "generic-error" as const,
              source,
              error: errorMessage
            }]
          }
        };
      });
      const displayName = source.startsWith("plugin:") ? source.split(":")[1] ?? source : source;
      addNotification({
        key: `lsp-error-${source}`,
        jsx: <><Text color="error">LSP for {displayName} failed</Text><Text dimColor={true}> · /plugin for details</Text></>,
        priority: "medium",
        timeoutMs: 8000
      });
    };
    $[1] = addNotification;
    $[2] = setAppState;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const addError = t1;
  let t2;
  if ($[4] !== addError) {
    t2 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (getIsScrollDraining()) {
        return;
      }
      const status = getInitializationStatus();
      if (status.status === "failed") {
        addError("lsp-manager", status.error.message);
        setShouldPoll(false);
        return;
      }
      if (status.status === "pending" || status.status === "not-started") {
        return;
      }
      const manager = getLspServerManager();
      if (manager) {
        const servers = manager.getAllServers();
        for (const [serverName, server] of servers) {
          if (server.state === "error" && server.lastError) {
            addError(serverName, server.lastError.message);
          }
        }
      }
    };
    $[4] = addError;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const poll = t2;
  useInterval(poll, shouldPoll ? LSP_POLL_INTERVAL_MS : null);
  let t3;
  let t4;
  if ($[6] !== poll || $[7] !== shouldPoll) {
    t3 = () => {
      if (getIsRemoteMode() || !shouldPoll) {
        return;
      }
      poll();
    };
    t4 = [poll, shouldPoll];
    $[6] = poll;
    $[7] = shouldPoll;
    $[8] = t3;
    $[9] = t4;
  } else {
    t3 = $[8];
    t4 = $[9];
  }
  React.useEffect(t3, t4);
}
function _temp2(e) {
  if (e.type === "generic-error") {
    return `generic-error:${e.source}:${e.error}`;
  }
  return `${e.type}:${e.source}`;
}
function _temp() {
  return isEnvTruthy("true");
}
