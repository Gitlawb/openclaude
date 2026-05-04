import { c as _c } from "react-compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { BULLET_OPERATOR } from '../../../constants/figures.js';
import { Text } from '../../../ink.js';
import { filterToolProgressMessages, type Tool, type Tools } from '../../../Tool.js';
import type { ProgressMessage } from '../../../types/message.js';
import { INTERRUPT_MESSAGE_FOR_TOOL_USE, isClassifierDenial, PLAN_REJECTION_PREFIX, REJECT_MESSAGE_WITH_REASON_PREFIX } from '../../../utils/messages.js';
import { FallbackToolUseErrorMessage } from '../../FallbackToolUseErrorMessage.js';
import { InterruptedByUser } from '../../InterruptedByUser.js';
import { MessageResponse } from '../../MessageResponse.js';
import { RejectedPlanMessage } from './RejectedPlanMessage.js';
import { RejectedToolUseMessage } from './RejectedToolUseMessage.js';
type Props = {
  progressMessagesForMessage: ProgressMessage[];
  tool?: Tool; // undefined when resuming an old conversation that uses an old tool
  tools: Tools;
  param: ToolResultBlockParam;
  verbose: boolean;
  isTranscriptMode?: boolean;
};
export function UserToolErrorMessage(t0) {
  const $ = _c(14);
  const {
    progressMessagesForMessage,
    tool,
    tools,
    param,
    verbose,
    isTranscriptMode
  } = t0;
  if (typeof param.content === "string" && param.content.includes(INTERRUPT_MESSAGE_FOR_TOOL_USE)) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <MessageResponse height={1}><InterruptedByUser /></MessageResponse>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  if (typeof param.content === "string" && param.content.startsWith(PLAN_REJECTION_PREFIX)) {
    let t1;
    if ($[1] !== param.content) {
      t1 = param.content.substring(PLAN_REJECTION_PREFIX.length);
      $[1] = param.content;
      $[2] = t1;
    } else {
      t1 = $[2];
    }
    const planContent = t1;
    let t2;
    if ($[3] !== planContent) {
      t2 = <RejectedPlanMessage plan={planContent} />;
      $[3] = planContent;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  if (typeof param.content === "string" && param.content.startsWith(REJECT_MESSAGE_WITH_REASON_PREFIX)) {
    let t1;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <RejectedToolUseMessage />;
      $[5] = t1;
    } else {
      t1 = $[5];
    }
    return t1;
  }
  if (true && typeof param.content === "string" && isClassifierDenial(param.content)) {
    let t1;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <MessageResponse height={1}><Text dimColor={true}>Denied by auto mode classifier {BULLET_OPERATOR} open an issue if incorrect</Text></MessageResponse>;
      $[6] = t1;
    } else {
      t1 = $[6];
    }
    return t1;
  }
  let t1;
  if ($[7] !== isTranscriptMode || $[8] !== param.content || $[9] !== progressMessagesForMessage || $[10] !== tool || $[11] !== tools || $[12] !== verbose) {
    t1 = tool?.renderToolUseErrorMessage?.(param.content, {
      progressMessagesForMessage: filterToolProgressMessages(progressMessagesForMessage),
      tools,
      verbose,
      isTranscriptMode
    }) ?? <FallbackToolUseErrorMessage result={param.content} verbose={verbose} />;
    $[7] = isTranscriptMode;
    $[8] = param.content;
    $[9] = progressMessagesForMessage;
    $[10] = tool;
    $[11] = tools;
    $[12] = verbose;
    $[13] = t1;
  } else {
    t1 = $[13];
  }
  return t1;
}
