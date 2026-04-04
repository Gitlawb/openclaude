import { c as _c } from "react-compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserBashInputMessage(t0) {
  const $ = _c(8);
  const {
    param: t1,
    addMargin
  } = t0;
  const {
    text
  } = t1;
  let t2;
  if ($[0] !== text) {
    t2 = extractTag(text, "bash-input");
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const input = t2;
  if (!input) {
    return null;
  }
  const t3 = addMargin ? 1 : 0;
  let t4;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Text color="bashBorder">! </Text>;
    $[2] = t4;
  } else {
    t4 = $[2];
  }
  let t5;
  if ($[3] !== input) {
    t5 = <Text color="text">{input}</Text>;
    $[3] = input;
    $[4] = t5;
  } else {
    t5 = $[4];
  }
  let t6;
  if ($[5] !== t3 || $[6] !== t5) {
    t6 = <Box flexDirection="row" marginTop={t3} backgroundColor="bashMessageBackgroundColor" paddingRight={1}>{t4}{t5}</Box>;
    $[5] = t3;
    $[6] = t5;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
}
