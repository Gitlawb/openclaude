import { c as _c } from "react-compiler-runtime";
import React, { type PropsWithChildren } from 'react';
import Box, { type Props as BoxProps } from './Box.js';
type Props = Omit<BoxProps, 'noSelect'> & {
  /**
   * Extend the exclusion zone from column 0 to this box's right edge,
   * for every row this box occupies. Use for gutters rendered inside a
   * wider indented container (e.g. a diff inside a tool message row):
   * without this, a multi-row drag picks up the container's leading
   * indent on rows below the prefix.
   *
   * @default false
   */
  fromLeftEdge?: boolean;
};

/**
 * Marks its contents as non-selectable in fullscreen text selection.
 * Cells inside this box are skipped by both the selection highlight and
 * the copied text — the gutter stays visually unchanged while the user
 * drags, making it clear what will be copied.
 *
 * Use to fence off gutters (line numbers, diff +/- sigils, list bullets)
 * so click-drag over rendered code yields clean pasteable content:
 *
 *   <Box flexDirection="row">
 *     <NoSelect fromLeftEdge><Text dimColor> 42 +</Text></NoSelect>
 *     <Text>const x = 1</Text>
 *   </Box>
 *
 * Only affects alt-screen text selection (<AlternateScreen> with mouse
 * tracking). No-op in the main-screen scrollback render where the
 * terminal's native selection is used instead.
 */
export function NoSelect(t0) {
  const $ = _c(8);
  let boxProps;
  let children;
  let fromLeftEdge;
  if ($[0] !== t0) {
    ({
      children,
      fromLeftEdge,
      ...boxProps
    } = t0);
    $[0] = t0;
    $[1] = boxProps;
    $[2] = children;
    $[3] = fromLeftEdge;
  } else {
    boxProps = $[1];
    children = $[2];
    fromLeftEdge = $[3];
  }
  const t1 = fromLeftEdge ? "from-left-edge" : true;
  let t2;
  if ($[4] !== boxProps || $[5] !== children || $[6] !== t1) {
    t2 = <Box {...boxProps} noSelect={t1}>{children}</Box>;
    $[4] = boxProps;
    $[5] = children;
    $[6] = t1;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}
