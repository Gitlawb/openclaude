import { c as _c } from "react-compiler-runtime";
import React, { type ReactNode } from 'react';
import { ListItem } from '../design-system/ListItem.js';
export type SelectOptionProps = {
  /**
   * Determines if option is focused.
   */
  readonly isFocused: boolean;

  /**
   * Determines if option is selected.
   */
  readonly isSelected: boolean;

  /**
   * Option label.
   */
  readonly children: ReactNode;

  /**
   * Optional description to display below the label.
   */
  readonly description?: string;

  /**
   * Determines if the down arrow should be shown.
   */
  readonly shouldShowDownArrow?: boolean;

  /**
   * Determines if the up arrow should be shown.
   */
  readonly shouldShowUpArrow?: boolean;

  /**
   * Whether ListItem should declare the terminal cursor position.
   * Set false when a child declares its own cursor (e.g. BaseTextInput).
   */
  readonly declareCursor?: boolean;
};
export function SelectOption(t0) {
  const $ = _c(8);
  const {
    isFocused,
    isSelected,
    children,
    description,
    shouldShowDownArrow,
    shouldShowUpArrow,
    declareCursor
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== declareCursor || $[2] !== description || $[3] !== isFocused || $[4] !== isSelected || $[5] !== shouldShowDownArrow || $[6] !== shouldShowUpArrow) {
    t1 = <ListItem isFocused={isFocused} isSelected={isSelected} description={description} showScrollDown={shouldShowDownArrow} showScrollUp={shouldShowUpArrow} styled={false} declareCursor={declareCursor}>{children}</ListItem>;
    $[0] = children;
    $[1] = declareCursor;
    $[2] = description;
    $[3] = isFocused;
    $[4] = isSelected;
    $[5] = shouldShowDownArrow;
    $[6] = shouldShowUpArrow;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  return t1;
}
