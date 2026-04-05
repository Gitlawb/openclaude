import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Ansi, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
type DividerProps = {
  /**
   * Width of the divider in characters.
   * Defaults to terminal width.
   */
  width?: number;

  /**
   * Theme color for the divider.
   * If not provided, dimColor is used.
   */
  color?: keyof Theme;

  /**
   * Character to use for the divider line.
   * @default '─'
   */
  char?: string;

  /**
   * Padding to subtract from the width (e.g., for indentation).
   * @default 0
   */
  padding?: number;

  /**
   * Title shown in the middle of the divider.
   * May contain ANSI codes (e.g., chalk-styled text).
   *
   * @example
   * // ─────────── Title ───────────
   * <Divider title="Title" />
   */
  title?: string;
};

/**
 * A horizontal divider line.
 *
 * @example
 * // Full-width dimmed divider
 * <Divider />
 *
 * @example
 * // Colored divider
 * <Divider color="suggestion" />
 *
 * @example
 * // Fixed width
 * <Divider width={40} />
 *
 * @example
 * // Full width minus padding (for indented content)
 * <Divider padding={4} />
 *
 * @example
 * // With centered title
 * <Divider title="3 new messages" />
 */
export function Divider(t0) {
  const $ = _c(21);
  const {
    width,
    color,
    char: t1,
    padding: t2,
    title
  } = t0;
  const char = t1 === undefined ? "\u2500" : t1;
  const padding = t2 === undefined ? 0 : t2;
  const {
    columns: terminalWidth
  } = useTerminalSize();
  const effectiveWidth = Math.max(0, (width ?? terminalWidth) - padding);
  if (title) {
    const titleWidth = stringWidth(title) + 2;
    const sideWidth = Math.max(0, effectiveWidth - titleWidth);
    const leftWidth = Math.floor(sideWidth / 2);
    const rightWidth = sideWidth - leftWidth;
    const t3 = !color;
    let t4;
    if ($[0] !== char || $[1] !== leftWidth) {
      t4 = char.repeat(leftWidth);
      $[0] = char;
      $[1] = leftWidth;
      $[2] = t4;
    } else {
      t4 = $[2];
    }
    let t5;
    if ($[3] !== title) {
      t5 = <Text dimColor={true}><Ansi>{title}</Ansi></Text>;
      $[3] = title;
      $[4] = t5;
    } else {
      t5 = $[4];
    }
    let t6;
    if ($[5] !== char || $[6] !== rightWidth) {
      t6 = char.repeat(rightWidth);
      $[5] = char;
      $[6] = rightWidth;
      $[7] = t6;
    } else {
      t6 = $[7];
    }
    let t7;
    if ($[8] !== color || $[9] !== t3 || $[10] !== t4 || $[11] !== t5 || $[12] !== t6) {
      t7 = <Text color={color} dimColor={t3}>{t4}{" "}{t5}{" "}{t6}</Text>;
      $[8] = color;
      $[9] = t3;
      $[10] = t4;
      $[11] = t5;
      $[12] = t6;
      $[13] = t7;
    } else {
      t7 = $[13];
    }
    return t7;
  }
  const t3 = !color;
  let t4;
  if ($[14] !== char || $[15] !== effectiveWidth) {
    t4 = char.repeat(effectiveWidth);
    $[14] = char;
    $[15] = effectiveWidth;
    $[16] = t4;
  } else {
    t4 = $[16];
  }
  let t5;
  if ($[17] !== color || $[18] !== t3 || $[19] !== t4) {
    t5 = <Text color={color} dimColor={t3}>{t4}</Text>;
    $[17] = color;
    $[18] = t3;
    $[19] = t4;
    $[20] = t5;
  } else {
    t5 = $[20];
  }
  return t5;
}
