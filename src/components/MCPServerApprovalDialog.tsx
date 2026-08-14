import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { getSettings_DEPRECATED, updateSettingsForSource } from '../utils/settings/settings.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { MCPServerDialogCopy } from './MCPServerDialogCopy.js';
type Props = {
  serverName: string;
  onDone(): void;
};
export function MCPServerApprovalDialog(t0) {
  const $ = _c(13);
  const {
    serverName,
    onDone
  } = t0;
  let t1;
  if ($[0] !== onDone || $[1] !== serverName) {
    t1 = function onChange(value) {
      logEvent("tengu_mcp_dialog_choice", {
        choice: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      bb2: switch (value) {
        case "yes":
        case "yes_all":
          {
            const currentSettings_0 = getSettings_DEPRECATED() || {};
            const enabledServers = currentSettings_0.enabledMcpjsonServers || [];
            if (!enabledServers.includes(serverName)) {
              updateSettingsForSource("localSettings", {
                enabledMcpjsonServers: [...enabledServers, serverName]
              });
            }
            if (value === "yes_all") {
              updateSettingsForSource("localSettings", {
                enableAllProjectMcpServers: true
              });
            }
            onDone();
            break bb2;
          }
        case "no":
          {
            const currentSettings = getSettings_DEPRECATED() || {};
            const disabledServers = currentSettings.disabledMcpjsonServers || [];
            if (!disabledServers.includes(serverName)) {
              updateSettingsForSource("localSettings", {
                disabledMcpjsonServers: [...disabledServers, serverName]
              });
            }
            onDone();
          }
      }
    };
    $[0] = onDone;
    $[1] = serverName;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onChange = t1;
  const t2 = `New MCP server found in .mcp.json: ${serverName}`;
  let t3;
  if ($[3] !== onChange) {
    t3 = () => onChange("no");
    $[3] = onChange;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <MCPServerDialogCopy />;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = [{
      label: "Use this and all future MCP servers in this project",
      value: "yes_all"
    }, {
      label: "Use this MCP server",
      value: "yes"
    }, {
      label: "Continue without using this MCP server",
      value: "no"
    }];
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] !== onChange) {
    t6 = <Select options={t5} onChange={value_0 => onChange(value_0 as 'yes_all' | 'yes' | 'no')} onCancel={() => onChange("no")} />;
    $[7] = onChange;
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== t2 || $[10] !== t3 || $[11] !== t6) {
    t7 = <Dialog title={t2} color="warning" onCancel={t3}>{t4}{t6}</Dialog>;
    $[9] = t2;
    $[10] = t3;
    $[11] = t6;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  return t7;
}
