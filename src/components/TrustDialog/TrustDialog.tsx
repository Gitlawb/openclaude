import { c as _c } from "react-compiler-runtime";
import { homedir } from 'os';
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { setSessionTrustAccepted } from '../../bootstrap/state.js';
import type { Command } from '../../commands.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Link, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getMcpConfigsByScope } from '../../services/mcp/config.js';
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js';
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { getFsImplementation } from '../../utils/fsOperations.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { Select } from '../CustomSelect/index.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
import { getApiKeyHelperSources, getAwsCommandsSources, getBashPermissionSources, getDangerousEnvVarsSources, getGcpCommandsSources, getHooksSources, getOtelHeadersHelperSources } from './utils.js';
type Props = {
  onDone(): void;
  commands?: Command[];
};
export function TrustDialog(t0) {
  const $ = _c(33);
  const {
    onDone,
    commands
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getMcpConfigsByScope("project");
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const {
    servers: projectServers
  } = t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = Object.keys(projectServers);
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const hasMcpServers = t2.length > 0;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = getHooksSources();
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const hooksSettingSources = t3;
  const hasHooks = hooksSettingSources.length > 0;
  let t4;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = getBashPermissionSources();
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const bashSettingSources = t4;
  let t5;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = getApiKeyHelperSources();
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  const apiKeyHelperSources = t5;
  const hasApiKeyHelper = apiKeyHelperSources.length > 0;
  let t6;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = getAwsCommandsSources();
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  const awsCommandsSources = t6;
  const hasAwsCommands = awsCommandsSources.length > 0;
  let t7;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = getGcpCommandsSources();
    $[6] = t7;
  } else {
    t7 = $[6];
  }
  const gcpCommandsSources = t7;
  const hasGcpCommands = gcpCommandsSources.length > 0;
  let t8;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = getOtelHeadersHelperSources();
    $[7] = t8;
  } else {
    t8 = $[7];
  }
  const otelHeadersHelperSources = t8;
  const hasOtelHeadersHelper = otelHeadersHelperSources.length > 0;
  let t9;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = getDangerousEnvVarsSources();
    $[8] = t9;
  } else {
    t9 = $[8];
  }
  const dangerousEnvVarsSources = t9;
  const hasDangerousEnvVars = dangerousEnvVarsSources.length > 0;
  let t10;
  if ($[9] !== commands) {
    t10 = commands?.some(_temp2) ?? false;
    $[9] = commands;
    $[10] = t10;
  } else {
    t10 = $[10];
  }
  const hasSlashCommandBash = t10;
  let t11;
  if ($[11] !== commands) {
    t11 = commands?.some(_temp4) ?? false;
    $[11] = commands;
    $[12] = t11;
  } else {
    t11 = $[12];
  }
  const hasSkillsBash = t11;
  const hasAnyBashExecution = bashSettingSources.length > 0 || hasSlashCommandBash || hasSkillsBash;
  const hasTrustDialogAccepted = checkHasTrustDialogAccepted();
  let t12;
  let t13;
  if ($[13] !== hasAnyBashExecution) {
    t12 = () => {
      const isHomeDir = homedir() === getCwd();
      logEvent("tengu_trust_dialog_shown", {
        isHomeDir,
        hasMcpServers,
        hasHooks,
        hasBashExecution: hasAnyBashExecution,
        hasApiKeyHelper,
        hasAwsCommands,
        hasGcpCommands,
        hasOtelHeadersHelper,
        hasDangerousEnvVars
      });
    };
    t13 = [hasMcpServers, hasHooks, hasAnyBashExecution, hasApiKeyHelper, hasAwsCommands, hasGcpCommands, hasOtelHeadersHelper, hasDangerousEnvVars];
    $[13] = hasAnyBashExecution;
    $[14] = t12;
    $[15] = t13;
  } else {
    t12 = $[14];
    t13 = $[15];
  }
  React.useEffect(t12, t13);
  let t14;
  if ($[16] !== hasAnyBashExecution || $[17] !== onDone) {
    t14 = function onChange(value) {
      if (value === "exit") {
        gracefulShutdownSync(1);
        return;
      }
      const isHomeDir_0 = homedir() === getCwd();
      logEvent("tengu_trust_dialog_accept", {
        isHomeDir: isHomeDir_0,
        hasMcpServers,
        hasHooks,
        hasBashExecution: hasAnyBashExecution,
        hasApiKeyHelper,
        hasAwsCommands,
        hasGcpCommands,
        hasOtelHeadersHelper,
        hasDangerousEnvVars
      });
      if (isHomeDir_0) {
        setSessionTrustAccepted(true);
      } else {
        saveCurrentProjectConfig(_temp5);
      }
      onDone();
    };
    $[16] = hasAnyBashExecution;
    $[17] = onDone;
    $[18] = t14;
  } else {
    t14 = $[18];
  }
  const onChange = t14;
  const exitState = useExitOnCtrlCDWithKeybindings(_temp6);
  let t15;
  if ($[19] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = {
      context: "Confirmation"
    };
    $[19] = t15;
  } else {
    t15 = $[19];
  }
  useKeybinding("confirm:no", _temp7, t15);
  if (hasTrustDialogAccepted) {
    setTimeout(onDone);
    return null;
  }
  let t16;
  let t17;
  let t18;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t16 = <Text bold={true}>{getFsImplementation().cwd()}</Text>;
    t17 = <Text>Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what{"'"}s in this folder first.</Text>;
    t18 = <Text>Claude Code{"'"}ll be able to read, edit, and execute files here.</Text>;
    $[20] = t16;
    $[21] = t17;
    $[22] = t18;
  } else {
    t16 = $[20];
    t17 = $[21];
    t18 = $[22];
  }
  let t19;
  if ($[23] === Symbol.for("react.memo_cache_sentinel")) {
    t19 = <Text dimColor={true}><Link url="https://code.claude.com/docs/en/security">Security guide</Link></Text>;
    $[23] = t19;
  } else {
    t19 = $[23];
  }
  let t20;
  if ($[24] === Symbol.for("react.memo_cache_sentinel")) {
    t20 = [{
      label: "Yes, I trust this folder asba",
      value: "enable_all"
    }, {
      label: "No, exit",
      value: "exit"
    }];
    $[24] = t20;
  } else {
    t20 = $[24];
  }
  let t21;
  if ($[25] !== onChange) {
    t21 = <Select options={t20} onChange={value_0 => onChange(value_0 as 'enable_all' | 'exit')} onCancel={() => onChange("exit")} />;
    $[25] = onChange;
    $[26] = t21;
  } else {
    t21 = $[26];
  }
  let t22;
  if ($[27] !== exitState.keyName || $[28] !== exitState.pending) {
    t22 = <Text dimColor={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : <>Enter to confirm · Esc to cancel</>}</Text>;
    $[27] = exitState.keyName;
    $[28] = exitState.pending;
    $[29] = t22;
  } else {
    t22 = $[29];
  }
  let t23;
  if ($[30] !== t21 || $[31] !== t22) {
    t23 = <PermissionDialog color="warning" titleColor="warning" title="Accessing workspace:"><Box flexDirection="column" gap={1} paddingTop={1}>{t16}{t17}{t18}{t19}{t21}{t22}</Box></PermissionDialog>;
    $[30] = t21;
    $[31] = t22;
    $[32] = t23;
  } else {
    t23 = $[32];
  }
  return t23;
}
function _temp7() {
  gracefulShutdownSync(0);
}
function _temp6() {
  return gracefulShutdownSync(1);
}
function _temp5(current) {
  return {
    ...current,
    hasTrustDialogAccepted: true
  };
}
function _temp4(command_0) {
  return command_0.type === "prompt" && (command_0.loadedFrom === "skills" || command_0.loadedFrom === "plugin") && (command_0.source === "projectSettings" || command_0.source === "localSettings" || command_0.source === "plugin") && command_0.allowedTools?.some(_temp3);
}
function _temp3(tool_0) {
  return tool_0 === BASH_TOOL_NAME || tool_0.startsWith(BASH_TOOL_NAME + "(");
}
function _temp2(command) {
  return command.type === "prompt" && command.loadedFrom === "commands_DEPRECATED" && (command.source === "projectSettings" || command.source === "localSettings") && command.allowedTools?.some(_temp);
}
function _temp(tool) {
  return tool === BASH_TOOL_NAME || tool.startsWith(BASH_TOOL_NAME + "(");
}
