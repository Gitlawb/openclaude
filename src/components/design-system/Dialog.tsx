import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { Theme } from '../../utils/theme.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import FullWidthRow from './FullWidthRow.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { Pane } from './Pane.js';
type DialogProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onCancel: () => void;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  /** Custom input guide content. Receives exitState for Ctrl+C/D pending display. */
  inputGuide?: (exitState: ExitState) => React.ReactNode;
  /**
   * Controls whether Dialog's built-in confirm:no (Esc/n) and app:exit/interrupt
   * (Ctrl-C/D) keybindings are active. Set to `false` while an embedded text
   * field is being edited so those keys reach the field instead of being
   * consumed by Dialog. TextInput has its own ctrl+c/d handlers (cancel on
   * press, delete-forward on ctrl+d with text). Defaults to `true`.
   */
  isCancelActive?: boolean;
};
export function Dialog(t0) {
  const $ = _c(27);
  const {
    title,
    subtitle,
    children,
    onCancel,
    color: t1,
    hideInputGuide,
    hideBorder,
    inputGuide,
    isCancelActive: t2
  } = t0;
  const color = t1 === undefined ? "permission" : t1;
  const isCancelActive = t2 === undefined ? true : t2;
  const exitState = useExitOnCtrlCDWithKeybindings(undefined, undefined, isCancelActive);
  let t3;
  if ($[0] !== isCancelActive) {
    t3 = {
      context: "Confirmation",
      isActive: isCancelActive
    };
    $[0] = isCancelActive;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  useKeybinding("confirm:no", onCancel, t3);
  let t4;
  if ($[2] !== exitState.keyName || $[3] !== exitState.pending) {
    t4 = exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline>;
    $[2] = exitState.keyName;
    $[3] = exitState.pending;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const defaultInputGuide = t4;
  let t5;
  if ($[5] !== color || $[6] !== title) {
    t5 = <Text bold={true} color={color}>{title}</Text>;
    $[5] = color;
    $[6] = title;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== subtitle) {
    t6 = subtitle && <Text dimColor={true}>{subtitle}</Text>;
    $[8] = subtitle;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== t5 || $[11] !== t6) {
    t7 = <Box flexDirection="column">{t5}{t6}</Box>;
    $[10] = t5;
    $[11] = t6;
    $[12] = t7;
  } else {
    t7 = $[12];
  }
  let t8;
  if ($[13] !== children || $[14] !== t7) {
    t8 = <Box flexDirection="column" gap={1}>{t7}{children}</Box>;
    $[13] = children;
    $[14] = t7;
    $[15] = t8;
  } else {
    t8 = $[15];
  }
  let t9;
  if ($[16] !== defaultInputGuide || $[17] !== exitState || $[18] !== hideInputGuide || $[19] !== inputGuide) {
    t9 = !hideInputGuide && <Box marginTop={1}><FullWidthRow><Text dimColor={true} italic={true}>{inputGuide ? inputGuide(exitState) : defaultInputGuide}</Text></FullWidthRow></Box>;
    $[16] = defaultInputGuide;
    $[17] = exitState;
    $[18] = hideInputGuide;
    $[19] = inputGuide;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  let t10;
  if ($[21] !== t8 || $[22] !== t9) {
    t10 = <>{t8}{t9}</>;
    $[21] = t8;
    $[22] = t9;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  const content = t10;
  if (hideBorder) {
    return content;
  }
  let t11;
  if ($[24] !== color || $[25] !== content) {
    t11 = <Pane color={color}>{content}</Pane>;
    $[24] = color;
    $[25] = content;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  return t11;
}
