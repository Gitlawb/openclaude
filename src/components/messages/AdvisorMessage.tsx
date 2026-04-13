import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { AdvisorBlock } from '../../utils/advisor.js';
import { renderModelName } from '../../utils/model/model.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { MessageResponse } from '../MessageResponse.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
type Props = {
  block: AdvisorBlock;
  addMargin: boolean;
  resolvedToolUseIDs: Set<string>;
  erroredToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  verbose: boolean;
  advisorModel?: string;
};
export function AdvisorMessage(t0) {
  const $ = _c(30);
  const {
    block,
    addMargin,
    resolvedToolUseIDs,
    erroredToolUseIDs,
    shouldAnimate,
    verbose,
    advisorModel
  } = t0;
  if (block.type === "server_tool_use") {
    let t1;
    if ($[0] !== block.input) {
      t1 = block.input && Object.keys(block.input).length > 0 ? jsonStringify(block.input) : null;
      $[0] = block.input;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    const input = t1;
    const t2 = addMargin ? 1 : 0;
    let t3;
    if ($[2] !== block.id || $[3] !== resolvedToolUseIDs) {
      t3 = resolvedToolUseIDs.has(block.id);
      $[2] = block.id;
      $[3] = resolvedToolUseIDs;
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    const t4 = !t3;
    let t5;
    if ($[5] !== block.id || $[6] !== erroredToolUseIDs) {
      t5 = erroredToolUseIDs.has(block.id);
      $[5] = block.id;
      $[6] = erroredToolUseIDs;
      $[7] = t5;
    } else {
      t5 = $[7];
    }
    let t6;
    if ($[8] !== shouldAnimate || $[9] !== t4 || $[10] !== t5) {
      t6 = <ToolUseLoader shouldAnimate={shouldAnimate} isUnresolved={t4} isError={t5} />;
      $[8] = shouldAnimate;
      $[9] = t4;
      $[10] = t5;
      $[11] = t6;
    } else {
      t6 = $[11];
    }
    let t7;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t7 = <Text bold={true}>Advising</Text>;
      $[12] = t7;
    } else {
      t7 = $[12];
    }
    let t8;
    if ($[13] !== advisorModel) {
      t8 = advisorModel ? <Text dimColor={true}> using {renderModelName(advisorModel)}</Text> : null;
      $[13] = advisorModel;
      $[14] = t8;
    } else {
      t8 = $[14];
    }
    let t9;
    if ($[15] !== input) {
      t9 = input ? <Text dimColor={true}> · {input}</Text> : null;
      $[15] = input;
      $[16] = t9;
    } else {
      t9 = $[16];
    }
    let t10;
    if ($[17] !== t2 || $[18] !== t6 || $[19] !== t8 || $[20] !== t9) {
      t10 = <Box marginTop={t2} paddingRight={2} flexDirection="row">{t6}{t7}{t8}{t9}</Box>;
      $[17] = t2;
      $[18] = t6;
      $[19] = t8;
      $[20] = t9;
      $[21] = t10;
    } else {
      t10 = $[21];
    }
    return t10;
  }
  let body;
  bb0: switch (block.content.type) {
    case "advisor_tool_result_error":
      {
        let t1;
        if ($[22] !== block.content.error_code) {
          t1 = <Text color="error">Advisor unavailable ({block.content.error_code})</Text>;
          $[22] = block.content.error_code;
          $[23] = t1;
        } else {
          t1 = $[23];
        }
        body = t1;
        break bb0;
      }
    case "advisor_result":
      {
        let t1;
        if ($[24] !== block.content.text || $[25] !== verbose) {
          t1 = verbose ? <Text dimColor={true}>{block.content.text}</Text> : <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback <CtrlOToExpand /></Text>;
          $[24] = block.content.text;
          $[25] = verbose;
          $[26] = t1;
        } else {
          t1 = $[26];
        }
        body = t1;
        break bb0;
      }
    case "advisor_redacted_result":
      {
        let t1;
        if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
          t1 = <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback</Text>;
          $[27] = t1;
        } else {
          t1 = $[27];
        }
        body = t1;
      }
  }
  let t1;
  if ($[28] !== body) {
    t1 = <Box paddingRight={2}><MessageResponse>{body}</MessageResponse></Box>;
    $[28] = body;
    $[29] = t1;
  } else {
    t1 = $[29];
  }
  return t1;
}
