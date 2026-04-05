import { c as _c } from "react-compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import type { Tools } from '../../../Tool.js';
import type { NormalizedUserMessage, ProgressMessage } from '../../../types/message.js';
import { type buildMessageLookups, CANCEL_MESSAGE, INTERRUPT_MESSAGE_FOR_TOOL_USE, REJECT_MESSAGE } from '../../../utils/messages.js';
import { UserToolCanceledMessage } from './UserToolCanceledMessage.js';
import { UserToolErrorMessage } from './UserToolErrorMessage.js';
import { UserToolRejectMessage } from './UserToolRejectMessage.js';
import { UserToolSuccessMessage } from './UserToolSuccessMessage.js';
import { useGetToolFromMessages } from './utils.js';
type Props = {
  param: ToolResultBlockParam;
  message: NormalizedUserMessage;
  lookups: ReturnType<typeof buildMessageLookups>;
  progressMessagesForMessage: ProgressMessage[];
  style?: 'condensed';
  tools: Tools;
  verbose: boolean;
  width: number | string;
  isTranscriptMode?: boolean;
};
export function UserToolResultMessage(t0) {
  const $ = _c(28);
  const {
    param,
    message,
    lookups,
    progressMessagesForMessage,
    style,
    tools,
    verbose,
    width,
    isTranscriptMode
  } = t0;
  const toolUse = useGetToolFromMessages(param.tool_use_id, tools, lookups);
  if (!toolUse) {
    return null;
  }
  if (typeof param.content === "string" && param.content.startsWith(CANCEL_MESSAGE)) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <UserToolCanceledMessage />;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  if (typeof param.content === "string" && param.content.startsWith(REJECT_MESSAGE) || param.content === INTERRUPT_MESSAGE_FOR_TOOL_USE) {
    const t1 = toolUse.toolUse.input as {
      [key: string]: unknown;
    };
    let t2;
    if ($[1] !== isTranscriptMode || $[2] !== lookups || $[3] !== progressMessagesForMessage || $[4] !== style || $[5] !== t1 || $[6] !== toolUse.tool || $[7] !== tools || $[8] !== verbose) {
      t2 = <UserToolRejectMessage input={t1} progressMessagesForMessage={progressMessagesForMessage} tool={toolUse.tool} tools={tools} lookups={lookups} style={style} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
      $[1] = isTranscriptMode;
      $[2] = lookups;
      $[3] = progressMessagesForMessage;
      $[4] = style;
      $[5] = t1;
      $[6] = toolUse.tool;
      $[7] = tools;
      $[8] = verbose;
      $[9] = t2;
    } else {
      t2 = $[9];
    }
    return t2;
  }
  if (param.is_error) {
    let t1;
    if ($[10] !== isTranscriptMode || $[11] !== param || $[12] !== progressMessagesForMessage || $[13] !== toolUse.tool || $[14] !== tools || $[15] !== verbose) {
      t1 = <UserToolErrorMessage progressMessagesForMessage={progressMessagesForMessage} tool={toolUse.tool} tools={tools} param={param} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
      $[10] = isTranscriptMode;
      $[11] = param;
      $[12] = progressMessagesForMessage;
      $[13] = toolUse.tool;
      $[14] = tools;
      $[15] = verbose;
      $[16] = t1;
    } else {
      t1 = $[16];
    }
    return t1;
  }
  let t1;
  if ($[17] !== isTranscriptMode || $[18] !== lookups || $[19] !== message || $[20] !== progressMessagesForMessage || $[21] !== style || $[22] !== toolUse.tool || $[23] !== toolUse.toolUse.id || $[24] !== tools || $[25] !== verbose || $[26] !== width) {
    t1 = <UserToolSuccessMessage message={message} lookups={lookups} toolUseID={toolUse.toolUse.id} progressMessagesForMessage={progressMessagesForMessage} style={style} tool={toolUse.tool} tools={tools} verbose={verbose} width={width} isTranscriptMode={isTranscriptMode} />;
    $[17] = isTranscriptMode;
    $[18] = lookups;
    $[19] = message;
    $[20] = progressMessagesForMessage;
    $[21] = style;
    $[22] = toolUse.tool;
    $[23] = toolUse.toolUse.id;
    $[24] = tools;
    $[25] = verbose;
    $[26] = width;
    $[27] = t1;
  } else {
    t1 = $[27];
  }
  return t1;
}
