import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
type Props = {
  /**
   * How much progress to display, between 0 and 1 inclusive
   */
  ratio: number; // [0, 1]

  /**
   * How many characters wide to draw the progress bar
   */
  width: number; // how many characters wide

  /**
   * Optional color for the filled portion of the bar
   */
  fillColor?: keyof Theme;

  /**
   * Optional color for the empty portion of the bar
   */
  emptyColor?: keyof Theme;
};
const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
export function ProgressBar(t0) {
  const $ = _c(13);
  const {
    ratio: inputRatio,
    width,
    fillColor,
    emptyColor
  } = t0;
  const ratio = Math.min(1, Math.max(0, inputRatio));
  const whole = Math.floor(ratio * width);
  let t1;
  if ($[0] !== whole) {
    t1 = BLOCKS[BLOCKS.length - 1].repeat(whole);
    $[0] = whole;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let segments;
  if ($[2] !== ratio || $[3] !== t1 || $[4] !== whole || $[5] !== width) {
    segments = [t1];
    if (whole < width) {
      const remainder = ratio * width - whole;
      const middle = Math.floor(remainder * BLOCKS.length);
      segments.push(BLOCKS[middle]);
      const empty = width - whole - 1;
      if (empty > 0) {
        let t2;
        if ($[7] !== empty) {
          t2 = BLOCKS[0].repeat(empty);
          $[7] = empty;
          $[8] = t2;
        } else {
          t2 = $[8];
        }
        segments.push(t2);
      }
    }
    $[2] = ratio;
    $[3] = t1;
    $[4] = whole;
    $[5] = width;
    $[6] = segments;
  } else {
    segments = $[6];
  }
  const t2 = segments.join("");
  let t3;
  if ($[9] !== emptyColor || $[10] !== fillColor || $[11] !== t2) {
    t3 = <Text color={fillColor} backgroundColor={emptyColor}>{t2}</Text>;
    $[9] = emptyColor;
    $[10] = fillColor;
    $[11] = t2;
    $[12] = t3;
  } else {
    t3 = $[12];
  }
  return t3;
}
