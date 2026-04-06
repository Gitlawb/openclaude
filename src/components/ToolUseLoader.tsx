import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { useBlink } from '../hooks/useBlink.js';
import { Box, Text } from '../ink.js';
type Props = {
  isError: boolean;
  isUnresolved: boolean;
  shouldAnimate: boolean;
};
export function ToolUseLoader(t0) {
  const $ = _c(7);
  const {
    isError,
    isUnresolved,
    shouldAnimate
  } = t0;
  const [ref, isBlinking] = useBlink(shouldAnimate);
  const color = isUnresolved ? undefined : isError ? "error" : "success";
  const t1 = !shouldAnimate || isBlinking || isError || !isUnresolved ? BLACK_CIRCLE : " ";
  let t2;
  if ($[0] !== color || $[1] !== isUnresolved || $[2] !== t1) {
    t2 = <Text color={color} dimColor={isUnresolved}>{t1}</Text>;
    $[0] = color;
    $[1] = isUnresolved;
    $[2] = t1;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== ref || $[5] !== t2) {
    t3 = <Box ref={ref} minWidth={2}>{t2}</Box>;
    $[4] = ref;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  return t3;
}
