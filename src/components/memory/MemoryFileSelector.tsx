import { c as _c } from "react-compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import { mkdir } from 'fs/promises';
import { basename, join } from 'path';
import * as React from 'react';
import { use, useEffect, useState } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getAutoMemPath, isAutoMemoryEnabled } from '../../memdir/paths.js';
import { logEvent } from '../../services/analytics/index.js';
import { isAutoDreamEnabled } from '../../services/autoDream/config.js';
import { readLastConsolidatedAt } from '../../services/autoDream/consolidationLock.js';
import { useAppState } from '../../state/AppState.js';
import { getAgentMemoryDir } from '../../tools/AgentTool/agentMemory.js';
import { openPath } from '../../utils/browser.js';
import { getMemoryFiles, type MemoryFileInfo } from '../../utils/claudemd.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { getDisplayPath } from '../../utils/file.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import { projectIsInGitRepo } from '../../utils/memory/versions.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
import { Select } from '../CustomSelect/index.js';
import { ListItem } from '../design-system/ListItem.js';
import { getProjectMemoryPathForSelector } from './memoryFileSelectorPaths.js';

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM') ? require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

interface ExtendedMemoryFileInfo extends MemoryFileInfo {
  isNested?: boolean;
  exists: boolean;
}

// Remember last selected path
let lastSelectedPath: string | undefined;
const OPEN_FOLDER_PREFIX = '__open_folder__';
type Props = {
  onSelect: (path: string) => void;
  onCancel: () => void;
};
export function MemoryFileSelector(t0) {
  const $ = _c(58);
  const {
    onSelect,
    onCancel
  } = t0;
  const existingMemoryFiles = use(getMemoryFiles());
  const originalCwd = getOriginalCwd();
  const userMemoryPath = join(getClaudeConfigHomeDir(), "CLAUDE.md");
  const projectMemoryPath = getProjectMemoryPathForSelector(existingMemoryFiles, originalCwd);
  const projectMemoryFileName = basename(projectMemoryPath);
  const hasUserMemory = existingMemoryFiles.some(f => f.path === userMemoryPath);
  const hasProjectMemory = existingMemoryFiles.some(f_0 => f_0.path === projectMemoryPath);
  const allMemoryFiles = [...existingMemoryFiles.filter(_temp).map(_temp2), ...(hasUserMemory ? [] : [{
    path: userMemoryPath,
    type: "User" as const,
    content: "",
    exists: false
  }]), ...(hasProjectMemory ? [] : [{
    path: projectMemoryPath,
    type: "Project" as const,
    content: "",
    exists: false
  }])];
  const depths = new Map();
  const memoryOptions = allMemoryFiles.map(file => {
    const displayPath = getDisplayPath(file.path);
    const existsLabel = file.exists ? "" : " (new)";
    const depth = file.parent ? (depths.get(file.parent) ?? 0) + 1 : 0;
    depths.set(file.path, depth);
    const indent = depth > 0 ? "  ".repeat(depth - 1) : "";
    let label;
    if (file.type === "User" && !file.isNested && file.path === userMemoryPath) {
      label = "User memory";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        label = "Project memory";
      } else {
        if (depth > 0) {
          label = `${indent}L ${displayPath}${existsLabel}`;
        } else {
          label = `${displayPath}`;
        }
      }
    }
    let description;
    const isGit = projectIsInGitRepo(originalCwd);
    if (file.type === "User" && !file.isNested) {
      description = "Saved in ~/.claude/CLAUDE.md";
    } else {
      if (file.type === "Project" && !file.isNested && file.path === projectMemoryPath) {
        description = `${isGit ? "Checked in at" : "Saved in"} ./${projectMemoryFileName}`;
      } else {
        if (file.parent) {
          description = "@-imported";
        } else {
          if (file.isNested) {
            description = "dynamically loaded";
          } else {
            description = "";
          }
        }
      }
    }
    return {
      label,
      value: file.path,
      description
    };
  });
  const folderOptions = [];
  const agentDefinitions = useAppState(_temp3);
  if (isAutoMemoryEnabled()) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = {
        label: "Open auto-memory folder",
        value: `${OPEN_FOLDER_PREFIX}${getAutoMemPath()}`,
        description: ""
      };
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    // @ts-expect-error any-to-never (stub types cause narrowing)
    folderOptions.push(t1 as any);
    // @ts-expect-error React Compiler output loses type context
    if (feature("TEAMMEM") && teamMemPaths.isTeamMemoryEnabled()) {
      let t2;
      if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
        t2 = {
          label: "Open team memory folder",
          // @ts-expect-error React Compiler output loses type context
          value: `${OPEN_FOLDER_PREFIX}${teamMemPaths.getTeamMemPath()}`,
          description: ""
        };
        $[1] = t2;
      } else {
        t2 = $[1];
      }
      // @ts-expect-error any-to-never (stub types cause narrowing)
      folderOptions.push(t2 as any);
    }
    for (const agent of agentDefinitions.activeAgents) {
      if (agent.memory) {
        const agentDir = getAgentMemoryDir(agent.agentType, agent.memory);
        // @ts-expect-error any-to-never (stub types cause narrowing)
        folderOptions.push({
          label: `Open ${chalk.bold(agent.agentType)} agent memory`,
          value: `${OPEN_FOLDER_PREFIX}${agentDir}`,
          description: `${agent.memory} scope`
        });
      }
    }
  }
  memoryOptions.push(...folderOptions);
  let t1;
  if ($[2] !== memoryOptions) {
    t1 = lastSelectedPath && memoryOptions.some(_temp4) ? lastSelectedPath : memoryOptions[0]?.value || "";
    $[2] = memoryOptions;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  const initialPath = t1;
  const [autoMemoryOn, setAutoMemoryOn] = useState(isAutoMemoryEnabled);
  const [autoDreamOn, setAutoDreamOn] = useState(isAutoDreamEnabled);
  const [showDreamRow] = useState(isAutoMemoryEnabled);
  const isDreamRunning = useAppState(_temp6);
  const [lastDreamAt, setLastDreamAt] = useState<string | null>(null);
  let t2;
  if ($[4] !== showDreamRow) {
    t2 = () => {
      if (!showDreamRow) {
        return;
      }
      // @ts-expect-error React Compiler output loses type context
      readLastConsolidatedAt().then(setLastDreamAt);
    };
    $[4] = showDreamRow;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== isDreamRunning || $[7] !== showDreamRow) {
    t3 = [showDreamRow, isDreamRunning];
    $[6] = isDreamRunning;
    $[7] = showDreamRow;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  useEffect(t2, t3);
  let t4;
  if ($[9] !== isDreamRunning || $[10] !== lastDreamAt) {
    // @ts-expect-error React Compiler output loses type context
    t4 = isDreamRunning ? "running" : lastDreamAt === null ? "" : lastDreamAt === 0 ? "never" : `last ran ${formatRelativeTimeAgo(new Date(lastDreamAt))}`;
    $[9] = isDreamRunning;
    $[10] = lastDreamAt;
    $[11] = t4;
  } else {
    t4 = $[11];
  }
  const dreamStatus = t4;
  const [focusedToggle, setFocusedToggle] = useState<string | null>(null);
  const toggleFocused = focusedToggle !== null;
  const lastToggleIndex = showDreamRow ? 1 : 0;
  let t5;
  if ($[12] !== autoMemoryOn) {
    t5 = function handleToggleAutoMemory() {
      const newValue = !autoMemoryOn;
      updateSettingsForSource("userSettings", {
        autoMemoryEnabled: newValue
      });
      setAutoMemoryOn(newValue);
      logEvent("tengu_auto_memory_toggled", {
        enabled: newValue
      });
    };
    $[12] = autoMemoryOn;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const handleToggleAutoMemory = t5;
  let t6;
  if ($[14] !== autoDreamOn) {
    t6 = function handleToggleAutoDream() {
      const newValue_0 = !autoDreamOn;
      updateSettingsForSource("userSettings", {
        autoDreamEnabled: newValue_0
      });
      setAutoDreamOn(newValue_0);
      logEvent("tengu_auto_dream_toggled", {
        enabled: newValue_0
      });
    };
    $[14] = autoDreamOn;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  const handleToggleAutoDream = t6;
  useExitOnCtrlCDWithKeybindings();
  let t7;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      context: "Confirmation"
    };
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  useKeybinding("confirm:no", onCancel, t7);
  let t8;
  if ($[17] !== focusedToggle || $[18] !== handleToggleAutoDream || $[19] !== handleToggleAutoMemory) {
    t8 = () => {
      // @ts-expect-error React Compiler output loses type context
      if (focusedToggle === 0) {
        handleToggleAutoMemory();
      } else {
        // @ts-expect-error React Compiler output loses type context
        if (focusedToggle === 1) {
          handleToggleAutoDream();
        }
      }
    };
    $[17] = focusedToggle;
    $[18] = handleToggleAutoDream;
    $[19] = handleToggleAutoMemory;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== toggleFocused) {
    t9 = {
      context: "Confirmation",
      isActive: toggleFocused
    };
    $[21] = toggleFocused;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
  useKeybinding("confirm:yes", t8, t9);
  let t10;
  if ($[23] !== lastToggleIndex) {
    t10 = () => {
      // @ts-expect-error React Compiler output loses type context
      setFocusedToggle(prev => prev !== null && prev < lastToggleIndex ? prev + 1 : null);
    };
    $[23] = lastToggleIndex;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] !== toggleFocused) {
    t11 = {
      context: "Select",
      isActive: toggleFocused
    };
    $[25] = toggleFocused;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  useKeybinding("select:next", t10, t11);
  let t12;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t12 = () => {
      setFocusedToggle(_temp7);
    };
    $[27] = t12;
  } else {
    t12 = $[27];
  }
  let t13;
  if ($[28] !== toggleFocused) {
    t13 = {
      context: "Select",
      isActive: toggleFocused
    };
    $[28] = toggleFocused;
    $[29] = t13;
  } else {
    t13 = $[29];
  }
  useKeybinding("select:previous", t12, t13);
  // @ts-expect-error React Compiler output loses type context
  const t14 = focusedToggle === 0;
  const t15 = autoMemoryOn ? "on" : "off";
  let t16;
  if ($[30] !== t15) {
    t16 = <Text>Auto-memory: {t15}</Text>;
    $[30] = t15;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  let t17;
  if ($[32] !== t14 || $[33] !== t16) {
    t17 = <ListItem isFocused={t14}>{t16}</ListItem>;
    $[32] = t14;
    $[33] = t16;
    $[34] = t17;
  } else {
    t17 = $[34];
  }
  let t18;
  if ($[35] !== autoDreamOn || $[36] !== dreamStatus || $[37] !== focusedToggle || $[38] !== isDreamRunning || $[39] !== showDreamRow) {
    // @ts-expect-error React Compiler output loses type context
    t18 = showDreamRow && <ListItem isFocused={focusedToggle === 1} styled={false}><Text color={focusedToggle === 1 ? "suggestion" : undefined}>Auto-dream: {autoDreamOn ? "on" : "off"}{dreamStatus && <Text dimColor={true}> · {dreamStatus}</Text>}{!isDreamRunning && autoDreamOn && <Text dimColor={true}> · /dream to run</Text>}</Text></ListItem>;
    $[35] = autoDreamOn;
    $[36] = dreamStatus;
    $[37] = focusedToggle;
    $[38] = isDreamRunning;
    $[39] = showDreamRow;
    $[40] = t18;
  } else {
    t18 = $[40];
  }
  let t19;
  if ($[41] !== t17 || $[42] !== t18) {
    t19 = <Box flexDirection="column" marginBottom={1}>{t17}{t18}</Box>;
    $[41] = t17;
    $[42] = t18;
    $[43] = t19;
  } else {
    t19 = $[43];
  }
  let t20;
  if ($[44] !== onSelect) {
    t20 = value => {
      if (value.startsWith(OPEN_FOLDER_PREFIX)) {
        const folderPath = value.slice(OPEN_FOLDER_PREFIX.length);
        mkdir(folderPath, {
          recursive: true
        }).catch(_temp8).then(() => openPath(folderPath));
        return;
      }
      lastSelectedPath = value;
      onSelect(value);
    };
    $[44] = onSelect;
    $[45] = t20;
  } else {
    t20 = $[45];
  }
  let t21;
  if ($[46] !== lastToggleIndex) {
    // @ts-expect-error React Compiler output loses type context
    t21 = () => setFocusedToggle(lastToggleIndex);
    $[46] = lastToggleIndex;
    $[47] = t21;
  } else {
    t21 = $[47];
  }
  let t22;
  if ($[48] !== initialPath || $[49] !== memoryOptions || $[50] !== onCancel || $[51] !== t20 || $[52] !== t21 || $[53] !== toggleFocused) {
    t22 = <Select defaultFocusValue={initialPath} options={memoryOptions} isDisabled={toggleFocused} onChange={t20} onCancel={onCancel} onUpFromFirstItem={t21} />;
    $[48] = initialPath;
    $[49] = memoryOptions;
    $[50] = onCancel;
    $[51] = t20;
    $[52] = t21;
    $[53] = toggleFocused;
    $[54] = t22;
  } else {
    t22 = $[54];
  }
  let t23;
  if ($[55] !== t19 || $[56] !== t22) {
    t23 = <Box flexDirection="column" width="100%">{t19}{t22}</Box>;
    $[55] = t19;
    $[56] = t22;
    $[57] = t23;
  } else {
    t23 = $[57];
  }
  return t23;
}
function _temp8() {}
function _temp7(prev_0) {
  return prev_0 !== null && prev_0 > 0 ? prev_0 - 1 : prev_0;
}
function _temp6(s_0) {
  return Object.values(s_0.tasks).some(_temp5);
}
function _temp5(t) {
  return t.type === "dream" && t.status === "running";
}
function _temp4(opt) {
  return opt.value === lastSelectedPath;
}
function _temp3(s) {
  return s.agentDefinitions;
}
function _temp2(f_2) {
  return {
    ...f_2,
    exists: true
  };
}
function _temp(f_1) {
  return f_1.type !== "AutoMem" && f_1.type !== "TeamMem";
}
