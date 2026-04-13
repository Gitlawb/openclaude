import { c as _c } from "react-compiler-runtime";
import React from 'react';
import Text from '../../ink/components/Text.js';
type Props = {
  /** The key or chord to display (e.g., "ctrl+o", "Enter", "↑/↓") */
  shortcut: string;
  /** The action the key performs (e.g., "expand", "select", "navigate") */
  action: string;
  /** Whether to wrap the hint in parentheses. Default: false */
  parens?: boolean;
  /** Whether to render the shortcut in bold. Default: false */
  bold?: boolean;
};

/**
 * Renders a keyboard shortcut hint like "ctrl+o to expand" or "(tab to toggle)"
 *
 * Wrap in <Text dimColor> for the common dim styling.
 *
 * @example
 * // Simple hint wrapped in dim Text
 * <Text dimColor><KeyboardShortcutHint shortcut="esc" action="cancel" /></Text>
 *
 * // With parentheses: "(ctrl+o to expand)"
 * <Text dimColor><KeyboardShortcutHint shortcut="ctrl+o" action="expand" parens /></Text>
 *
 * // With bold shortcut: "Enter to confirm" (Enter is bold)
 * <Text dimColor><KeyboardShortcutHint shortcut="Enter" action="confirm" bold /></Text>
 *
 * // Multiple hints with middot separator - use Byline
 * <Text dimColor>
 *   <Byline>
 *     <KeyboardShortcutHint shortcut="Enter" action="confirm" />
 *     <KeyboardShortcutHint shortcut="Esc" action="cancel" />
 *   </Byline>
 * </Text>
 */
export function KeyboardShortcutHint(t0) {
  const $ = _c(9);
  const {
    shortcut,
    action,
    parens: t1,
    bold: t2
  } = t0;
  const parens = t1 === undefined ? false : t1;
  const bold = t2 === undefined ? false : t2;
  let t3;
  if ($[0] !== bold || $[1] !== shortcut) {
    t3 = bold ? <Text bold={true}>{shortcut}</Text> : shortcut;
    $[0] = bold;
    $[1] = shortcut;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const shortcutText = t3;
  if (parens) {
    let t4;
    if ($[3] !== action || $[4] !== shortcutText) {
      t4 = <Text>({shortcutText} to {action})</Text>;
      $[3] = action;
      $[4] = shortcutText;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    return t4;
  }
  let t4;
  if ($[6] !== action || $[7] !== shortcutText) {
    t4 = <Text>{shortcutText} to {action}</Text>;
    $[6] = action;
    $[7] = shortcutText;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
}
