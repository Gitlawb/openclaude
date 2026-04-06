import { c as _c } from "react-compiler-runtime";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserCommandMessage(t0) {
  const $ = _c(19);
  const {
    addMargin,
    param: t1
  } = t0;
  const {
    text
  } = t1;
  let t2;
  if ($[0] !== text) {
    t2 = extractTag(text, COMMAND_MESSAGE_TAG);
    $[0] = text;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const commandMessage = t2;
  let t3;
  if ($[2] !== text) {
    t3 = extractTag(text, "command-args");
    $[2] = text;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const args = t3;
  const isSkillFormat = extractTag(text, "skill-format") === "true";
  if (!commandMessage) {
    return null;
  }
  if (isSkillFormat) {
    const t4 = addMargin ? 1 : 0;
    let t5;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = <Text color="subtle">{figures.pointer} </Text>;
      $[4] = t5;
    } else {
      t5 = $[4];
    }
    let t6;
    if ($[5] !== commandMessage) {
      t6 = <Text>{t5}<Text color="text">Skill({commandMessage})</Text></Text>;
      $[5] = commandMessage;
      $[6] = t6;
    } else {
      t6 = $[6];
    }
    let t7;
    if ($[7] !== t4 || $[8] !== t6) {
      t7 = <Box flexDirection="column" marginTop={t4} backgroundColor="userMessageBackground" paddingRight={1}>{t6}</Box>;
      $[7] = t4;
      $[8] = t6;
      $[9] = t7;
    } else {
      t7 = $[9];
    }
    return t7;
  }
  let t4;
  if ($[10] !== args || $[11] !== commandMessage) {
    t4 = [commandMessage, args].filter(Boolean);
    $[10] = args;
    $[11] = commandMessage;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const content = `/${t4.join(" ")}`;
  const t5 = addMargin ? 1 : 0;
  let t6;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = <Text color="subtle">{figures.pointer} </Text>;
    $[13] = t6;
  } else {
    t6 = $[13];
  }
  let t7;
  if ($[14] !== content) {
    t7 = <Text>{t6}<Text color="text">{content}</Text></Text>;
    $[14] = content;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let t8;
  if ($[16] !== t5 || $[17] !== t7) {
    t8 = <Box flexDirection="column" marginTop={t5} backgroundColor="userMessageBackground" paddingRight={1}>{t7}</Box>;
    $[16] = t5;
    $[17] = t7;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  return t8;
}
