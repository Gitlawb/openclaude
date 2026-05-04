import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
// @ts-expect-error module has no exported member
import type { NormalizedMessage } from '../types/message.js';
type Props = {
  message: NormalizedMessage;
  isTranscriptMode: boolean;
};
export function MessageTimestamp(t0) {
  const $ = _c(10);
  const {
    message,
    isTranscriptMode
  } = t0;
  const shouldShowTimestamp = isTranscriptMode && message.timestamp && message.type === "assistant" && message.message.content.some(_temp);
  if (!shouldShowTimestamp) {
    return null;
  }
  let T0;
  let formattedTimestamp;
  let t1;
  if ($[0] !== message.timestamp) {
    formattedTimestamp = new Date(message.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    T0 = Box;
    t1 = stringWidth(formattedTimestamp);
    $[0] = message.timestamp;
    $[1] = T0;
    $[2] = formattedTimestamp;
    $[3] = t1;
  } else {
    T0 = $[1];
    formattedTimestamp = $[2];
    t1 = $[3];
  }
  let t2;
  if ($[4] !== formattedTimestamp) {
    t2 = <Text dimColor={true}>{formattedTimestamp}</Text>;
    $[4] = formattedTimestamp;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== T0 || $[7] !== t1 || $[8] !== t2) {
    t3 = <T0 minWidth={t1}>{t2}</T0>;
    $[6] = T0;
    $[7] = t1;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  return t3;
}
function _temp(c) {
  return c.type === "text";
}
