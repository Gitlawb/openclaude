import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, color, Link, Text, useTheme } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { CommandResultDisplay } from '../../types/command.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/select.js';
import { Pane } from '../design-system/Pane.js';
import { Tab, Tabs, useTabHeaderFocus } from '../design-system/Tabs.js';
import { SandboxConfigTab } from './SandboxConfigTab.js';
import { SandboxDependenciesTab } from './SandboxDependenciesTab.js';
import { SandboxOverridesTab } from './SandboxOverridesTab.js';
type Props = {
  onComplete: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  depCheck: SandboxDependencyCheck;
};
type SandboxMode = 'auto-allow' | 'regular' | 'disabled';
export function SandboxSettings(t0) {
  const $ = _c(34);
  const {
    onComplete,
    depCheck
  } = t0;
  const [theme] = useTheme();
  const currentEnabled = SandboxManager.isSandboxingEnabled();
  const currentAutoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled();
  const hasWarnings = depCheck.warnings.length > 0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getSettings_DEPRECATED();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const settings = t1;
  const allowAllUnixSockets = settings.sandbox?.network?.allowAllUnixSockets;
  const showSocketWarning = hasWarnings && !allowAllUnixSockets;
  const getCurrentMode = () => {
    if (!currentEnabled) {
      return "disabled";
    }
    if (currentAutoAllow) {
      return "auto-allow";
    }
    return "regular";
  };
  const currentMode = getCurrentMode();
  let t2;
  if ($[1] !== theme) {
    t2 = color("success", theme)("(current)");
    $[1] = theme;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const currentIndicator = t2;
  const t3 = currentMode === "auto-allow" ? `Sandbox BashTool, with auto-allow ${currentIndicator}` : "Sandbox BashTool, with auto-allow";
  let t4;
  if ($[3] !== t3) {
    t4 = {
      label: t3,
      value: "auto-allow"
    };
    $[3] = t3;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const t5 = currentMode === "regular" ? `Sandbox BashTool, with regular permissions ${currentIndicator}` : "Sandbox BashTool, with regular permissions";
  let t6;
  if ($[5] !== t5) {
    t6 = {
      label: t5,
      value: "regular"
    };
    $[5] = t5;
    $[6] = t6;
  } else {
    t6 = $[6];
  }
  const t7 = currentMode === "disabled" ? `No Sandbox ${currentIndicator}` : "No Sandbox";
  let t8;
  if ($[7] !== t7) {
    t8 = {
      label: t7,
      value: "disabled"
    };
    $[7] = t7;
    $[8] = t8;
  } else {
    t8 = $[8];
  }
  let t9;
  if ($[9] !== t4 || $[10] !== t6 || $[11] !== t8) {
    t9 = [t4, t6, t8];
    $[9] = t4;
    $[10] = t6;
    $[11] = t8;
    $[12] = t9;
  } else {
    t9 = $[12];
  }
  const options = t9;
  let t10;
  if ($[13] !== onComplete) {
    t10 = async function handleSelect(value) {
      const mode = value as SandboxMode;
      bb33: switch (mode) {
        case "auto-allow":
          {
            await SandboxManager.setSandboxSettings({
              enabled: true,
              autoAllowBashIfSandboxed: true
            });
            onComplete("\u2713 Sandbox enabled with auto-allow for bash commands");
            break bb33;
          }
        case "regular":
          {
            await SandboxManager.setSandboxSettings({
              enabled: true,
              autoAllowBashIfSandboxed: false
            });
            onComplete("\u2713 Sandbox enabled with regular bash permissions");
            break bb33;
          }
        case "disabled":
          {
            await SandboxManager.setSandboxSettings({
              enabled: false,
              autoAllowBashIfSandboxed: false
            });
            onComplete("\u25CB Sandbox disabled");
          }
      }
    };
    $[13] = onComplete;
    $[14] = t10;
  } else {
    t10 = $[14];
  }
  const handleSelect = t10;
  let t11;
  if ($[15] !== onComplete) {
    t11 = {
      "confirm:no": () => onComplete(undefined, {
        display: "skip"
      })
    };
    $[15] = onComplete;
    $[16] = t11;
  } else {
    t11 = $[16];
  }
  let t12;
  if ($[17] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = {
      context: "Settings"
    };
    $[17] = t12;
  } else {
    t12 = $[17];
  }
  useKeybindings(t11, t12);
  let t13;
  if ($[18] !== handleSelect || $[19] !== onComplete || $[20] !== options || $[21] !== showSocketWarning) {
    t13 = <Tab key="mode" title="Mode"><SandboxModeTab showSocketWarning={showSocketWarning} options={options} onSelect={handleSelect} onComplete={onComplete} /></Tab>;
    $[18] = handleSelect;
    $[19] = onComplete;
    $[20] = options;
    $[21] = showSocketWarning;
    $[22] = t13;
  } else {
    t13 = $[22];
  }
  const modeTab = t13;
  let t14;
  if ($[23] !== onComplete) {
    t14 = <Tab key="overrides" title="Overrides"><SandboxOverridesTab onComplete={onComplete} /></Tab>;
    $[23] = onComplete;
    $[24] = t14;
  } else {
    t14 = $[24];
  }
  const overridesTab = t14;
  let t15;
  if ($[25] === Symbol.for("react.memo_cache_sentinel")) {
    t15 = <Tab key="config" title="Config"><SandboxConfigTab /></Tab>;
    $[25] = t15;
  } else {
    t15 = $[25];
  }
  const configTab = t15;
  const hasErrors = depCheck.errors.length > 0;
  let t16;
  if ($[26] !== depCheck || $[27] !== hasErrors || $[28] !== hasWarnings || $[29] !== modeTab || $[30] !== overridesTab) {
    t16 = hasErrors ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : [modeTab, ...(hasWarnings ? [<Tab key="dependencies" title="Dependencies"><SandboxDependenciesTab depCheck={depCheck} /></Tab>] : []), overridesTab, configTab];
    $[26] = depCheck;
    $[27] = hasErrors;
    $[28] = hasWarnings;
    $[29] = modeTab;
    $[30] = overridesTab;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  const tabs = t16;
  let t17;
  if ($[32] !== tabs) {
    t17 = <Pane color="permission"><Tabs title="Sandbox:" color="permission" defaultTab="Mode">{tabs}</Tabs></Pane>;
    $[32] = tabs;
    $[33] = t17;
  } else {
    t17 = $[33];
  }
  return t17;
}
function SandboxModeTab(t0) {
  const $ = _c(16);
  const {
    showSocketWarning,
    options,
    onSelect,
    onComplete
  } = t0;
  const {
    headerFocused,
    focusHeader
  } = useTabHeaderFocus();
  let t1;
  if ($[0] !== showSocketWarning) {
    t1 = showSocketWarning && <Box marginBottom={1}><Text color="warning">Cannot block unix domain sockets (see Dependencies tab)</Text></Box>;
    $[0] = showSocketWarning;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box marginBottom={1}><Text bold={true}>Configure Mode:</Text></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== onComplete) {
    t3 = () => onComplete(undefined, {
      display: "skip"
    });
    $[3] = onComplete;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== focusHeader || $[6] !== headerFocused || $[7] !== onSelect || $[8] !== options || $[9] !== t3) {
    t4 = <Select options={options} onChange={onSelect} onCancel={t3} onUpFromFirstItem={focusHeader} isDisabled={headerFocused} />;
    $[5] = focusHeader;
    $[6] = headerFocused;
    $[7] = onSelect;
    $[8] = options;
    $[9] = t3;
    $[10] = t4;
  } else {
    t4 = $[10];
  }
  let t5;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text dimColor={true}><Text bold={true} dimColor={true}>Auto-allow mode:</Text>{" "}Commands will try to run in the sandbox automatically, and attempts to run outside of the sandbox fallback to regular permissions. Explicit ask/deny rules are always respected.</Text>;
    $[11] = t5;
  } else {
    t5 = $[11];
  }
  let t6;
  if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Box flexDirection="column" marginTop={1} gap={1}>{t5}<Text dimColor={true}>Learn more:{" "}<Link url="https://code.claude.com/docs/en/sandboxing">code.claude.com/docs/en/sandboxing</Link></Text></Box>;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== t1 || $[14] !== t4) {
    t7 = <Box flexDirection="column" paddingY={1}>{t1}{t2}{t4}{t6}</Box>;
    $[13] = t1;
    $[14] = t4;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  return t7;
}
