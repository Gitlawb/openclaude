import { c as _c } from "react-compiler-runtime";
import React from 'react';
import stripAnsi from 'strip-ansi';
import { Box, Text } from '../../ink.js';
import { formatFileSize } from '../../utils/format.js';
import { MessageResponse } from '../MessageResponse.js';
import { OffscreenFreeze } from '../OffscreenFreeze.js';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';
type Props = {
  output: string;
  fullOutput: string;
  elapsedTimeSeconds?: number;
  totalLines?: number;
  totalBytes?: number;
  timeoutMs?: number;
  taskId?: string;
  verbose: boolean;
};
export function ShellProgressMessage(t0) {
  const $ = _c(30);
  const {
    output,
    fullOutput,
    elapsedTimeSeconds,
    totalLines,
    totalBytes,
    timeoutMs,
    verbose
  } = t0;
  let t1;
  if ($[0] !== fullOutput) {
    t1 = stripAnsi(fullOutput.trim());
    $[0] = fullOutput;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const strippedFullOutput = t1;
  let lines;
  let t2;
  if ($[2] !== output || $[3] !== strippedFullOutput || $[4] !== verbose) {
    const strippedOutput = stripAnsi(output.trim());
    lines = strippedOutput.split("\n").filter(_temp);
    t2 = verbose ? strippedFullOutput : lines.slice(-5).join("\n");
    $[2] = output;
    $[3] = strippedFullOutput;
    $[4] = verbose;
    $[5] = lines;
    $[6] = t2;
  } else {
    lines = $[5];
    t2 = $[6];
  }
  const displayLines = t2;
  if (!lines.length) {
    let t3;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = <Text dimColor={true}>Running… </Text>;
      $[7] = t3;
    } else {
      t3 = $[7];
    }
    let t4;
    if ($[8] !== elapsedTimeSeconds || $[9] !== timeoutMs) {
      t4 = <MessageResponse><OffscreenFreeze>{t3}<ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} /></OffscreenFreeze></MessageResponse>;
      $[8] = elapsedTimeSeconds;
      $[9] = timeoutMs;
      $[10] = t4;
    } else {
      t4 = $[10];
    }
    return t4;
  }
  const extraLines = totalLines ? Math.max(0, totalLines - 5) : 0;
  let lineStatus = "";
  if (!verbose && totalBytes && totalLines) {
    lineStatus = `~${totalLines} lines`;
  } else {
    if (!verbose && extraLines > 0) {
      lineStatus = `+${extraLines} lines`;
    }
  }
  const t3 = verbose ? undefined : Math.min(5, lines.length);
  let t4;
  if ($[11] !== displayLines) {
    t4 = <Text dimColor={true}>{displayLines}</Text>;
    $[11] = displayLines;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  let t5;
  if ($[13] !== t3 || $[14] !== t4) {
    t5 = <Box height={t3} flexDirection="column" overflow="hidden">{t4}</Box>;
    $[13] = t3;
    $[14] = t4;
    $[15] = t5;
  } else {
    t5 = $[15];
  }
  let t6;
  if ($[16] !== lineStatus) {
    t6 = lineStatus ? <Text dimColor={true}>{lineStatus}</Text> : null;
    $[16] = lineStatus;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] !== elapsedTimeSeconds || $[19] !== timeoutMs) {
    t7 = <ShellTimeDisplay elapsedTimeSeconds={elapsedTimeSeconds} timeoutMs={timeoutMs} />;
    $[18] = elapsedTimeSeconds;
    $[19] = timeoutMs;
    $[20] = t7;
  } else {
    t7 = $[20];
  }
  let t8;
  if ($[21] !== totalBytes) {
    t8 = totalBytes ? <Text dimColor={true}>{formatFileSize(totalBytes)}</Text> : null;
    $[21] = totalBytes;
    $[22] = t8;
  } else {
    t8 = $[22];
  }
  let t9;
  if ($[23] !== t6 || $[24] !== t7 || $[25] !== t8) {
    t9 = <Box flexDirection="row" gap={1}>{t6}{t7}{t8}</Box>;
    $[23] = t6;
    $[24] = t7;
    $[25] = t8;
    $[26] = t9;
  } else {
    t9 = $[26];
  }
  let t10;
  if ($[27] !== t5 || $[28] !== t9) {
    t10 = <MessageResponse><OffscreenFreeze><Box flexDirection="column">{t5}{t9}</Box></OffscreenFreeze></MessageResponse>;
    $[27] = t5;
    $[28] = t9;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  return t10;
}
function _temp(line) {
  return line;
}
