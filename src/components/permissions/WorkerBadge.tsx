import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import { toInkColor } from '../../utils/ink.js';
export type WorkerBadgeProps = {
  name: string;
  color: string;
};

/**
 * Renders a colored badge showing the worker's name for permission prompts.
 * Used to indicate which swarm worker is requesting the permission.
 */
export function WorkerBadge(t0) {
  const $ = _c(7);
  const {
    name,
    color
  } = t0;
  let t1;
  if ($[0] !== color) {
    t1 = toInkColor(color);
    $[0] = color;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const inkColor = t1;
  let t2;
  if ($[2] !== name) {
    t2 = <Text bold={true}>@{name}</Text>;
    $[2] = name;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== inkColor || $[5] !== t2) {
    t3 = <Box flexDirection="row" gap={1}><Text color={inkColor}>{BLACK_CIRCLE} {t2}</Text></Box>;
    $[4] = inkColor;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
