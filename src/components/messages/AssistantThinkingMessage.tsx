import { c as _c } from "react-compiler-runtime";
import type { ThinkingBlock, ThinkingBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { Markdown } from '../Markdown.js';
type Props = {
  // Accept either full ThinkingBlock/ThinkingBlockParam or a minimal shape with just type and thinking
  param: ThinkingBlock | ThinkingBlockParam | {
    type: 'thinking';
    thinking: string;
  };
  addMargin: boolean;
  isTranscriptMode: boolean;
  verbose: boolean;
  /** When true, hide this thinking block entirely (used for past thinking in transcript mode) */
  hideInTranscript?: boolean;
};
export function AssistantThinkingMessage(t0) {
  const $ = _c(9);
  const {
    param: t1,
    addMargin: t2,
    isTranscriptMode,
    verbose,
    hideInTranscript: t3
  } = t0;
  const {
    thinking
  } = t1;
  const addMargin = t2 === undefined ? false : t2;
  const hideInTranscript = t3 === undefined ? false : t3;
  if (!thinking) {
    return null;
  }
  if (hideInTranscript) {
    return null;
  }
  const shouldShowFullThinking = isTranscriptMode || verbose;
  if (!shouldShowFullThinking) {
    const t4 = addMargin ? 1 : 0;
    let t5;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text dimColor={true} italic={true}>{"\u2234 Thinking"} <CtrlOToExpand /></Text>;
      $[0] = t5;
    } else {
      t5 = $[0];
    }
    let t6;
    if ($[1] !== t4) {
      t6 = <Box marginTop={t4}>{t5}</Box>;
      $[1] = t4;
      $[2] = t6;
    } else {
      t6 = $[2];
    }
    return t6;
  }
  const t4 = addMargin ? 1 : 0;
  let t5;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text dimColor={true} italic={true}>{"\u2234 Thinking"}…</Text>;
    $[3] = t5;
  } else {
    t5 = $[3];
  }
  let t6;
  if ($[4] !== thinking) {
    t6 = <Box paddingLeft={2}><Markdown dimColor={true}>{thinking}</Markdown></Box>;
    $[4] = thinking;
    $[5] = t6;
  } else {
    t6 = $[5];
  }
  let t7;
  if ($[6] !== t4 || $[7] !== t6) {
    t7 = <Box flexDirection="column" gap={1} marginTop={t4} width="100%">{t5}{t6}</Box>;
    $[6] = t4;
    $[7] = t6;
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  return t7;
}
