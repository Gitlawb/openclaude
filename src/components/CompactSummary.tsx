import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { Box, Text } from '../ink.js';
import type { Screen } from '../screens/REPL.js';
import type { NormalizedUserMessage } from '../types/message.js';
import { getUserMessageText } from '../utils/messages.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { MessageResponse } from './MessageResponse.js';
type Props = {
  message: NormalizedUserMessage;
  screen: Screen;
};
export function CompactSummary(t0) {
  const $ = _c(24);
  const {
    message,
    screen
  } = t0;
  const isTranscriptMode = screen === "transcript";
  let t1;
  if ($[0] !== message) {
    t1 = getUserMessageText(message) || "";
    $[0] = message;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const textContent = t1;
  const metadata = message.summarizeMetadata;
  if (metadata) {
    let t2;
    if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
      t2 = <Box minWidth={2}><Text color="text">{BLACK_CIRCLE}</Text></Box>;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    let t3;
    if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text bold={true}>Summarized conversation</Text>;
      $[3] = t3;
    } else {
      t3 = $[3];
    }
    let t4;
    if ($[4] !== isTranscriptMode || $[5] !== metadata) {
      t4 = !isTranscriptMode && <MessageResponse><Box flexDirection="column"><Text dimColor={true}>Summarized {metadata.messagesSummarized} messages{" "}{metadata.direction === "up_to" ? "up to this point" : "from this point"}</Text>{metadata.userContext && <Text dimColor={true}>Context: {"\u201C"}{metadata.userContext}{"\u201D"}</Text>}<Text dimColor={true}><ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand history" parens={true} /></Text></Box></MessageResponse>;
      $[4] = isTranscriptMode;
      $[5] = metadata;
      $[6] = t4;
    } else {
      t4 = $[6];
    }
    let t5;
    if ($[7] !== isTranscriptMode || $[8] !== textContent) {
      t5 = isTranscriptMode && <MessageResponse><Text>{textContent}</Text></MessageResponse>;
      $[7] = isTranscriptMode;
      $[8] = textContent;
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    let t6;
    if ($[10] !== t4 || $[11] !== t5) {
      t6 = <Box flexDirection="column" marginTop={1}><Box flexDirection="row">{t2}<Box flexDirection="column">{t3}{t4}{t5}</Box></Box></Box>;
      $[10] = t4;
      $[11] = t5;
      $[12] = t6;
    } else {
      t6 = $[12];
    }
    return t6;
  }
  let t2;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box minWidth={2}><Text color="text">{BLACK_CIRCLE}</Text></Box>;
    $[13] = t2;
  } else {
    t2 = $[13];
  }
  let t3;
  if ($[14] !== isTranscriptMode) {
    t3 = !isTranscriptMode && <Text dimColor={true}>{" "}<ConfigurableShortcutHint action="app:toggleTranscript" context="Global" fallback="ctrl+o" description="expand" parens={true} /></Text>;
    $[14] = isTranscriptMode;
    $[15] = t3;
  } else {
    t3 = $[15];
  }
  let t4;
  if ($[16] !== t3) {
    t4 = <Box flexDirection="row">{t2}<Box flexDirection="column"><Text bold={true}>Compact summary{t3}</Text></Box></Box>;
    $[16] = t3;
    $[17] = t4;
  } else {
    t4 = $[17];
  }
  let t5;
  if ($[18] !== isTranscriptMode || $[19] !== textContent) {
    t5 = isTranscriptMode && <MessageResponse><Text>{textContent}</Text></MessageResponse>;
    $[18] = isTranscriptMode;
    $[19] = textContent;
    $[20] = t5;
  } else {
    t5 = $[20];
  }
  let t6;
  if ($[21] !== t4 || $[22] !== t5) {
    t6 = <Box flexDirection="column" marginTop={1}>{t4}{t5}</Box>;
    $[21] = t4;
    $[22] = t5;
    $[23] = t6;
  } else {
    t6 = $[23];
  }
  return t6;
}
