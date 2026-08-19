import { c as _c } from "react-compiler-runtime";
import partition from 'lodash-es/partition.js';
import React, { useCallback } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { deduplicateServerNames, normalizeNameForMCP } from '../services/mcp/normalization.js';
import { Box, Text } from '../ink.js';
import { updateSettingsForSourceWithFreshSettings, wasSettingsUpdateCommitted } from '../utils/settings/settings.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { SelectMulti } from './CustomSelect/SelectMulti.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';
type Props = {
  serverNames: string[];
  onDone(): void;
};
export function MCPServerMultiselectDialog(t0) {
  const $ = _c(22);
  const {
    serverNames,
    onDone
  } = t0;
  const [saveError, setSaveError] = React.useState<string | null>(null);
  let t1;
  if ($[0] !== onDone || $[1] !== serverNames) {
    t1 = function onSubmit(selectedServers) {
      const [approvedServers, rejectedServers] = partition(serverNames, server => selectedServers.includes(server));
      logEvent("tengu_mcp_multidialog_choice", {
        approved: approvedServers.length,
        rejected: rejectedServers.length
      });
      const result = updateSettingsForSourceWithFreshSettings("localSettings", freshSettings => {
        const approvedNames = new Set(approvedServers.map(normalizeNameForMCP));
        const rejectedNames = new Set(rejectedServers.map(normalizeNameForMCP));
        const enabledMcpjsonServers = deduplicateServerNames([...(freshSettings.enabledMcpjsonServers ?? []).filter(server => !rejectedNames.has(normalizeNameForMCP(server))), ...approvedServers]);
        const disabledMcpjsonServers = deduplicateServerNames([...(freshSettings.disabledMcpjsonServers ?? []).filter(server => !approvedNames.has(normalizeNameForMCP(server))), ...rejectedServers.filter(server => !approvedNames.has(normalizeNameForMCP(server)))]);
        return {
          enabledMcpjsonServers,
          disabledMcpjsonServers
        };
      });
      if (wasSettingsUpdateCommitted(result)) {
        onDone();
      } else {
        setSaveError(`Could not save MCP server preferences: ${result.error?.message ?? "settings were not written"}`);
      }
    };
    $[0] = onDone;
    $[1] = serverNames;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onSubmit = t1;
  let t2;
  if ($[3] !== onDone || $[4] !== serverNames) {
    t2 = () => {
      const result_0 = updateSettingsForSourceWithFreshSettings("localSettings", freshSettings_0 => {
        const rejectedNames = new Set(serverNames.map(normalizeNameForMCP));
        return {
          enabledMcpjsonServers: (freshSettings_0.enabledMcpjsonServers ?? []).filter(server => !rejectedNames.has(normalizeNameForMCP(server))),
          disabledMcpjsonServers: deduplicateServerNames([...(freshSettings_0.disabledMcpjsonServers ?? []), ...serverNames])
        };
      });
      if (wasSettingsUpdateCommitted(result_0)) {
        onDone();
      } else {
        setSaveError(`Could not save MCP server preferences: ${result_0.error?.message ?? "settings were not written"}`);
        onDone();
      }
    };
    $[3] = onDone;
    $[4] = serverNames;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  const handleEscRejectAll = t2;
  const t3 = `${serverNames.length} new MCP servers found in .mcp.json`;
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <MCPServerDialogCopy />;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== serverNames) {
    t5 = serverNames.map(_temp);
    $[7] = serverNames;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== handleEscRejectAll || $[10] !== onSubmit || $[11] !== serverNames || $[12] !== t5) {
    t6 = <SelectMulti options={t5} defaultValue={serverNames} onSubmit={onSubmit} onCancel={handleEscRejectAll} hideIndexes={true} />;
    $[9] = handleEscRejectAll;
    $[10] = onSubmit;
    $[11] = serverNames;
    $[12] = t5;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== saveError || $[15] !== handleEscRejectAll || $[16] !== t3 || $[17] !== t6) {
    t7 = <Dialog title={t3} subtitle="Select any you wish to enable." color="warning" onCancel={handleEscRejectAll} hideInputGuide={true}>{t4}{saveError ? <Text color="error">{saveError}</Text> : null}{t6}</Dialog>;
    $[14] = saveError;
    $[15] = handleEscRejectAll;
    $[16] = t3;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  let t8;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box paddingX={1}><Text dimColor={true} italic={true}><Byline><KeyboardShortcutHint shortcut="Space" action="select" /><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="reject all" /></Byline></Text></Box>;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  let t9;
  if ($[20] !== t7) {
    t9 = <>{t7}{t8}</>;
    $[20] = t7;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  return t9;
}
function _temp(server_0) {
  return {
    label: server_0,
    value: server_0
  };
}
