import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
type Props = {
  char: string;
  index: number;
  glimmerIndex: number;
  messageColor: keyof Theme;
  shimmerColor: keyof Theme;
};
export function ShimmerChar(t0) {
  const $ = _c(3);
  const {
    char,
    index,
    glimmerIndex,
    messageColor,
    shimmerColor
  } = t0;
  const isHighlighted = index === glimmerIndex;
  const isNearHighlight = Math.abs(index - glimmerIndex) === 1;
  const shouldUseShimmer = isHighlighted || isNearHighlight;
  const t1 = shouldUseShimmer ? shimmerColor : messageColor;
  let t2;
  if ($[0] !== char || $[1] !== t1) {
    t2 = <Text color={t1}>{char}</Text>;
    $[0] = char;
    $[1] = t1;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
}
