import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import type { ReactNode } from 'react';
import React from 'react';
import { useDeclaredCursor } from '../../ink/hooks/use-declared-cursor.js';
import { Box, Text } from '../../ink.js';
type ListItemProps = {
  /**
   * Whether this item is currently focused (keyboard selection).
   * Shows the pointer indicator (❯) when true.
   */
  isFocused: boolean;

  /**
   * Whether this item is selected (chosen/checked).
   * Shows the checkmark indicator (✓) when true.
   * @default false
   */
  isSelected?: boolean;

  /**
   * The content to display for this item.
   */
  children: ReactNode;

  /**
   * Optional description text displayed below the main content.
   */
  description?: string;

  /**
   * Show a down arrow indicator instead of pointer (for scroll hints).
   * Only applies when not focused.
   */
  showScrollDown?: boolean;

  /**
   * Show an up arrow indicator instead of pointer (for scroll hints).
   * Only applies when not focused.
   */
  showScrollUp?: boolean;

  /**
   * Whether to apply automatic styling to the children based on focus/selection state.
   * - When true (default): children are wrapped in Text with state-based colors
   * - When false: children are rendered as-is, allowing custom styling
   * @default true
   */
  styled?: boolean;

  /**
   * Whether this item is disabled. Disabled items show dimmed text and no indicators.
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether this ListItem should declare the terminal cursor position.
   * Set false when a child (e.g. BaseTextInput) declares its own cursor.
   * @default true
   */
  declareCursor?: boolean;
};

/**
 * A list item component for selection UIs (dropdowns, multi-selects, menus).
 *
 * Handles the common pattern of:
 * - Pointer indicator (❯) for focused items
 * - Checkmark indicator (✓) for selected items
 * - Scroll indicators (↓↑) for truncated lists
 * - Color states for focus/selection
 *
 * @example
 * // Basic usage in a selection list
 * {options.map((option, i) => (
 *   <ListItem
 *     key={option.id}
 *     isFocused={focusIndex === i}
 *     isSelected={selectedId === option.id}
 *   >
 *     {option.label}
 *   </ListItem>
 * ))}
 *
 * @example
 * // With scroll indicators
 * <ListItem isFocused={false} showScrollUp>First visible item</ListItem>
 * ...
 * <ListItem isFocused={false} showScrollDown>Last visible item</ListItem>
 *
 * @example
 * // With description
 * <ListItem isFocused isSelected={false} description="Secondary text here">
 *   Primary text
 * </ListItem>
 *
 * @example
 * // Custom children styling (styled=false)
 * <ListItem isFocused styled={false}>
 *   <Text color="claude">Custom styled content</Text>
 * </ListItem>
 */
export function ListItem(t0) {
  const $ = _c(32);
  const {
    isFocused,
    isSelected: t1,
    children,
    description,
    showScrollDown,
    showScrollUp,
    styled: t2,
    disabled: t3,
    declareCursor
  } = t0;
  const isSelected = t1 === undefined ? false : t1;
  const styled = t2 === undefined ? true : t2;
  const disabled = t3 === undefined ? false : t3;
  let t4;
  if ($[0] !== disabled || $[1] !== isFocused || $[2] !== showScrollDown || $[3] !== showScrollUp) {
    t4 = function renderIndicator() {
      if (disabled) {
        return <Text> </Text>;
      }
      if (isFocused) {
        return <Text color="suggestion">{figures.pointer}</Text>;
      }
      if (showScrollDown) {
        return <Text dimColor={true}>{figures.arrowDown}</Text>;
      }
      if (showScrollUp) {
        return <Text dimColor={true}>{figures.arrowUp}</Text>;
      }
      return <Text> </Text>;
    };
    $[0] = disabled;
    $[1] = isFocused;
    $[2] = showScrollDown;
    $[3] = showScrollUp;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  const renderIndicator = t4;
  let t5;
  if ($[5] !== disabled || $[6] !== isFocused || $[7] !== isSelected || $[8] !== styled) {
    const getTextColor = function getTextColor() {
      if (disabled) {
        return "inactive";
      }
      if (!styled) {
        return;
      }
      if (isSelected) {
        return "success";
      }
      if (isFocused) {
        return "suggestion";
      }
    };
    t5 = getTextColor();
    $[5] = disabled;
    $[6] = isFocused;
    $[7] = isSelected;
    $[8] = styled;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  const textColor = t5;
  const t6 = isFocused && !disabled && declareCursor !== false;
  let t7;
  if ($[10] !== t6) {
    t7 = {
      line: 0,
      column: 0,
      active: t6
    };
    $[10] = t6;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  const cursorRef = useDeclaredCursor(t7);
  let t8;
  if ($[12] !== renderIndicator) {
    t8 = renderIndicator();
    $[12] = renderIndicator;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  let t9;
  if ($[14] !== children || $[15] !== disabled || $[16] !== styled || $[17] !== textColor) {
    t9 = styled ? <Text color={textColor} dimColor={disabled}>{children}</Text> : children;
    $[14] = children;
    $[15] = disabled;
    $[16] = styled;
    $[17] = textColor;
    $[18] = t9;
  } else {
    t9 = $[18];
  }
  let t10;
  if ($[19] !== disabled || $[20] !== isSelected) {
    t10 = isSelected && !disabled && <Text color="success">{figures.tick}</Text>;
    $[19] = disabled;
    $[20] = isSelected;
    $[21] = t10;
  } else {
    t10 = $[21];
  }
  let t11;
  if ($[22] !== t10 || $[23] !== t8 || $[24] !== t9) {
    t11 = <Box flexDirection="row" gap={1}>{t8}{t9}{t10}</Box>;
    $[22] = t10;
    $[23] = t8;
    $[24] = t9;
    $[25] = t11;
  } else {
    t11 = $[25];
  }
  let t12;
  if ($[26] !== description) {
    t12 = description && <Box paddingLeft={2}><Text color="inactive">{description}</Text></Box>;
    $[26] = description;
    $[27] = t12;
  } else {
    t12 = $[27];
  }
  let t13;
  if ($[28] !== cursorRef || $[29] !== t11 || $[30] !== t12) {
    t13 = <Box ref={cursorRef} flexDirection="column">{t11}{t12}</Box>;
    $[28] = cursorRef;
    $[29] = t11;
    $[30] = t12;
    $[31] = t13;
  } else {
    t13 = $[31];
  }
  return t13;
}
