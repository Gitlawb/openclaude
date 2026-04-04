import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import { truncate } from '../../utils/format.js';
export type FeedLine = {
  text: string;
  timestamp?: string;
};
export type FeedConfig = {
  title: string;
  lines: FeedLine[];
  footer?: string;
  emptyMessage?: string;
  customContent?: {
    content: React.ReactNode;
    width: number;
  };
};
type FeedProps = {
  config: FeedConfig;
  actualWidth: number;
};
export function calculateFeedWidth(config: FeedConfig): number {
  const {
    title,
    lines,
    footer,
    emptyMessage,
    customContent
  } = config;
  let maxWidth = stringWidth(title);
  if (customContent !== undefined) {
    maxWidth = Math.max(maxWidth, customContent.width);
  } else if (lines.length === 0 && emptyMessage) {
    maxWidth = Math.max(maxWidth, stringWidth(emptyMessage));
  } else {
    const gap = '  ';
    const maxTimestampWidth = Math.max(0, ...lines.map(line => line.timestamp ? stringWidth(line.timestamp) : 0));
    for (const line of lines) {
      const timestampWidth = maxTimestampWidth > 0 ? maxTimestampWidth : 0;
      const lineWidth = stringWidth(line.text) + (timestampWidth > 0 ? timestampWidth + gap.length : 0);
      maxWidth = Math.max(maxWidth, lineWidth);
    }
  }
  if (footer) {
    maxWidth = Math.max(maxWidth, stringWidth(footer));
  }
  return maxWidth;
}
export function Feed(t0) {
  const $ = _c(15);
  const {
    config,
    actualWidth
  } = t0;
  const {
    title,
    lines,
    footer,
    emptyMessage,
    customContent
  } = config;
  let t1;
  if ($[0] !== lines) {
    t1 = Math.max(0, ...lines.map(_temp));
    $[0] = lines;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const maxTimestampWidth = t1;
  let t2;
  if ($[2] !== title) {
    t2 = <Text bold={true} color="claude">{title}</Text>;
    $[2] = title;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== actualWidth || $[5] !== customContent || $[6] !== emptyMessage || $[7] !== footer || $[8] !== lines || $[9] !== maxTimestampWidth) {
    t3 = customContent ? <>{customContent.content}{footer && <Text dimColor={true} italic={true}>{truncate(footer, actualWidth)}</Text>}</> : lines.length === 0 && emptyMessage ? <Text dimColor={true}>{truncate(emptyMessage, actualWidth)}</Text> : <>{lines.map((line_0, index) => {
        const textWidth = Math.max(10, actualWidth - (maxTimestampWidth > 0 ? maxTimestampWidth + 2 : 0));
        return <Text key={index}>{maxTimestampWidth > 0 && <><Text dimColor={true}>{(line_0.timestamp || "").padEnd(maxTimestampWidth)}</Text>{"  "}</>}<Text>{truncate(line_0.text, textWidth)}</Text></Text>;
      })}{footer && <Text dimColor={true} italic={true}>{truncate(footer, actualWidth)}</Text>}</>;
    $[4] = actualWidth;
    $[5] = customContent;
    $[6] = emptyMessage;
    $[7] = footer;
    $[8] = lines;
    $[9] = maxTimestampWidth;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  let t4;
  if ($[11] !== actualWidth || $[12] !== t2 || $[13] !== t3) {
    t4 = <Box flexDirection="column" width={actualWidth}>{t2}{t3}</Box>;
    $[11] = actualWidth;
    $[12] = t2;
    $[13] = t3;
    $[14] = t4;
  } else {
    t4 = $[14];
  }
  return t4;
}
function _temp(line) {
  return line.timestamp ? stringWidth(line.timestamp) : 0;
}
