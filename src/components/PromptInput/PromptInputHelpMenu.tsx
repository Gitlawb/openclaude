import { c as _c } from "react-compiler-runtime";
import { feature } from 'bun:bundle';
import * as React from 'react';
import { Box, Text } from 'src/ink.js';
import { getPlatform } from 'src/utils/platform.js';
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { isFastModeAvailable, isFastModeEnabled } from '../../utils/fastMode.js';
import { getNewlineInstructions } from './utils.js';

/** Format a shortcut for display in the help menu (e.g., "ctrl+o" → "ctrl + o") */
function formatShortcut(shortcut: string): string {
  return shortcut.replace(/\+/g, ' + ');
}
type Props = {
  dimColor?: boolean;
  fixedWidth?: boolean;
  gap?: number;
  paddingX?: number;
};
export function PromptInputHelpMenu(props) {
  const $ = _c(99);
  const {
    dimColor,
    fixedWidth,
    gap,
    paddingX
  } = props;
  const t0 = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  let t1;
  if ($[0] !== t0) {
    t1 = formatShortcut(t0);
    $[0] = t0;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const transcriptShortcut = t1;
  const t2 = useShortcutDisplay("app:toggleTodos", "Global", "ctrl+t");
  let t3;
  if ($[2] !== t2) {
    t3 = formatShortcut(t2);
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const todosShortcut = t3;
  const t4 = useShortcutDisplay("chat:undo", "Chat", "ctrl+_");
  let t5;
  if ($[4] !== t4) {
    t5 = formatShortcut(t4);
    $[4] = t4;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  const undoShortcut = t5;
  const t6 = useShortcutDisplay("chat:stash", "Chat", "ctrl+s");
  let t7;
  if ($[6] !== t6) {
    t7 = formatShortcut(t6);
    $[6] = t6;
    $[7] = t7;
  } else {
    t7 = $[7];
  }
  const stashShortcut = t7;
  const t8 = useShortcutDisplay("chat:cycleMode", "Chat", "shift+tab");
  let t9;
  if ($[8] !== t8) {
    t9 = formatShortcut(t8);
    $[8] = t8;
    $[9] = t9;
  } else {
    t9 = $[9];
  }
  const cycleModeShortcut = t9;
  const t10 = useShortcutDisplay("chat:modelPicker", "Chat", "alt+p");
  let t11;
  if ($[10] !== t10) {
    t11 = formatShortcut(t10);
    $[10] = t10;
    $[11] = t11;
  } else {
    t11 = $[11];
  }
  const modelPickerShortcut = t11;
  const t12 = useShortcutDisplay("chat:fastMode", "Chat", "alt+o");
  let t13;
  if ($[12] !== t12) {
    t13 = formatShortcut(t12);
    $[12] = t12;
    $[13] = t13;
  } else {
    t13 = $[13];
  }
  const fastModeShortcut = t13;
  const t14 = useShortcutDisplay("chat:externalEditor", "Chat", "ctrl+g");
  let t15;
  if ($[14] !== t14) {
    t15 = formatShortcut(t14);
    $[14] = t14;
    $[15] = t15;
  } else {
    t15 = $[15];
  }
  const externalEditorShortcut = t15;
  const t16 = useShortcutDisplay("app:toggleTerminal", "Global", "meta+j");
  let t17;
  if ($[16] !== t16) {
    t17 = formatShortcut(t16);
    $[16] = t16;
    $[17] = t17;
  } else {
    t17 = $[17];
  }
  const terminalShortcut = t17;
  const t18 = useShortcutDisplay("chat:imagePaste", "Chat", "ctrl+v");
  let t19;
  if ($[18] !== t18) {
    t19 = formatShortcut(t18);
    $[18] = t18;
    $[19] = t19;
  } else {
    t19 = $[19];
  }
  const imagePasteShortcut = t19;
  let t20;
  if ($[20] !== dimColor || $[21] !== terminalShortcut) {
    t20 = feature("TERMINAL_PANEL") ? getFeatureValue_CACHED_MAY_BE_STALE("tengu_terminal_panel", false) ? <Box><Text dimColor={dimColor}>{terminalShortcut} for terminal</Text></Box> : null : null;
    $[20] = dimColor;
    $[21] = terminalShortcut;
    $[22] = t20;
  } else {
    t20 = $[22];
  }
  const terminalShortcutElement = t20;
  const t21 = fixedWidth ? 24 : undefined;
  let t22;
  if ($[23] !== dimColor) {
    t22 = <Box><Text dimColor={dimColor}>Ctrl+x to toggle shell</Text></Box>;
    $[23] = dimColor;
    $[24] = t22;
  } else {
    t22 = $[24];
  }
  let t23;
  if ($[25] !== dimColor) {
    t23 = <Box><Text dimColor={dimColor}>/ for commands</Text></Box>;
    $[25] = dimColor;
    $[26] = t23;
  } else {
    t23 = $[26];
  }
  let t24;
  if ($[27] !== dimColor) {
    t24 = <Box><Text dimColor={dimColor}>@ for file paths</Text></Box>;
    $[27] = dimColor;
    $[28] = t24;
  } else {
    t24 = $[28];
  }
  let t25;
  if ($[29] !== dimColor) {
    t25 = <Box><Text dimColor={dimColor}>{"& for background"}</Text></Box>;
    $[29] = dimColor;
    $[30] = t25;
  } else {
    t25 = $[30];
  }
  let t26;
  if ($[31] !== dimColor) {
    t26 = <Box><Text dimColor={dimColor}>/btw for side question</Text></Box>;
    $[31] = dimColor;
    $[32] = t26;
  } else {
    t26 = $[32];
  }
  let t27;
  if ($[33] !== t21 || $[34] !== t22 || $[35] !== t23 || $[36] !== t24 || $[37] !== t25 || $[38] !== t26) {
    t27 = <Box flexDirection="column" width={t21}>{t22}{t23}{t24}{t25}{t26}</Box>;
    $[33] = t21;
    $[34] = t22;
    $[35] = t23;
    $[36] = t24;
    $[37] = t25;
    $[38] = t26;
    $[39] = t27;
  } else {
    t27 = $[39];
  }
  const t28 = fixedWidth ? 35 : undefined;
  let t29;
  if ($[40] !== dimColor) {
    t29 = <Box><Text dimColor={dimColor}>double tap esc to clear input</Text></Box>;
    $[40] = dimColor;
    $[41] = t29;
  } else {
    t29 = $[41];
  }
  let t30;
  if ($[42] !== cycleModeShortcut || $[43] !== dimColor) {
    t30 = <Box><Text dimColor={dimColor}>{cycleModeShortcut}{" "}{false ? "to cycle modes" : "to auto-accept edits"}</Text></Box>;
    $[42] = cycleModeShortcut;
    $[43] = dimColor;
    $[44] = t30;
  } else {
    t30 = $[44];
  }
  let t31;
  if ($[45] !== dimColor || $[46] !== transcriptShortcut) {
    t31 = <Box><Text dimColor={dimColor}>{transcriptShortcut} for verbose output</Text></Box>;
    $[45] = dimColor;
    $[46] = transcriptShortcut;
    $[47] = t31;
  } else {
    t31 = $[47];
  }
  let t32;
  if ($[48] !== dimColor || $[49] !== todosShortcut) {
    t32 = <Box><Text dimColor={dimColor}>{todosShortcut} to toggle tasks</Text></Box>;
    $[48] = dimColor;
    $[49] = todosShortcut;
    $[50] = t32;
  } else {
    t32 = $[50];
  }
  let t33;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t33 = getNewlineInstructions();
    $[51] = t33;
  } else {
    t33 = $[51];
  }
  let t34;
  if ($[52] !== dimColor) {
    t34 = <Box><Text dimColor={dimColor}>{t33}</Text></Box>;
    $[52] = dimColor;
    $[53] = t34;
  } else {
    t34 = $[53];
  }
  let t35;
  if ($[54] !== t28 || $[55] !== t29 || $[56] !== t30 || $[57] !== t31 || $[58] !== t32 || $[59] !== t34 || $[60] !== terminalShortcutElement) {
    t35 = <Box flexDirection="column" width={t28}>{t29}{t30}{t31}{t32}{terminalShortcutElement}{t34}</Box>;
    $[54] = t28;
    $[55] = t29;
    $[56] = t30;
    $[57] = t31;
    $[58] = t32;
    $[59] = t34;
    $[60] = terminalShortcutElement;
    $[61] = t35;
  } else {
    t35 = $[61];
  }
  let t36;
  if ($[62] !== dimColor || $[63] !== undoShortcut) {
    t36 = <Box><Text dimColor={dimColor}>{undoShortcut} to undo</Text></Box>;
    $[62] = dimColor;
    $[63] = undoShortcut;
    $[64] = t36;
  } else {
    t36 = $[64];
  }
  let t37;
  if ($[65] !== dimColor) {
    t37 = getPlatform() !== "windows" && <Box><Text dimColor={dimColor}>ctrl + z to suspend</Text></Box>;
    $[65] = dimColor;
    $[66] = t37;
  } else {
    t37 = $[66];
  }
  let t38;
  if ($[67] !== dimColor || $[68] !== imagePasteShortcut) {
    t38 = <Box><Text dimColor={dimColor}>{imagePasteShortcut} to paste images</Text></Box>;
    $[67] = dimColor;
    $[68] = imagePasteShortcut;
    $[69] = t38;
  } else {
    t38 = $[69];
  }
  let t39;
  if ($[70] !== dimColor || $[71] !== modelPickerShortcut) {
    t39 = <Box><Text dimColor={dimColor}>{modelPickerShortcut} to switch model</Text></Box>;
    $[70] = dimColor;
    $[71] = modelPickerShortcut;
    $[72] = t39;
  } else {
    t39 = $[72];
  }
  let t40;
  if ($[73] !== dimColor || $[74] !== fastModeShortcut) {
    t40 = isFastModeEnabled() && isFastModeAvailable() && <Box><Text dimColor={dimColor}>{fastModeShortcut} to toggle fast mode</Text></Box>;
    $[73] = dimColor;
    $[74] = fastModeShortcut;
    $[75] = t40;
  } else {
    t40 = $[75];
  }
  let t41;
  if ($[76] !== dimColor || $[77] !== stashShortcut) {
    t41 = <Box><Text dimColor={dimColor}>{stashShortcut} to stash prompt</Text></Box>;
    $[76] = dimColor;
    $[77] = stashShortcut;
    $[78] = t41;
  } else {
    t41 = $[78];
  }
  let t42;
  if ($[79] !== dimColor || $[80] !== externalEditorShortcut) {
    t42 = <Box><Text dimColor={dimColor}>{externalEditorShortcut} to edit in $EDITOR</Text></Box>;
    $[79] = dimColor;
    $[80] = externalEditorShortcut;
    $[81] = t42;
  } else {
    t42 = $[81];
  }
  let t43;
  if ($[82] !== dimColor) {
    t43 = isKeybindingCustomizationEnabled() && <Box><Text dimColor={dimColor}>/keybindings to customize</Text></Box>;
    $[82] = dimColor;
    $[83] = t43;
  } else {
    t43 = $[83];
  }
  let t44;
  if ($[84] !== t36 || $[85] !== t37 || $[86] !== t38 || $[87] !== t39 || $[88] !== t40 || $[89] !== t41 || $[90] !== t42 || $[91] !== t43) {
    t44 = <Box flexDirection="column">{t36}{t37}{t38}{t39}{t40}{t41}{t42}{t43}</Box>;
    $[84] = t36;
    $[85] = t37;
    $[86] = t38;
    $[87] = t39;
    $[88] = t40;
    $[89] = t41;
    $[90] = t42;
    $[91] = t43;
    $[92] = t44;
  } else {
    t44 = $[92];
  }
  let t45;
  if ($[93] !== gap || $[94] !== paddingX || $[95] !== t27 || $[96] !== t35 || $[97] !== t44) {
    t45 = <Box paddingX={paddingX} flexDirection="row" gap={gap}>{t27}{t35}{t44}</Box>;
    $[93] = gap;
    $[94] = paddingX;
    $[95] = t27;
    $[96] = t35;
    $[97] = t44;
    $[98] = t45;
  } else {
    t45 = $[98];
  }
  return t45;
}
