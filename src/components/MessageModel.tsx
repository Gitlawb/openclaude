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
export function MessageModel(t0) {
  const $ = _c(5);
  const {
    message,
    isTranscriptMode
  } = t0;
  const shouldShowModel = isTranscriptMode && message.type === "assistant" && message.message.model && message.message.content.some(_temp);
  if (!shouldShowModel) {
    return null;
  }
  const t1 = stringWidth(message.message.model) + 8;
  let t2;
  if ($[0] !== message.message.model) {
    t2 = <Text dimColor={true}>{message.message.model}</Text>;
    $[0] = message.message.model;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== t1 || $[3] !== t2) {
    t3 = <Box minWidth={t1}>{t2}</Box>;
    $[2] = t1;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp(c) {
  return c.type === "text";
}
