import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Ansi, Box, Text, useAnimationFrame } from '../../ink.js';
import { segmentTextByHighlights, type TextHighlight } from '../../utils/textHighlighting.js';
import { ShimmerChar } from '../Spinner/ShimmerChar.js';
type Props = {
  text: string;
  highlights: TextHighlight[];
};
type LinePart = {
  text: string;
  highlight: TextHighlight | undefined;
  start: number;
};
export function HighlightedInput(t0) {
  const $ = _c(23);
  const {
    text,
    highlights
  } = t0;
  let lines;
  if ($[0] !== highlights || $[1] !== text) {
    const segments = segmentTextByHighlights(text, highlights);
    lines = [[]];
    let pos = 0;
    for (const segment of segments) {
      const parts = segment.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push([]);
          pos = pos + 1;
        }
        const part = parts[i];
        if (part.length > 0) {
          lines[lines.length - 1].push({
            text: part,
            highlight: segment.highlight,
            start: pos
          });
        }
        pos = pos + part.length;
      }
    }
    $[0] = highlights;
    $[1] = text;
    $[2] = lines;
  } else {
    lines = $[2];
  }
  let t1;
  if ($[3] !== highlights) {
    t1 = highlights.some(_temp);
    $[3] = highlights;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const hasShimmer = t1;
  let sweepStart = 0;
  let cycleLength = 1;
  if (hasShimmer) {
    let lo = Infinity;
    let hi = -Infinity;
    if ($[5] !== hi || $[6] !== highlights || $[7] !== lo) {
      for (const h_0 of highlights) {
        if (h_0.shimmerColor) {
          lo = Math.min(lo, h_0.start);
          hi = Math.max(hi, h_0.end);
        }
      }
      $[5] = hi;
      $[6] = highlights;
      $[7] = lo;
      $[8] = lo;
      $[9] = hi;
    } else {
      lo = $[8];
      hi = $[9];
    }
    sweepStart = lo - 10;
    cycleLength = hi - lo + 20;
  }
  let t2;
  if ($[10] !== cycleLength || $[11] !== hasShimmer || $[12] !== lines || $[13] !== sweepStart) {
    t2 = {
      lines,
      hasShimmer,
      sweepStart,
      cycleLength
    };
    $[10] = cycleLength;
    $[11] = hasShimmer;
    $[12] = lines;
    $[13] = sweepStart;
    $[14] = t2;
  } else {
    t2 = $[14];
  }
  const {
    lines: lines_0,
    hasShimmer: hasShimmer_0,
    sweepStart: sweepStart_0,
    cycleLength: cycleLength_0
  } = t2;
  const [ref, time] = useAnimationFrame(hasShimmer_0 ? 50 : null);
  const glimmerIndex = hasShimmer_0 ? sweepStart_0 + Math.floor(time / 50) % cycleLength_0 : -100;
  let t3;
  if ($[15] !== glimmerIndex || $[16] !== lines_0) {
    let t4;
    if ($[18] !== glimmerIndex) {
      t4 = (lineParts, lineIndex) => <Box key={lineIndex}>{lineParts.length === 0 ? <Text> </Text> : lineParts.map((part_0, partIndex) => {
          if (part_0.highlight?.shimmerColor && part_0.highlight.color) {
            return <Text key={partIndex}>{part_0.text.split("").map((char, charIndex) => <ShimmerChar key={charIndex} char={char} index={part_0.start + charIndex} glimmerIndex={glimmerIndex} messageColor={part_0.highlight.color} shimmerColor={part_0.highlight.shimmerColor} />)}</Text>;
          }
          return <Text key={partIndex} color={part_0.highlight?.color} dimColor={part_0.highlight?.dimColor} inverse={part_0.highlight?.inverse}><Ansi>{part_0.text}</Ansi></Text>;
        })}</Box>;
      $[18] = glimmerIndex;
      $[19] = t4;
    } else {
      t4 = $[19];
    }
    t3 = lines_0.map(t4);
    $[15] = glimmerIndex;
    $[16] = lines_0;
    $[17] = t3;
  } else {
    t3 = $[17];
  }
  let t4;
  if ($[20] !== ref || $[21] !== t3) {
    t4 = <Box ref={ref} flexDirection="column">{t3}</Box>;
    $[20] = ref;
    $[21] = t3;
    $[22] = t4;
  } else {
    t4 = $[22];
  }
  return t4;
}
function _temp(h) {
  return h.shimmerColor;
}
